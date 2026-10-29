import { useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { EyeOff, History, LayoutDashboard, LogOut, Menu, Settings, Unlock, X, type LucideIcon } from 'lucide-react'
import { Logo } from './Logo'
import { ThemeToggle } from './ThemeToggle'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

const NAV: { to: string; label: string; Icon: LucideIcon }[] = [
  { to: '/painel', label: 'Painel', Icon: LayoutDashboard },
  { to: '/ocultar', label: 'Ocultar', Icon: EyeOff },
  { to: '/extrair', label: 'Extrair', Icon: Unlock },
  { to: '/historico', label: 'Histórico', Icon: History },
  // { to: '/aprender', label: 'Aprender', Icon: BookOpen }, // «Aprender» desligado de propósito (importar BookOpen ao reactivar)
  { to: '/definicoes', label: 'Definições', Icon: Settings },
]

const itemCls = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-soft text-brand-strong' : 'text-ink-soft hover:bg-surface-2 hover:text-ink'
  }`

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="space-y-1">
      {NAV.map(({ to, label, Icon }) => (
        <li key={to}>
          <NavLink to={to} className={itemCls} onClick={onNavigate}>
            <Icon className="h-[1.15rem] w-[1.15rem] shrink-0" aria-hidden="true" />
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}

function useSignOut() {
  const { signOut } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  return async () => {
    try {
      navigate('/', { replace: true })
      await signOut()
      toast.info('Sessão terminada.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível terminar a sessão.')
    }
  }
}

/** Estrutura da área autenticada: menu lateral (ecrãs largos) ou menu em gaveta (telemóvel). */
export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const signOut = useSignOut()
  const location = useLocation()
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const menuOpen = menuPath === location.pathname

  const account = (
    <div className="space-y-2 border-t border-line pt-4">
      <p className="truncate px-1 text-xs text-ink-soft" title={user?.email ?? ''}>
        Sessão iniciada como
        <span className="block truncate text-sm font-medium text-ink">{user?.email}</span>
      </p>
      <button
        type="button"
        onClick={signOut}
        className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-ink-soft hover:bg-danger-soft hover:text-danger"
      >
        <LogOut className="h-[1.15rem] w-[1.15rem]" aria-hidden="true" /> Terminar sessão
      </button>
    </div>
  )

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-lg bg-brand px-4 py-2 font-semibold text-on-brand focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Saltar para o conteúdo
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col justify-between border-r border-line bg-surface/70 p-5 lg:flex">
        <div className="space-y-8">
          <Link to="/painel" aria-label="InvisioMZ — painel" className="block px-1 pt-1">
            <Logo size={36} />
          </Link>
          <nav aria-label="Principal">
            <NavList />
          </nav>
        </div>
        {account}
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-8">
            <Link to="/painel" aria-label="InvisioMZ — painel" className="lg:hidden">
              <Logo size={32} />
            </Link>
            <p className="hidden text-sm text-ink-soft lg:block">
              Olá, <span className="font-medium text-ink">{user?.user_metadata?.display_name || user?.email}</span>
            </p>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <button
                type="button"
                className="grid h-10 w-10 place-items-center rounded-xl text-ink hover:bg-surface-2 lg:hidden"
                aria-expanded={menuOpen}
                aria-controls="menu-movel"
                aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
                onClick={() => setMenuPath(menuOpen ? null : location.pathname)}
              >
                {menuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
              </button>
            </div>
          </div>
          {menuOpen && (
            <nav id="menu-movel" aria-label="Principal (telemóvel)" className="space-y-4 border-t border-line bg-bg px-4 py-4 lg:hidden">
              <NavList />
              {account}
            </nav>
          )}
        </header>

        {children}
      </div>
    </div>
  )
}
