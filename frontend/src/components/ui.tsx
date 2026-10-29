import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { AlertTriangle, Check, CheckCircle2, Copy, Info, Loader2, XCircle } from 'lucide-react'
import { Link, type LinkProps } from 'react-router-dom'

/* ───────────────────────────── Botões ───────────────────────────── */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-on-brand shadow-[0_6px_18px_-8px_var(--brand)] hover:bg-brand-hover disabled:bg-line-strong disabled:text-ink-soft disabled:shadow-none',
  secondary:
    'border border-line-strong bg-surface text-ink hover:bg-surface-2 disabled:text-ink-soft disabled:opacity-60',
  ghost: 'text-ink-soft hover:bg-surface-2 hover:text-ink disabled:opacity-50',
  danger: 'bg-danger text-white hover:brightness-110 disabled:opacity-50 dark:text-[#1a0e05]',
}
const BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
}
export function Button({ variant = 'primary', loading, disabled, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE} ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function LinkButton({
  variant = 'primary',
  className = '',
  ...rest
}: LinkProps & { variant?: Variant; className?: string }) {
  return <Link {...rest} className={`${BASE} ${VARIANTS[variant]} ${className}`} />
}

/* ───────────────────────────── Campos ───────────────────────────── */
interface FieldShellProps {
  id: string
  label: string
  hint?: ReactNode
  error?: string | null
  children: ReactNode
  optional?: boolean
}
function FieldShell({ id, label, hint, error, children, optional }: FieldShellProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between text-sm font-medium text-ink">
        <span>{label}</span>
        {optional && <span className="text-xs font-normal text-ink-soft">opcional</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-ink-soft">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="flex items-start gap-1.5 text-xs font-medium text-danger">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}

const INPUT =
  'block w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-soft/70 transition-colors focus:border-brand disabled:opacity-60 aria-[invalid=true]:border-danger'

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: ReactNode
  error?: string | null
  optional?: boolean
  suffix?: ReactNode
}
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, optional, suffix, className = '', id, ...rest },
  ref,
) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} optional={optional}>
      <div className="relative">
        <input
          ref={ref}
          id={fid}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined}
          className={`${INPUT} ${suffix ? 'pr-12' : ''} ${className}`}
          {...rest}
        />
        {suffix && <div className="absolute inset-y-0 right-1 flex items-center">{suffix}</div>}
      </div>
    </FieldShell>
  )
})

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  hint?: ReactNode
  error?: string | null
  optional?: boolean
}
export function TextArea({ label, hint, error, optional, className = '', id, ...rest }: TextAreaProps) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <FieldShell id={fid} label={label} hint={hint} error={error} optional={optional}>
      <textarea
        id={fid}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined}
        className={`${INPUT} min-h-32 resize-y ${className}`}
        {...rest}
      />
    </FieldShell>
  )
}

/* ───────────────────────────── Avisos ───────────────────────────── */
type AlertKind = 'info' | 'warn' | 'error' | 'success'
const ALERT: Record<AlertKind, { cls: string; Icon: typeof Info }> = {
  info: { cls: 'border-line-strong bg-surface-2 text-ink', Icon: Info },
  warn: { cls: 'border-warn/40 bg-warn-soft text-ink', Icon: AlertTriangle },
  error: { cls: 'border-danger/40 bg-danger-soft text-ink', Icon: XCircle },
  success: { cls: 'border-success/40 bg-success-soft text-ink', Icon: CheckCircle2 },
}
const ALERT_ICON: Record<AlertKind, string> = {
  info: 'text-brand-strong',
  warn: 'text-warn',
  error: 'text-danger',
  success: 'text-success',
}

export function Alert({
  kind = 'info',
  title,
  children,
  className = '',
}: {
  kind?: AlertKind
  title?: string
  children?: ReactNode
  className?: string
}) {
  const { cls, Icon } = ALERT[kind]
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-xl border p-4 text-sm ${cls} ${className}`}>
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${ALERT_ICON[kind]}`} aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink-soft [&_strong]:text-ink">{children}</div>}
      </div>
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-ink-soft" role="status">
      <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'success' | 'danger' | 'warn' }) {
  const tones = {
    neutral: 'bg-surface-2 text-ink-soft border-line',
    brand: 'bg-brand-soft text-brand-strong border-brand/30',
    success: 'bg-success-soft text-success border-success/30',
    danger: 'bg-danger-soft text-danger border-danger/30',
    warn: 'bg-warn-soft text-warn border-warn/30',
  }
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-surface-2/50 px-6 py-12 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand-strong">{icon}</div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <div className="max-w-md text-sm text-ink-soft">{children}</div>}
      {action}
    </div>
  )
}

/* ───────────────────────────── Copiar ───────────────────────────── */
export function CopyButton({ text, label = 'Copiar', className = '' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button variant="secondary" onClick={copy} className={`min-h-9 px-3 py-1.5 ${className}`}>
      {copied ? <Check className="h-4 w-4 text-success" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      <span aria-live="polite">{copied ? 'Copiado' : label}</span>
    </Button>
  )
}
