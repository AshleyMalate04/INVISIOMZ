import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemeMode } from '../context/ThemeContext'

const NEXT_THEME: Record<ThemeMode, ThemeMode> = { light: 'dark', dark: 'system', system: 'light' }
const THEME_LABEL: Record<ThemeMode, string> = { light: 'Tema claro', dark: 'Tema escuro', system: 'Tema do sistema' }

export function ThemeToggle() {
  const { mode, setMode } = useTheme()
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor
  return (
    <button
      type="button"
      onClick={() => setMode(NEXT_THEME[mode])}
      className="grid h-10 w-10 place-items-center rounded-xl text-ink-soft hover:bg-surface-2 hover:text-ink"
      aria-label={`${THEME_LABEL[mode]}. Mudar para ${THEME_LABEL[NEXT_THEME[mode]].toLowerCase()}`}
      title={THEME_LABEL[mode]}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  )
}
