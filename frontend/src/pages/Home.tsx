import { Navigate } from 'react-router-dom'
import { ArrowRight, Binary, FileArchive, ImageIcon, KeyRound, Lock } from 'lucide-react'
import { LogoFull } from '../components/Logo'
import { LinkButton } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'

// Nota: as secções comentadas mais abaixo (esteganografia vs criptografia, avisos, contexto, estado) estão desligadas
// de propósito. Para as reactivar, volte a importar o que usam (ícones, Alert, Badge, api, utils…).
// A secção «Como funciona» está activa.

const FLOW = [
  { icon: ImageIcon, title: 'Imagem + conteúdo', text: 'Escolhe uma imagem e junta texto e/ou ficheiros.' },
  { icon: KeyRound, title: 'Senha → chave', text: 'Scrypt transforma a senha numa chave de 256 bits.' },
  { icon: Lock, title: 'AES-256-GCM', text: 'O conteúdo é cifrado e autenticado antes de ser escondido.' },
  { icon: Binary, title: 'LSB espalhado', text: 'Os bits cifrados vão para posições pseudo-aleatórias de R, G e B.' },
  { icon: FileArchive, title: 'PNG real', text: 'Descarrega um PNG que parece igual ao original.' },
]

export function HomePage() {
  const { config, accountsAvailable } = useConfig()
  const { user } = useAuth()

  if (user) return <Navigate to="/painel" replace />

  return (
    <div className="space-y-16">
      {/* ───────── Hero ───────── */}
      <section className="grain relative overflow-hidden rounded-[2rem] border border-line bg-surface px-6 py-12 sm:px-12 sm:py-16">
        <div className="pixel-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="relative grid items-center gap-10 lg:grid-cols-[1.25fr_1fr]">
          <div className="rise space-y-6">
            {/* <Badge tone="brand">
              <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" /> Segurança Informática · projecto académico
            </Badge> */}
            <h1 className="text-4xl font-semibold leading-[1.05] sm:text-6xl">
              Esconda segredos <span className="text-brand">à vista</span> de todos.
            </h1>
            <p className="max-w-xl text-lg text-ink-soft">
              O InvisioMZ esconde mensagens e ficheiros dentro de imagens PNG. Primeiro cifra tudo com AES-256-GCM; depois espalha os bits pela
              imagem com LSB. Sem a senha, é só mais uma fotografia.
            </p>
            <div className="flex flex-wrap gap-3">
              {accountsAvailable && (
                <>
                  <LinkButton to="/registar" className="px-6">
                    Criar conta <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </LinkButton>
                  <LinkButton to="/entrar" variant="secondary" className="px-6">
                    Entrar
                  </LinkButton>
                </>
              )}
              {config.guest_allowed && (
                <LinkButton to="/ocultar" variant={accountsAvailable ? 'ghost' : 'primary'} className="px-6">
                  {accountsAvailable ? 'Usar sem conta' : 'Esconder agora'}
                </LinkButton>
              )}
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-xs">
            <div className="absolute inset-0 rounded-full bg-glow/25 blur-3xl" aria-hidden="true" />
            <LogoFull className="relative mx-auto w-full drop-shadow-xl" />
          </div>
        </div>
      </section>

      {/* ───────── Fluxo ───────── */}
      <section aria-labelledby="fluxo" className="space-y-6">
        <div className="max-w-2xl space-y-2">
          <h2 id="fluxo" className="text-3xl font-semibold">Como funciona, em cinco passos</h2>
          <p className="text-ink-soft">Tudo acontece em memória no servidor: nada em claro é guardado em disco e a senha nunca é persistida.</p>
        </div>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {FLOW.map((s, i) => (
            <li key={s.title} className="card relative space-y-3 p-5">
              <span className="absolute right-4 top-4 font-display text-3xl font-semibold text-line-strong" aria-hidden="true">
                {i + 1}
              </span>
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand-strong">
                <s.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="text-base font-semibold">{s.title}</h3>
              <p className="text-sm text-ink-soft">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ───────── Esteganografia vs criptografia ───────── */}
      {/* <section aria-labelledby="vs" className="space-y-6">
        <h2 id="vs" className="text-3xl font-semibold">Esteganografia ≠ criptografia</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <article className="card space-y-3 p-6">
            <ScanEye className="h-6 w-6 text-brand-strong" aria-hidden="true" />
            <h3 className="text-xl font-semibold">Esteganografia: esconde que existe</h3>
            <p className="text-sm text-ink-soft">
              Oculta a <em>existência</em> da mensagem dentro de outro objecto (aqui, uma imagem). Quem vê o PNG não tem motivo para desconfiar.
              Mas, se descobrir o método, lê o conteúdo.
            </p>
          </article>
          <article className="card space-y-3 p-6">
            <Lock className="h-6 w-6 text-brand-strong" aria-hidden="true" />
            <h3 className="text-xl font-semibold">Criptografia: esconde o que diz</h3>
            <p className="text-sm text-ink-soft">
              Torna o conteúdo ilegível sem a chave. Quem vê os dados sabe que há algo, mas não consegue lê-lo. O InvisioMZ usa as duas:
              cifra primeiro, esconde depois.
            </p>
          </article>
        </div>
      </section> */}

      {/* ───────── Avisos ───────── */}
      {/* <section aria-labelledby="avisos" className="space-y-4">
        <h2 id="avisos" className="text-3xl font-semibold">O que tem de saber</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Alert kind="info" title="A capacidade depende do tamanho da imagem">
            Com 1 bit por canal cabem <strong>largura × altura × 3 ÷ 8</strong> bytes. Uma imagem Full HD (1920 × 1080) guarda até{' '}
            <strong>{formatBytes(rawCapacityBytes(1920, 1080, 1))}</strong> ({formatInt(example)} B) em bruto; menos o cabeçalho e a sobrecarga.
            O limite aqui é de {formatInt(config.limits.max_image_pixels / 1_000_000)} megapíxeis.
          </Alert>
          <Alert kind="warn" title="LSB é detectável">
            Ferramentas de estegoanálise (qui-quadrado, RS) podem detectar alterações estatísticas. O InvisioMZ espalha e preenche os bits para
            reduzir padrões, mas <strong>LSB não é invisível</strong> para um perito.
          </Alert>
          <Alert kind="warn" title="O PNG tem de chegar intacto">
            JPG, redimensionar, recortar ou aplicações que recomprimem imagens (como o WhatsApp) destroem os dados. Partilhe como ficheiro.
          </Alert>
          <Alert kind="warn" title="Senha esquecida = dados perdidos">
            Não há recuperação possível. A senha mínima é de {config.limits.password_min_length} caracteres; prefira uma frase longa.
          </Alert>
        </div>
      </section> */}

      {/* ───────── Académico + estado ───────── */}
      {/* <section className="grid gap-4 md:grid-cols-[1.4fr_1fr]"> */}
        {/* <article className="card space-y-3 p-6">
          <div className="flex items-center gap-2 text-brand-strong">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            <h2 className="text-xl font-semibold text-ink">Contexto académico</h2>
          </div>
          <p className="text-sm text-ink-soft">
            Trabalho Prático de Segurança Informática: a Tarefa 1 usa ferramentas como Steghide e Stegosuite; a Tarefa 2, esta implementação
            própria em Python (LSB + AES-256-GCM + Scrypt). As ferramentas existentes são independentes do InvisioMZ e não estão integradas.
          </p>
          <Link to="/aprender" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-strong underline">
            Ler a fundamentação teórica <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </article> */}

        {/* <aside className="card space-y-3 p-6" aria-label="Estado do sistema" aria-live="polite">
          <h2 className="text-xl font-semibold">Estado do sistema</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between gap-3">
              <span className="text-ink-soft">Servidor</span>
              {health === null ? <Badge>a verificar…</Badge> : health === 'error' ? <Badge tone="danger">indisponível</Badge> : <Badge tone="success">operacional</Badge>}
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-ink-soft">Contas e histórico</span>
              {health === null ? (
                <Badge>a verificar…</Badge>
              ) : health === 'error' ? (
                <Badge tone="danger">indisponível</Badge>
              ) : health.supabase === 'ok' ? (
                <Badge tone="success">activos</Badge>
              ) : health.supabase === 'not_configured' ? (
                <Badge tone="warn">só modo convidado</Badge>
              ) : (
                <Badge tone="danger">sem ligação</Badge>
              )}
            </li>
            <li className="flex items-center justify-between gap-3">
              <span className="text-ink-soft">Versão</span>
              <span className="font-mono text-xs">{config.version}</span>
            </li>
          </ul>
        </aside> */}
      {/* </section> */}
    </div>
  )
}
