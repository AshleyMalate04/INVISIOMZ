import { formatBytes, formatPercent } from '../utils/format'

interface CapacityBarProps {
  used: number
  total: number
  /** Texto curto antes do valor (p. ex. «Conteúdo estimado»). */
  label?: string
}

export function CapacityBar({ used, total, label = 'Utilização da capacidade' }: CapacityBarProps) {
  const ratio = total > 0 ? used / total : used > 0 ? 2 : 0
  const pct = Math.min(ratio * 100, 100)
  const over = ratio > 1
  const tight = ratio > 0.9 && !over
  const tone = over ? 'bg-danger' : tight ? 'bg-warn' : 'bg-brand'
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className={`tabular-nums ${over ? 'font-semibold text-danger' : 'text-ink-soft'}`}>
          {formatBytes(used)} de {formatBytes(total)} · {formatPercent(ratio * 100, ratio < 0.1 && ratio > 0 ? 1 : 0)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={`${formatBytes(used)} de ${formatBytes(total)} (${Math.round(ratio * 100)} %)`}
        className="h-3 overflow-hidden rounded-full bg-line"
      >
        <div className={`h-full rounded-full transition-[width] duration-500 ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {over && (
        <p role="alert" className="text-xs font-medium text-danger">
          O conteúdo excede a capacidade útil. Reduza o conteúdo, escolha uma imagem maior ou use 2 bits por canal.
        </p>
      )}
    </div>
  )
}
