import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Clock, EyeOff, FileArchive, History as HistoryIcon, KeyRound, ShieldCheck, Unlock, type LucideIcon } from 'lucide-react'
import { Alert, Badge, Button, EmptyState, Spinner } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { api } from '../services/api'
import type { DashboardData, HistoryItem } from '../types'
import { describeError, type FriendlyError } from '../utils/errors'
import { formatBytes, formatDateTime, formatInt, formatPercent } from '../utils/format'

function StatCard({ label, value, hint, Icon }: { label: string; value: ReactNode; hint?: ReactNode; Icon: LucideIcon }) {
  return (
    <div className="card space-y-3 p-5">
      <div className="flex items-center justify-between text-ink-soft">
        <span className="text-sm font-medium">{label}</span>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-soft text-brand-strong">
          <Icon className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
        </span>
      </div>
      <p className="font-display text-4xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
    </div>
  )
}

function ActionCard({ to, title, text, Icon }: { to: string; title: string; text: string; Icon: LucideIcon }) {
  return (
    <Link
      to={to}
      className="card group flex items-start gap-4 p-5 transition-colors hover:border-brand/60 hover:bg-surface-2"
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand text-on-brand shadow-[0_6px_18px_-8px_var(--brand)]">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2 text-lg font-semibold">
          {title}
          <ArrowRight className="h-4 w-4 text-ink-soft transition-transform group-hover:translate-x-1 group-hover:text-brand-strong" aria-hidden="true" />
        </span>
        <span className="mt-1 block text-sm text-ink-soft">{text}</span>
      </span>
    </Link>
  )
}

/** Gráfico de barras empilhadas (CSS puro) com tabela equivalente para leitores de ecrã. */
function ActivityChart({ days }: { days: DashboardData['last_7_days'] }) {
  const max = Math.max(1, ...days.map((d) => d.hide + d.extract))
  const weekday = (iso: string) => new Intl.DateTimeFormat('pt-MZ', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))
  const total = days.reduce((n, d) => n + d.hide + d.extract, 0)
  return (
    <div>
      <div className="flex h-40 items-end gap-2 sm:gap-3" role="img" aria-label={`Operações nos últimos 7 dias: ${total} no total`}>
        {days.map((d) => {
          const sum = d.hide + d.extract
          return (
            <div key={d.date} className="flex h-full flex-1 flex-col justify-end gap-1" title={`${d.date}: ${d.hide} ocultar, ${d.extract} extrair`}>
              <span className="text-center text-xs tabular-nums text-ink-soft">{sum || ''}</span>
              <div className="flex w-full flex-col justify-end overflow-hidden rounded-lg bg-line/60" style={{ height: `${(sum / max) * 100}%`, minHeight: sum ? 6 : 3 }}>
                <div className="bg-brand-strong/70" style={{ flex: d.extract }} />
                <div className="bg-brand" style={{ flex: d.hide }} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex gap-2 text-center text-xs text-ink-soft sm:gap-3" aria-hidden="true">
        {days.map((d) => (
          <span key={d.date} className="flex-1 capitalize">
            {weekday(d.date)}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-soft" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand" /> Ocultar</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-strong/70" /> Extrair</span>
      </div>
      <table className="sr-only">
        <caption>Operações por dia</caption>
        <thead><tr><th scope="col">Dia</th><th scope="col">Ocultar</th><th scope="col">Extrair</th></tr></thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}><th scope="row">{d.date}</th><td>{d.hide}</td><td>{d.extract}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RecentRow({ item }: { item: HistoryItem }) {
  const Icon = item.type === 'hide' ? EyeOff : Unlock
  return (
    <li className="flex items-center gap-3 py-3 text-sm">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-brand-strong">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{item.type === 'hide' ? 'Ocultar' : 'Extrair'}</p>
        <p className="text-xs text-ink-soft tabular-nums">
          {formatDateTime(item.created_at)}
          {item.bits_per_channel ? ` · ${item.bits_per_channel} ${item.bits_per_channel === 1 ? 'bit' : 'bits'}` : ''}
        </p>
      </div>
      {item.status === 'success' ? <Badge tone="success">Sucesso</Badge> : <Badge tone="danger">Falhou</Badge>}
    </li>
  )
}

const TIPS = [
  { Icon: KeyRound, text: 'Use uma frase longa como senha. A senha nunca é guardada: se a esquecer, os dados perdem-se.' },
  { Icon: FileArchive, text: 'Envie o PNG como documento/anexo. Apps que recomprimem imagens (WhatsApp) destroem os dados escondidos.' },
  { Icon: ShieldCheck, text: 'LSB é detectável por estegoanálise. A cifra AES-256-GCM é o que protege o conteúdo.' },
]

export function DashboardPage() {
  const { user } = useAuth()
  const { config } = useConfig()
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.dashboard())
    } catch (e) {
      setError(describeError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Carrega os dados do servidor ao abrir a página.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const name = (user?.user_metadata?.display_name as string | undefined) || user?.email?.split('@')[0] || ''
  const successRate = data && data.totals.operations > 0 ? (data.totals.success / data.totals.operations) * 100 : null

  return (
    <div className="space-y-8">
      <header className="rise space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-strong">Painel</p>
        <h1 className="text-3xl font-semibold sm:text-4xl">Olá, {name}</h1>
        <p className="text-ink-soft">O que quer fazer hoje?</p>
      </header>

      <section aria-label="Atalhos" className="grid gap-4 md:grid-cols-2">
        <ActionCard to="/ocultar" title="Ocultar informação" text="Esconda uma mensagem e/ou ficheiros dentro de uma imagem PNG, cifrados com AES-256-GCM." Icon={EyeOff} />
        <ActionCard to="/extrair" title="Extrair informação" text="Recupere o conteúdo de um PNG do InvisioMZ com a senha certa." Icon={Unlock} />
      </section>

      {loading && !data && <Spinner label="A carregar o resumo…" />}
      {error && (
        <Alert kind="error" title={error.title}>
          <p>{error.message}</p>
          <Button variant="secondary" className="mt-2 min-h-9 px-3 py-1.5" onClick={load}>
            Tentar de novo
          </Button>
        </Alert>
      )}

      {data && (
        <>
          <section aria-label="Resumo" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Operações" value={formatInt(data.totals.operations)} Icon={HistoryIcon} hint={data.truncated ? 'Últimas 1 000 operações' : 'Desde que criou a conta'} />
            <StatCard label="Ocultações" value={formatInt(data.totals.hide)} Icon={EyeOff} hint="Imagens criadas" />
            <StatCard label="Extracções" value={formatInt(data.totals.extract)} Icon={Unlock} hint="Tentativas de abrir imagens" />
            <StatCard
              label="Taxa de sucesso"
              value={successRate === null ? '—' : formatPercent(successRate)}
              Icon={ShieldCheck}
              hint={data.totals.failed ? `${formatInt(data.totals.failed)} ${data.totals.failed === 1 ? 'falhou' : 'falharam'} (p. ex. senha errada)` : 'Sem falhas'}
            />
          </section>

          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <section className="card space-y-4 p-6" aria-labelledby="actividade">
              <h2 id="actividade" className="text-xl font-semibold">Actividade · últimos 7 dias</h2>
              {data.totals.operations === 0 ? (
                <p className="py-10 text-center text-sm text-ink-soft">Ainda não há actividade. Comece por esconder uma mensagem.</p>
              ) : (
                <ActivityChart days={data.last_7_days} />
              )}
            </section>

            <section className="card space-y-4 p-6" aria-labelledby="guardados">
              <h2 id="guardados" className="text-xl font-semibold">PNG guardados</h2>
              <p className="font-display text-4xl font-semibold tabular-nums">{formatInt(data.saved.count)}</p>
              <p className="text-sm text-ink-soft">
                {data.saved.count === 0 ? 'Nenhum ficheiro guardado.' : <>Ocupam <strong className="text-ink">{formatBytes(data.saved.bytes)}</strong> no armazenamento privado.</>}
              </p>
              {data.saved.expiring_soon > 0 && (
                <p className="flex items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm">
                  <Clock className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                  {data.saved.expiring_soon} {data.saved.expiring_soon === 1 ? 'expira' : 'expiram'} nas próximas 24 h
                </p>
              )}
              <p className="text-xs text-ink-soft">Os ficheiros guardados são apagados ao fim de {config.record_ttl_days} dias.</p>
              <Link to="/historico" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-strong underline">
                Gerir no histórico <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </section>
          </div>

          <section className="card p-6" aria-labelledby="recentes">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 id="recentes" className="text-xl font-semibold">Actividade recente</h2>
              {data.recent.length > 0 && (
                <Link to="/historico" className="text-sm font-semibold text-brand-strong underline">
                  Ver tudo
                </Link>
              )}
            </div>
            {data.recent.length === 0 ? (
              <EmptyState icon={<HistoryIcon className="h-7 w-7" aria-hidden="true" />} title="Sem operações ainda">
                As suas operações aparecem aqui (só metadados: nunca senhas, mensagens ou nomes de ficheiros).
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {data.recent.map((it) => (
                  <RecentRow key={it.id} item={it} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section aria-labelledby="dicas" className="space-y-3">
        <h2 id="dicas" className="text-xl font-semibold">Boas práticas</h2>
        <ul className="grid gap-3 md:grid-cols-3">
          {TIPS.map(({ Icon, text }) => (
            <li key={text} className="flex gap-3 rounded-2xl border border-line bg-surface-2/50 p-4 text-sm text-ink-soft">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-strong" aria-hidden="true" />
              {text}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
