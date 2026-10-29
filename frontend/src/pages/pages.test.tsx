import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TestApp } from '../test/TestApp'
import { apiError, capacityFor, CONFIG, json, mockFetch } from '../test/mockApi'
import { CapacityBar } from '../components/CapacityBar'
import { ConfirmDialog } from '../components/Dialog'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const META = {
  output_filename: 'k7x2_foto_praia.png',
  width: 200,
  height: 150,
  original_format: 'JPEG',
  original_size_bytes: 2_516_582, // 2,4 MB
  output_size_bytes: 5_347_737, // 5,1 MB
  sha256: 'ab'.repeat(32),
  bits: 1,
  package_bytes: 900,
  useful_capacity_bytes: 11_000,
  file_count: 0,
  has_message: true,
  duration_ms: 420,
  warnings: [],
}

const hideHandler = () =>
  new Response(new Blob([PNG_BYTES], { type: 'image/png' }), {
    headers: { 'content-type': 'image/png', 'x-meta': encodeURIComponent(JSON.stringify(META)), 'x-saved': 'false' },
  })

/** O input só existe depois de a configuração carregar (a rota espera pela sessão/config). */
async function fileInput(container: HTMLElement): Promise<HTMLInputElement> {
  return waitFor(() => {
    const el = container.querySelector('input[type=file]')
    if (!el) throw new Error('input de ficheiro ainda não existe')
    return el as HTMLInputElement
  })
}

describe('Ocultar: fluxo completo', () => {
  it('imagem → conteúdo → senha → ocultar → resultado com comparação de tamanhos', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      '/api/config': () => json(CONFIG),
      '/api/capacity': () => json(capacityFor(200, 150, 2_516_582, 'JPEG')),
      '/api/hide': hideHandler,
    })
    const { container } = render(<TestApp initialEntries={['/ocultar']} />)

    // 1) imagem: nome e tamanho legível de imediato
    await user.upload(await fileInput(container), new File([new Uint8Array(2_516_582)], 'foto_praia.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByText('foto_praia.jpg')).toBeInTheDocument()
    expect(screen.getByText('2,4 MB')).toBeInTheDocument()
    expect(await screen.findByText(/JPEG · 200 × 150 px/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /seguinte/i }))

    // 2) conteúdo: não avança sem nada para esconder
    expect(screen.getByRole('button', { name: /seguinte/i })).toBeDisabled()
    await user.type(screen.getByLabelText(/mensagem/i), 'Olá, Moçambique! 🚀')
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /seguinte/i }))

    // 3) senha: mínimo de 10 caracteres + confirmação
    const pw = screen.getByLabelText('Senha')
    const confirm = screen.getByLabelText('Confirmar senha')
    await user.type(pw, 'curta')
    expect(screen.getByText(/Faltam 5 caracteres/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /seguinte/i })).toBeDisabled()
    await user.clear(pw)
    await user.type(pw, 'Maputo-pao-quente-2026!')
    await user.type(confirm, 'diferente-diferente')
    expect(screen.getByText('As senhas não coincidem.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /seguinte/i })).toBeDisabled()
    await user.clear(confirm)
    await user.type(confirm, 'Maputo-pao-quente-2026!')
    await user.click(screen.getByRole('button', { name: /seguinte/i }))

    // 4) rever e ocultar
    await user.click(await screen.findByRole('button', { name: /ocultar agora/i }))

    // 5) resultado
    expect(await screen.findByRole('heading', { name: /imagem criada/i })).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByText('foto_praia.jpg')).toBeInTheDocument()
    expect(within(table).getByText('k7x2_foto_praia.png')).toBeInTheDocument()
    expect(within(table).getByText(/2,4 MB → 5,1 MB \(\+113 %\)/)).toBeInTheDocument()
    expect(screen.getByText(/PNG é um formato sem perdas/)).toBeInTheDocument()
    expect(screen.getByText(META.sha256)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /descarregar png/i })).toBeInTheDocument()

    // a senha foi enviada no corpo do pedido, nunca no URL
    const hideCall = calls.find((c) => c.path === '/api/hide')!
    expect((hideCall.init!.body as FormData).get('password')).toBe('Maputo-pao-quente-2026!')
    expect(hideCall.path).not.toContain('Maputo')
  })

  it('descarregar usa o nome de saída do servidor', async () => {
    const user = userEvent.setup()
    mockFetch({
      '/api/config': () => json(CONFIG),
      '/api/capacity': () => json(capacityFor(200, 150, 5000, 'PNG')),
      '/api/hide': hideHandler,
    })
    const clicked: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download)
    })
    const { container } = render(<TestApp initialEntries={['/ocultar']} />)
    await user.upload(await fileInput(container), new File(['x'], 'a.png', { type: 'image/png' }))
    await screen.findByText(/PNG · 200 × 150 px/)
    await user.click(screen.getByRole('button', { name: /seguinte/i }))
    await user.type(screen.getByLabelText(/mensagem/i), 'segredo')
    await user.click(screen.getByRole('button', { name: /seguinte/i }))
    await user.type(screen.getByLabelText('Senha'), 'uma-senha-muito-boa')
    await user.type(screen.getByLabelText('Confirmar senha'), 'uma-senha-muito-boa')
    await user.click(screen.getByRole('button', { name: /seguinte/i }))
    await user.click(await screen.findByRole('button', { name: /ocultar agora/i }))
    await user.click(await screen.findByRole('button', { name: /descarregar png/i }))
    expect(clicked).toEqual(['k7x2_foto_praia.png'])
  })

  it('erro de capacidade do servidor volta ao passo do conteúdo', async () => {
    const user = userEvent.setup()
    mockFetch({
      '/api/config': () => json(CONFIG),
      '/api/capacity': () => json(capacityFor(200, 150, 5000)),
      '/api/hide': () => apiError('CAPACITY_EXCEEDED', 'O conteúdo não cabe nesta imagem.'),
    })
    const { container } = render(<TestApp initialEntries={['/ocultar']} />)
    await user.upload(await fileInput(container), new File(['x'], 'a.png', { type: 'image/png' }))
    await screen.findByText(/200 × 150 px/)
    await user.click(screen.getByRole('button', { name: /seguinte/i }))
    await user.type(screen.getByLabelText(/mensagem/i), 'x')
    await user.click(screen.getByRole('button', { name: /seguinte/i }))
    await user.type(screen.getByLabelText('Senha'), 'uma-senha-muito-boa')
    await user.type(screen.getByLabelText('Confirmar senha'), 'uma-senha-muito-boa')
    await user.click(screen.getByRole('button', { name: /seguinte/i }))
    await user.click(await screen.findByRole('button', { name: /ocultar agora/i }))
    expect(await screen.findByRole('heading', { name: /o que quer esconder/i })).toBeInTheDocument()
  })

  it('bloqueia o passo seguinte quando o conteúdo excede a capacidade', async () => {
    const user = userEvent.setup()
    mockFetch({ '/api/config': () => json(CONFIG), '/api/capacity': () => json(capacityFor(20, 20, 900)) })
    const { container } = render(<TestApp initialEntries={['/ocultar']} />)
    await user.upload(await fileInput(container), new File(['x'], 'pequena.png', { type: 'image/png' }))
    await screen.findByText(/20 × 20 px/)
    await user.click(screen.getByRole('button', { name: /seguinte/i }))
    await user.upload(await fileInput(container), new File([new Uint8Array(5000)], 'grande.bin'))
    expect(await screen.findByText('grande.bin')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/excede a capacidade/i)
    expect(screen.getByRole('button', { name: /seguinte/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /remover grande\.bin/i }))
    expect(screen.queryByText('grande.bin')).not.toBeInTheDocument()
  })

  it('recusa imagens maiores do que o limite sem chamar o servidor', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({ '/api/config': () => json({ ...CONFIG, limits: { ...CONFIG.limits, max_image_bytes: 1000 } }) })
    const { container } = render(<TestApp initialEntries={['/ocultar']} />)
    await waitFor(() => expect(calls.some((c) => c.path === '/api/config')).toBe(true))
    await user.upload(await fileInput(container), new File([new Uint8Array(5000)], 'enorme.png', { type: 'image/png' }))
    expect(await screen.findByText(/Imagem recusada/)).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/api/capacity')).toBe(false)
  })
})

describe('Extrair', () => {
  const EXTRACTED = {
    message: 'Mensagem recuperada ✓',
    files: [{ id: '0001', name: 'nota.txt', size: 5, sha256: 'a'.repeat(64), mime: 'text/plain', content_b64: btoa('olá!!'), download_token: null }],
    zip_token: 'tok-zip',
    inline: true,
    total_bytes: 5,
    bits: 1,
    width: 200,
    height: 150,
    duration_ms: 123,
    token_ttl_s: 300,
  }

  it('senha errada: erro específico, campo limpo e nada revelado', async () => {
    const user = userEvent.setup()
    mockFetch({
      '/api/config': () => json(CONFIG),
      '/api/extract': () => apiError('WRONG_PASSWORD_OR_TAMPERED', 'Não foi possível abrir o conteúdo.'),
    })
    const { container } = render(<TestApp initialEntries={['/extrair']} />)
    await user.upload(await fileInput(container), new File(['x'], 'k7x2_foto.png', { type: 'image/png' }))
    await user.type(screen.getByLabelText('Senha'), 'errada-errada')
    await user.click(screen.getByRole('button', { name: /^extrair$/i }))
    expect(await screen.findByText('Senha errada ou imagem alterada')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toHaveValue('')
    expect(screen.queryByText('Mensagem recuperada ✓')).not.toBeInTheDocument()
  })

  it('NO_HIDDEN_DATA tem mensagem própria, distinta da senha errada', async () => {
    const user = userEvent.setup()
    mockFetch({
      '/api/config': () => json(CONFIG),
      '/api/extract': () => apiError('NO_HIDDEN_DATA', 'Esta imagem não contém dados escondidos pelo InvisioMZ.'),
    })
    const { container } = render(<TestApp initialEntries={['/extrair']} />)
    await user.upload(await fileInput(container), new File(['x'], 'x.png', { type: 'image/png' }))
    await user.type(screen.getByLabelText('Senha'), 'qualquer-coisa')
    await user.click(screen.getByRole('button', { name: /^extrair$/i }))
    expect(await screen.findByText('Sem dados escondidos')).toBeInTheDocument()
  })

  it('sucesso: mostra mensagem, ficheiros e ZIP, e limpa tudo ao pedir', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      '/api/config': () => json(CONFIG),
      '/api/extract': () => json(EXTRACTED),
      '/api/files/tok-zip': () => new Response(new Blob([new Uint8Array([80, 75, 3, 4])]), { headers: { 'content-type': 'application/zip' } }),
    })
    const { container } = render(<TestApp initialEntries={['/extrair']} />)
    await user.upload(await fileInput(container), new File(['x'], 'x.png', { type: 'image/png' }))
    await user.type(screen.getByLabelText('Senha'), 'Maputo-pao-quente-2026!')
    await user.click(screen.getByRole('button', { name: /^extrair$/i }))
    expect(await screen.findByText('Mensagem recuperada ✓')).toBeInTheDocument()
    expect(screen.getByText('nota.txt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copiar mensagem/i })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /descarregar tudo \(zip\)/i })).toBeInTheDocument()
    expect(calls.filter((c) => c.path === '/api/files/tok-zip')).toHaveLength(1) // token de uso único: 1 pedido

    const clicked: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download)
    })
    await user.click(screen.getByRole('button', { name: /descarregar nota\.txt/i }))
    expect(clicked).toEqual(['nota.txt'])

    await user.click(screen.getByRole('button', { name: /limpar resultados/i }))
    expect(screen.queryByText('Mensagem recuperada ✓')).not.toBeInTheDocument()
    expect(screen.getByText(/conteúdo aparecerá aqui/i)).toBeInTheDocument()
  })

  it('liberta os URLs de objecto da pré-visualização ao sair da página', async () => {
    const user = userEvent.setup()
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    mockFetch({ '/api/config': () => json(CONFIG), '/api/health': () => json({ status: 'ok', version: 't', supabase: 'not_configured' }) })
    const { container } = render(<TestApp initialEntries={['/extrair']} />)
    await user.upload(await fileInput(container), new File(['x'], 'x.png', { type: 'image/png' }))
    await screen.findByText('x.png')
    await user.click(screen.getByRole('link', { name: /invisiomz — página inicial/i }))
    await waitFor(() => expect(revoke).toHaveBeenCalled())
  })
})

// «Aprender» está desligado (rota comentada em routes.tsx). Reactivar este bloco junto com a rota.
describe.skip('Aprender', () => {
  it('o exemplo didáctico de LSB calcula os bits e as mudanças correctamente', async () => {
    mockFetch({ '/api/config': () => json(CONFIG) })
    render(<TestApp initialEntries={['/aprender']} />)
    expect(await screen.findByText('01000001')).toBeInTheDocument() // 'A' = 65
    const table = screen.getByRole('table', { name: /bit menos significativo/i })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(8)
    const changes = rows.map((r) => {
      const cells = within(r).getAllByRole('cell')
      return cells[cells.length - 1].textContent
    })
    expect(changes).toEqual(['nenhuma', 'nenhuma', 'nenhuma', '−1', '−1', 'nenhuma', '−1', '+1'])
  })

  it('a calculadora de capacidade segue a fórmula largura × altura × 3 × bits ÷ 8', async () => {
    mockFetch({ '/api/config': () => json(CONFIG) })
    render(<TestApp initialEntries={['/aprender']} />)
    expect((await screen.findAllByText(/777\s?600 B/)).length).toBeGreaterThan(0)
  })
})

describe('Contas indisponíveis (Supabase não configurado)', () => {
  it.each(['/historico', '/definicoes', '/entrar', '/registar', '/recuperar-senha'])('%s explica a situação em vez de falhar', async (path) => {
    mockFetch({ '/api/config': () => json(CONFIG) })
    render(<TestApp initialEntries={[path]} />)
    expect(await screen.findByText(/contas indisponíveis neste ambiente/i)).toBeInTheDocument()
  })

  it('com as contas desligadas e convidados permitidos, a página inicial só oferece «Esconder agora»', async () => {
    mockFetch({ '/api/config': () => json(CONFIG) })
    render(<TestApp initialEntries={['/']} />)
    expect(await screen.findByRole('link', { name: /esconder agora/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Histórico' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /entrar/i })).not.toBeInTheDocument()
  })

  it('servidor inacessível mostra aviso com «Tentar de novo»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    render(<TestApp initialEntries={['/']} />)
    expect(await screen.findByText('Servidor indisponível')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument()
  })

  it('rota desconhecida mostra página 404', async () => {
    mockFetch({ '/api/config': () => json(CONFIG) })
    render(<TestApp initialEntries={['/nada-aqui']} />)
    expect(await screen.findByText('Página não encontrada')).toBeInTheDocument()
  })
})

describe('Componentes', () => {
  it('CapacityBar avisa quando excede a capacidade e expõe valores para leitores de ecrã', () => {
    render(<CapacityBar used={2000} total={1000} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar.getAttribute('aria-valuetext')).toMatch(/200 %/)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('CapacityBar sem excesso não mostra alerta', () => {
    render(<CapacityBar used={100} total={1000} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ConfirmDialog confirma e cancela', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog open title="Eliminar?" confirmLabel="Sim, eliminar" onConfirm={onConfirm} onCancel={onCancel}>
        <p>Tem a certeza?</p>
      </ConfirmDialog>,
    )
    expect(screen.getByRole('dialog', { name: 'Eliminar?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Sim, eliminar' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})

describe('Extrair: verificação de integridade (SHA-256)', () => {
  const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

  async function openWithFile(content: string) {
    const user = userEvent.setup()
    mockFetch({ '/api/config': () => json(CONFIG) })
    const { container } = render(<TestApp initialEntries={['/extrair']} />)
    await user.upload(await fileInput(container), new File([content], 'imagem.png', { type: 'image/png' }))
    return user
  }

  it('mostra o código do ficheiro carregado, sem precisar de senha', async () => {
    await openWithFile('abc')
    expect(await screen.findByText(ABC)).toBeInTheDocument()
  })

  it('código igual: «Ficheiro intacto»', async () => {
    const user = await openWithFile('abc')
    await screen.findByText(ABC)
    await user.type(screen.getByLabelText('SHA-256 original'), ABC.toUpperCase()) // maiúsculas também valem
    expect(await screen.findByText('Ficheiro intacto')).toBeInTheDocument()
    expect(screen.queryByText('Ficheiro diferente do original')).not.toBeInTheDocument()
  })

  it('código diferente: «Ficheiro diferente do original»', async () => {
    const user = await openWithFile('abd')
    await screen.findByText(/SHA-256 deste ficheiro/)
    await user.type(screen.getByLabelText('SHA-256 original'), ABC)
    expect(await screen.findByText('Ficheiro diferente do original')).toBeInTheDocument()
    expect(screen.queryByText('Ficheiro intacto')).not.toBeInTheDocument()
  })

  it('código mal formado: erro junto ao campo e nenhum veredicto', async () => {
    const user = await openWithFile('abc')
    await screen.findByText(ABC)
    await user.type(screen.getByLabelText('SHA-256 original'), 'isto-nao-e-um-sha256')
    expect(await screen.findByText(/Código inválido/)).toBeInTheDocument()
    expect(screen.queryByText('Ficheiro intacto')).not.toBeInTheDocument()
    expect(screen.queryByText('Ficheiro diferente do original')).not.toBeInTheDocument()
  })

  it('ao trocar de ficheiro o código antigo desaparece', async () => {
    const user = await openWithFile('abc')
    await screen.findByText(ABC)
    await user.click(screen.getByRole('button', { name: /remover imagem/i }))
    expect(screen.queryByText(ABC)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('SHA-256 original')).not.toBeInTheDocument()
  })
})
