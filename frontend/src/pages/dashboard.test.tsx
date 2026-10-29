import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TestApp } from '../test/TestApp'
import { apiError, CONFIG, json, mockFetch } from '../test/mockApi'
import type { DashboardData } from '../types'

// Cliente Supabase simulado: permite testar a área autenticada sem rede.
vi.mock('../services/supabase', () => {
  let current: unknown = null
  const listeners = new Set<(event: string, session: unknown) => void>()
  const client = {
    auth: {
      getSession: async () => ({ data: { session: current } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        listeners.add(cb)
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
      },
      signOut: async () => {
        current = null
        listeners.forEach((cb) => cb('SIGNED_OUT', null))
        return { error: null }
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name: 'Ana' } }) }) }) }),
  }
  return {
    supabase: client,
    supabaseConfigured: true,
    __setSession: (s: unknown) => {
      current = s
    },
  }
})

import * as supabaseModule from '../services/supabase'
const setSession = (supabaseModule as unknown as { __setSession: (s: unknown) => void }).__setSession

const SESSION = { access_token: 'jwt-ana', user: { id: 'u1', email: 'ana@example.com', user_metadata: { display_name: 'Ana' } } }
const ACCOUNTS = { ...CONFIG, accounts_enabled: true, guest_allowed: false }

const DASH: DashboardData = {
  totals: { operations: 5, hide: 3, extract: 2, success: 4, failed: 1 },
  saved: { count: 2, bytes: 3 * 1024 * 1024, expiring_soon: 1, expired: 0 },
  last_7_days: ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'].map((date, i) => ({
    date,
    hide: i === 6 ? 2 : 0,
    extract: i === 6 ? 1 : 0,
  })),
  recent: [
    { id: 'op1', type: 'extract', status: 'failed', error_code: 'WRONG_PASSWORD_OR_TAMPERED', bits_per_channel: 1, image_width: 10, image_height: 10, payload_bytes: 0, file_count: 0, has_message: false, duration_ms: 5, created_at: '2026-10-22T10:00:00Z', file: null },
    { id: 'op2', type: 'hide', status: 'success', error_code: null, bits_per_channel: 2, image_width: 10, image_height: 10, payload_bytes: 100, file_count: 1, has_message: true, duration_ms: 5, created_at: '2026-10-22T09:00:00Z', file: null },
  ],
  truncated: false,
}

beforeEach(() => setSession(null))

describe('Login obrigatório (modo convidado desligado)', () => {
  it.each(['/ocultar', '/extrair', '/painel', '/historico', '/definicoes'])('%s sem sessão leva para «Entrar»', async (path) => {
    mockFetch({ '/api/config': () => json(ACCOUNTS) })
    render(<TestApp initialEntries={[path]} />)
    expect(await screen.findByRole('heading', { name: /bem vindo de volta/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ocultar' })).not.toBeInTheDocument()
  })

  it('a página inicial pública oferece «Criar conta» e «Entrar», não o acesso directo', async () => {
    mockFetch({ '/api/config': () => json(ACCOUNTS) })
    render(<TestApp initialEntries={['/']} />)
    expect((await screen.findAllByRole("link", { name: /criar conta/i })).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: /esconder agora|usar sem conta/i })).not.toBeInTheDocument()
  })

  it('com o modo convidado ligado no servidor, Ocultar abre sem sessão', async () => {
    mockFetch({ '/api/config': () => json({ ...ACCOUNTS, guest_allowed: true }) })
    render(<TestApp initialEntries={['/ocultar']} />)
    expect(await screen.findByRole('heading', { name: /esconder informação numa imagem/i })).toBeInTheDocument()
  })

  it('o histórico continua a exigir sessão mesmo com convidados', async () => {
    mockFetch({ '/api/config': () => json({ ...ACCOUNTS, guest_allowed: true }) })
    render(<TestApp initialEntries={['/historico']} />)
    expect(await screen.findByRole('heading', { name: /bem vindo de volta/i })).toBeInTheDocument()
  })
})

describe('Painel', () => {
  it('com sessão, «/» e «/entrar» levam ao painel com menu lateral e resumo', async () => {
    setSession(SESSION)
    mockFetch({ '/api/config': () => json(ACCOUNTS), '/api/dashboard': () => json(DASH) })
    render(<TestApp initialEntries={['/entrar']} />)
    expect(await screen.findByRole('heading', { name: 'Olá, Ana' })).toBeInTheDocument()

    const nav = screen.getAllByRole('navigation', { name: 'Principal' })[0]
    for (const name of ['Painel', 'Ocultar', 'Extrair', 'Histórico', 'Definições']) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument()
    }
    expect(within(nav).queryByRole('link', { name: 'Aprender' })).not.toBeInTheDocument() // desligado
    const resumo = await screen.findByRole('region', { name: 'Resumo' })
    expect(within(resumo).getByText('Operações').parentElement).toHaveTextContent('Operações')
    expect(resumo).toHaveTextContent('80 %') // 4 em 5 com sucesso
    expect(resumo).toHaveTextContent('1 falhou')
    expect(await screen.findByText('3 MB', { exact: false })).toBeInTheDocument() // PNG guardados
    expect(screen.getByText(/expira nas próximas 24 h/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /últimos 7 dias: 3 no total/i })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Operações por dia' })).toBeInTheDocument() // equivalente acessível do gráfico
    const recentes = screen.getByRole('region', { name: 'Actividade recente' })
    expect(within(recentes).getAllByRole('listitem')).toHaveLength(2)
    expect(within(recentes).getByText('Falhou')).toBeInTheDocument()
  })

  it('atalhos levam a Ocultar e Extrair', async () => {
    setSession(SESSION)
    mockFetch({ '/api/config': () => json(ACCOUNTS), '/api/dashboard': () => json(DASH) })
    render(<TestApp initialEntries={['/painel']} />)
    const atalhos = await screen.findByRole('region', { name: 'Atalhos' })
    expect(within(atalhos).getByRole('link', { name: /ocultar informação/i })).toHaveAttribute('href', '/ocultar')
    expect(within(atalhos).getByRole('link', { name: /extrair informação/i })).toHaveAttribute('href', '/extrair')
  })

  it('painel vazio mostra estados vazios amigáveis', async () => {
    setSession(SESSION)
    const empty: DashboardData = { ...DASH, totals: { operations: 0, hide: 0, extract: 0, success: 0, failed: 0 }, saved: { count: 0, bytes: 0, expiring_soon: 0, expired: 0 }, recent: [], last_7_days: DASH.last_7_days.map((d) => ({ ...d, hide: 0, extract: 0 })) }
    mockFetch({ '/api/config': () => json(ACCOUNTS), '/api/dashboard': () => json(empty) })
    render(<TestApp initialEntries={['/painel']} />)
    expect(await screen.findByText(/ainda não há actividade/i)).toBeInTheDocument()
    expect(screen.getByText('Sem operações ainda')).toBeInTheDocument()
    expect(screen.getByText('Nenhum ficheiro guardado.')).toBeInTheDocument()
  })

  it('erro do servidor mostra aviso com «Tentar de novo»', async () => {
    setSession(SESSION)
    mockFetch({ '/api/config': () => json(ACCOUNTS), '/api/dashboard': () => apiError('INTERNAL_ERROR', 'falhou', 500) })
    render(<TestApp initialEntries={['/painel']} />)
    expect(await screen.findByText('Erro interno')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument()
  })

  it('«Terminar sessão» volta à página pública', async () => {
    const user = userEvent.setup()
    setSession(SESSION)
    mockFetch({ '/api/config': () => json(ACCOUNTS), '/api/dashboard': () => json(DASH) })
    render(<TestApp initialEntries={['/painel']} />)
    await screen.findByRole('heading', { name: 'Olá, Ana' })
    await user.click(screen.getAllByRole('button', { name: /terminar sessão/i })[0])
    expect((await screen.findAllByRole("link", { name: /criar conta/i })).length).toBeGreaterThan(0)
  })
})

describe('Páginas públicas e ecrãs de entrada', () => {
  it('o cabeçalho público só tem «Entrar» (sem «Início», «Aprender» nem «Criar conta»)', async () => {
    mockFetch({ '/api/config': () => json(ACCOUNTS) })
    render(<TestApp initialEntries={['/']} />)
    await screen.findAllByRole('link', { name: 'Entrar' })
    const header = document.querySelector('header.sticky') as HTMLElement
    expect(within(header).getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/entrar')
    for (const name of ['Início', 'Aprender', 'Criar conta']) {
      expect(within(header).queryByRole('link', { name })).not.toBeInTheDocument()
    }
    expect(document.querySelector('footer')).toBeNull() // rodapé desligado
  })

  it('a página inicial tem a secção «Como funciona»', async () => {
    mockFetch({ '/api/config': () => json(ACCOUNTS) })
    render(<TestApp initialEntries={['/']} />)
    expect(await screen.findByRole('heading', { name: /como funciona, em cinco passos/i })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(5)
  })

  it.each(['/entrar', '/registar', '/recuperar-senha'])('%s não tem cabeçalho nem rodapé; tem seta para voltar ao início', async (path) => {
    mockFetch({ '/api/config': () => json(ACCOUNTS) })
    render(<TestApp initialEntries={[path]} />)
    const back = await screen.findByRole('link', { name: 'Voltar à página inicial' })
    expect(back).toHaveAttribute('href', '/')
    expect(document.querySelector('header.sticky')).toBeNull() // o cabeçalho da aplicação (o <header> do título da página é outro)
    expect(document.querySelector('footer')).toBeNull()
    expect(screen.queryByRole('link', { name: /invisiomz — página inicial/i })).not.toBeInTheDocument()
  })

  it('a rota /aprender já não existe (página desligada)', async () => {
    mockFetch({ '/api/config': () => json(ACCOUNTS) })
    render(<TestApp initialEntries={['/aprender']} />)
    expect(await screen.findByText('Página não encontrada')).toBeInTheDocument()
  })
})
