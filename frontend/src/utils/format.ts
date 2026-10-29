const nf = (digits: number) =>
  new Intl.NumberFormat('pt-MZ', { minimumFractionDigits: 0, maximumFractionDigits: digits })

/** 1536 -> «1,5 KB». Unidades B, KB, MB, GB (base 1024), 1–2 casas decimais. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${nf(0).format(bytes)} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const digits = value >= 100 ? 1 : 2
  return `${nf(digits).format(Number(value.toFixed(digits)))} ${units[i]}`
}

export function formatPercent(value: number, digits = 0): string {
  return `${nf(digits).format(value)} %`
}

/** «2,4 MB → 5,1 MB (+112 %)» */
export function formatSizeChange(before: number, after: number): string {
  const pct = before > 0 ? ((after - before) / before) * 100 : 0
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : ''
  return `${formatBytes(before)} → ${formatBytes(after)} (${sign}${nf(0).format(Math.abs(Math.round(pct)))} %)`
}

export function formatSignedBytes(before: number, after: number): string {
  const d = after - before
  const sign = d > 0 ? '+' : d < 0 ? '−' : ''
  return `${sign}${formatBytes(Math.abs(d))}`
}

export function formatInt(n: number): string {
  return nf(0).format(n)
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-MZ', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${nf(1).format(ms / 1000)} s`
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

export function stem(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}
