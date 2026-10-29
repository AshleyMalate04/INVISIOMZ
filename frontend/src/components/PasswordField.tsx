import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { TextField } from './ui'
import { passwordStrength } from '../utils/password'

interface PasswordFieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  error?: string | null
  hint?: string
  autoComplete?: string
  showStrength?: boolean
  minLength?: number
  id?: string
  placeholder?: string
}

export function PasswordField({
  label,
  value,
  onChange,
  error,
  hint,
  autoComplete = 'new-password',
  showStrength,
  minLength = 10,
  id,
  placeholder,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="space-y-2">
      <TextField
        id={id}
        label={label}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
        hint={hint}
        autoComplete={autoComplete}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        suffix={
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="grid h-9 w-9 place-items-center rounded-lg text-ink-soft hover:bg-surface-2 hover:text-ink"
            aria-label={visible ? 'Esconder senha' : 'Mostrar senha'}
            aria-pressed={visible}
          >
            {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        }
      />
      {showStrength && <StrengthMeter password={value} minLength={minLength} />}
    </div>
  )
}

const COLORS = ['bg-danger', 'bg-danger', 'bg-warn', 'bg-success', 'bg-success']

export function StrengthMeter({ password, minLength = 10 }: { password: string; minLength?: number }) {
  const s = passwordStrength(password, minLength)
  if (!password) return null
  return (
    <div aria-live="polite" className="space-y-1.5">
      <div className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i < Math.max(s.score, 1) ? COLORS[s.score] : 'bg-line'}`} />
        ))}
      </div>
      <p className="text-xs text-ink-soft">
        Força: <strong className="text-ink">{s.label}</strong>
        {s.hints[0] ? ` · ${s.hints[0]}` : ''}
      </p>
    </div>
  )
}
