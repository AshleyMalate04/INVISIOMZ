import { useId, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { Alert } from '../components/ui'
import { formatBytes, formatInt } from '../utils/format'
import { rawCapacityBytes, usefulCapacityBytes } from '../utils/capacity'
import type { Bits } from '../types'

const TOC = [
  ['esteganografia', 'O que é esteganografia'],
  ['criptografia', 'O que é criptografia'],
  ['diferenca', 'A diferença entre as duas'],
  ['lsb', 'Como funciona o LSB'],
  ['aes', 'AES-256-GCM'],
  ['kdf', 'Senha e derivação de chave'],
  ['capacidade', 'Cálculo de capacidade'],
  ['limitacoes', 'Limitações'],
  ['ferramentas', 'Steghide e Stegosuite'],
  ['projecto', 'Resumo do projecto'],
] as const

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="card scroll-mt-24 space-y-4 p-6 sm:p-8">
      <h2 id={`${id}-t`} className="text-2xl font-semibold">
        {title}
      </h2>
      <div className="space-y-3 text-[0.95rem] leading-relaxed text-ink-soft [&_strong]:text-ink">{children}</div>
    </section>
  )
}

const bin8 = (n: number) => n.toString(2).padStart(8, '0')
const SAMPLE = [200, 117, 64, 31, 255, 128, 13, 92] // valores de canais R, G, B… (exemplo didáctico)

/** Exemplo didáctico: esconde 1 carácter (8 bits) nos LSB de 8 valores de canal. NÃO é o algoritmo real. */
function LsbDemo() {
  const [char, setChar] = useState('A')
  const inputId = useId()
  const code = (char || ' ').charCodeAt(0) & 0xff
  const bits = bin8(code).split('').map(Number)
  const rows = SAMPLE.map((v, i) => {
    const out = (v & 0xfe) | bits[i]
    return { v, bit: bits[i], out, delta: out - v }
  })
  return (
    <div className="space-y-4 rounded-2xl border border-line bg-surface-2/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium text-ink">
            Carácter a esconder (ASCII)
          </label>
          <input
            id={inputId}
            value={char}
            maxLength={1}
            onChange={(e) => setChar(e.target.value.replace(/[^\x20-\x7e]/g, '').slice(0, 1))}
            className="mt-1 w-20 rounded-xl border border-line-strong bg-surface px-3 py-2 text-center font-mono text-lg text-ink"
          />
        </div>
        <p className="text-sm">
          <span className="font-mono text-ink">{char || '␠'}</span> = código <strong className="tabular-nums">{code}</strong> ={' '}
          <span className="font-mono text-brand-strong">{bin8(code)}</span>
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <caption className="sr-only">Exemplo de substituição do bit menos significativo</caption>
          <thead className="text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th scope="col" className="py-2 pr-3">Canal</th>
              <th scope="col" className="py-2 pr-3">Valor original</th>
              <th scope="col" className="py-2 pr-3">Bit a esconder</th>
              <th scope="col" className="py-2 pr-3">Valor novo</th>
              <th scope="col" className="py-2">Mudança</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line font-mono tabular-nums">
            {rows.map((r, i) => (
              <tr key={i}>
                <th scope="row" className="py-2 pr-3 font-sans font-medium text-ink-soft">{['R', 'G', 'B'][i % 3]}{Math.floor(i / 3) + 1}</th>
                <td className="py-2 pr-3">
                  {r.v} <span className="text-ink-soft">= {bin8(r.v).slice(0, 7)}</span>
                  <strong className="text-ink">{bin8(r.v)[7]}</strong>
                </td>
                <td className="py-2 pr-3 font-bold text-brand-strong">{r.bit}</td>
                <td className="py-2 pr-3">
                  {r.out} <span className="text-ink-soft">= {bin8(r.out).slice(0, 7)}</span>
                  <strong className="text-brand-strong">{bin8(r.out)[7]}</strong>
                </td>
                <td className="py-2">{r.delta === 0 ? 'nenhuma' : r.delta > 0 ? '+1' : '−1'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-soft">
        Didáctico: aqui os bits vão por ordem, sem cifra e sem permutação. O algoritmo real do InvisioMZ cifra primeiro e escolhe posições
        pseudo-aleatórias (ver abaixo). Cada valor muda, no máximo, ±1: invisível a olho nu.
      </p>
    </div>
  )
}

function CapacityCalculator() {
  const [w, setW] = useState(1920)
  const [h, setH] = useState(1080)
  const [bits, setBits] = useState<Bits>(1)
  const wid = useId()
  const hid = useId()
  const valid = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
  const raw = useMemo(() => (valid ? rawCapacityBytes(w, h, bits) : 0), [valid, w, h, bits])
  const useful = useMemo(() => (valid ? usefulCapacityBytes(w, h, bits) : 0), [valid, w, h, bits])
  const clamp = (v: string) => Math.max(0, Math.min(20000, Math.floor(Number(v) || 0)))
  return (
    <div className="space-y-4 rounded-2xl border border-line bg-surface-2/60 p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={wid} className="block text-sm font-medium text-ink">Largura (px)</label>
          <input id={wid} type="number" min={1} max={20000} value={w || ''} onChange={(e) => setW(clamp(e.target.value))} className="mt-1 w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-ink" />
        </div>
        <div>
          <label htmlFor={hid} className="block text-sm font-medium text-ink">Altura (px)</label>
          <input id={hid} type="number" min={1} max={20000} value={h || ''} onChange={(e) => setH(clamp(e.target.value))} className="mt-1 w-full rounded-xl border border-line-strong bg-surface px-3 py-2 text-ink" />
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-ink">Bits por canal</legend>
          <div className="mt-1 flex gap-2">
            {([1, 2] as Bits[]).map((b) => (
              <label key={b} className={`flex-1 cursor-pointer rounded-xl border px-3 py-2 text-center text-sm font-medium has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-glow ${bits === b ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line-strong bg-surface'}`}>
                <input type="radio" name="calc-bits" className="sr-only" checked={bits === b} onChange={() => setBits(b)} />
                {b}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {valid && (
        <dl className="grid gap-3 text-sm sm:grid-cols-2" aria-live="polite">
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs uppercase tracking-wide text-ink-soft">Capacidade bruta</dt>
            <dd className="font-mono tabular-nums text-ink">
              {formatInt(w)} × {formatInt(h)} × 3 × {bits} ÷ 8 = <strong>{formatInt(raw)} B</strong> ({formatBytes(raw)})
            </dd>
          </div>
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs uppercase tracking-wide text-ink-soft">Capacidade útil (pacote)</dt>
            <dd className="font-mono tabular-nums text-ink">
              <strong>{formatInt(useful)} B</strong> ({formatBytes(useful)})
            </dd>
          </div>
        </dl>
      )}
    </div>
  )
}

export function LearnPage() {
  return (
    <div>
      <PageHeader eyebrow="Fundamentação teórica" title="Aprender: como o InvisioMZ protege os dados">
        <p>Os conceitos por trás da aplicação, com exemplos que pode experimentar.</p>
      </PageHeader>

      <div className="grid gap-8 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="Índice" className="lg:sticky lg:top-24 lg:self-start">
          <ol className="space-y-1 text-sm">
            {TOC.map(([id, label], i) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-lg px-3 py-1.5 text-ink-soft hover:bg-surface-2 hover:text-brand-strong">
                  <span className="mr-2 tabular-nums text-ink-soft/70">{i + 1}.</span>
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 space-y-6">
          <Section id="esteganografia" title="O que é esteganografia">
            <p>
              A esteganografia (do grego <em>steganós</em>, «coberto», e <em>graphein</em>, «escrever») é a arte de <strong>esconder a existência</strong>{' '}
              de uma mensagem dentro de outro objecto aparentemente inocente: uma imagem, um áudio, um texto. O objectivo é que ninguém suspeite que há
              comunicação.
            </p>
          </Section>

          <Section id="criptografia" title="O que é criptografia">
            <p>
              A criptografia transforma a informação numa forma <strong>ilegível sem a chave</strong>. Quem intercepta os dados sabe que há uma mensagem,
              mas não consegue lê-la nem alterá-la sem ser detectado (quando a cifra é autenticada).
            </p>
          </Section>

          <Section id="diferenca" title="A diferença entre as duas">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <caption className="sr-only">Comparação entre esteganografia e criptografia</caption>
                <thead className="text-xs uppercase tracking-wide text-ink-soft">
                  <tr><th scope="col" className="py-2 pr-4"> </th><th scope="col" className="py-2 pr-4">Esteganografia</th><th scope="col" className="py-2">Criptografia</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  <tr><th scope="row" className="py-2 pr-4 font-medium text-ink">Esconde</th><td className="py-2 pr-4">que a mensagem existe</td><td className="py-2">o conteúdo da mensagem</td></tr>
                  <tr><th scope="row" className="py-2 pr-4 font-medium text-ink">Se for descoberta</th><td className="py-2 pr-4">o conteúdo fica exposto (se não estiver cifrado)</td><td className="py-2">continua ilegível sem a chave</td></tr>
                  <tr><th scope="row" className="py-2 pr-4 font-medium text-ink">Neste projecto</th><td className="py-2 pr-4">LSB em PNG</td><td className="py-2">AES-256-GCM + Scrypt</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              Por isso o InvisioMZ combina as duas: <strong>cifra primeiro, esconde depois</strong>. Mesmo que alguém detecte o LSB, só encontra bytes
              aleatórios autenticados.
            </p>
          </Section>

          <Section id="lsb" title="Como funciona o LSB">
            <p>
              Cada pixel tem três canais (R, G, B) com valores de 0 a 255 (8 bits). O <strong>bit menos significativo</strong> (LSB) é o último: mudá-lo
              altera o valor em apenas ±1, imperceptível ao olho. Substituímos esses bits pelos bits da mensagem.
            </p>
            <LsbDemo />
            <p>No InvisioMZ real:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Um <strong>cabeçalho de 46 bytes</strong> fica sempre em modo de 1 bit, para ser legível (magic, versão, parâmetros do KDF, salt, nonce, comprimento, CRC32).</li>
              <li>O <strong>corpo cifrado</strong> usa 1 ou 2 bits por canal e é espalhado por uma permutação pseudo-aleatória derivada da senha.</li>
              <li>O espaço livre é preenchido com bits aleatórios, para que a zona com dados e a sem dados tenham a mesma estatística.</li>
              <li>A saída é sempre um PNG (sem perdas); o canal alfa é preservado e os metadados EXIF/ICC são removidos.</li>
            </ul>
          </Section>

          <Section id="aes" title="O papel do AES-256-GCM">
            <p>
              O AES é uma cifra por blocos; em modo <strong>GCM</strong> é uma cifra <em>autenticada</em> (AEAD): além de cifrar, produz uma <strong>tag</strong> de
              16 bytes que prova que nem o conteúdo nem o cabeçalho foram alterados. O cabeçalho entra como dados associados (AAD): mexer num único bit do
              cabeçalho invalida a autenticação.
            </p>
            <p>
              Consequência importante: com GCM, «senha errada» e «dados adulterados» <strong>são indistinguíveis</strong> (a tag falha nos dois casos). A
              aplicação diz isso mesmo, em vez de fingir que distingue. O nonce de 12 bytes é novo em cada operação.
            </p>
          </Section>

          <Section id="kdf" title="Porque se usa senha e um KDF">
            <p>
              Uma senha humana tem pouca entropia e comprimento variável; o AES precisa de 256 bits. Um <strong>KDF</strong> (função de derivação de chave)
              converte uma em outra. Usamos <strong>Scrypt</strong> (N = 2<sup>15</sup>, r = 8, p = 1), que gasta memória e tempo de propósito para tornar
              caro testar milhões de senhas. O <strong>salt</strong> aleatório de 16 bytes garante chaves diferentes mesmo para senhas iguais; os parâmetros ficam
              gravados na imagem. Depois, o HKDF-SHA256 separa a chave de cifra da chave da permutação.
            </p>
          </Section>

          <Section id="capacidade" title="Cálculo de capacidade">
            <p>
              Com 1 bit por canal: <strong>capacidade bruta = largura × altura × 3 ÷ 8</strong> bytes. Exemplo: 1920 × 1080 × 3 ÷ 8 ={' '}
              <strong>{formatInt(rawCapacityBytes(1920, 1080, 1))} B</strong> ≈ {formatBytes(rawCapacityBytes(1920, 1080, 1))}. Com 2 bits, o dobro. A capacidade
              <strong> útil</strong> desconta o cabeçalho (46 B), a tag GCM (16 B) e a sobrecarga do pacote ZIP/manifesto.
            </p>
            <CapacityCalculator />
            <p>Cifrar <strong>não aumenta</strong> a capacidade: o texto cifrado ocupa tanto espaço como o original (+16 B de tag).</p>
          </Section>

          <Section id="limitacoes" title="Limitações">
            <ul className="list-disc space-y-1.5 pl-5">
              <li><strong>JPEG e compressão com perdas</strong> destroem os bits menos significativos: por isso a saída é PNG e o ficheiro tem de ser partilhado intacto.</li>
              <li><strong>Redimensionar, recortar, rodar ou aplicar filtros</strong> altera os píxeis; os dados perdem-se.</li>
              <li><strong>Estegoanálise:</strong> testes estatísticos (qui-quadrado, RS, SPA) podem detectar LSB, sobretudo com a imagem muito cheia.</li>
              <li><strong>Senha esquecida:</strong> irrecuperável. Não há porta dos fundos.</li>
              <li>A senha viaja ao servidor por HTTPS durante a operação (obrigatório em produção); o servidor não a guarda, mas tem de confiar nele.</li>
            </ul>
            <Alert kind="warn">É uma implementação académica. Não a use como única protecção de segredos de alto risco.</Alert>
          </Section>

          <Section id="ferramentas" title="Steghide e Stegosuite">
            <p>
              O <strong>Steghide</strong> é uma ferramenta de linha de comandos que esconde dados em ficheiros JPEG, BMP, WAV e AU, protegidos por frase-passe. O{' '}
              <strong>Stegosuite</strong> é uma ferramenta em Java, com interface gráfica, que esconde dados em imagens (BMP, GIF, JPG, PNG) e os cifra com AES.
            </p>
            <p>
              São ferramentas <strong>distintas</strong> desta implementação: o InvisioMZ não as usa nem é compatível com os seus ficheiros. Serve para comparar
              resultados e para perceber o que acontece por baixo, já que aqui o algoritmo está escrito de raiz e documentado.
            </p>
          </Section>

          <Section id="projecto" title="Resumo do projecto">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Backend Python (FastAPI, Pillow, NumPy, <code>cryptography</code>) com LSB, AES-256-GCM, Scrypt e pacote ZIP + manifesto com SHA-256.</li>
              <li>Verificação pós-escrita: o servidor relê o PNG e decifra antes de o devolver.</li>
              <li>Supabase (Auth, Postgres com RLS, Storage privado) para contas, histórico e ficheiros temporários. Nada em claro é guardado.</li>
              <li>Frontend React + TypeScript + Tailwind.</li>
            </ul>
            <p>
              Pronto para experimentar? <Link to="/ocultar" className="font-semibold text-brand-strong underline">Esconda uma mensagem</Link> e depois{' '}
              <Link to="/extrair" className="font-semibold text-brand-strong underline">extraia-a</Link>.
            </p>
          </Section>
        </div>
      </div>
    </div>
  )
}
