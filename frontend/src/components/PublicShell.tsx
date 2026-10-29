import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { Logo } from './Logo'
import { ThemeToggle } from './ThemeToggle'
// import { useState } from 'react'            // só era usado pelo menu móvel
// import { Menu, X } from 'lucide-react'      // idem
// import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'

const navCls = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-soft text-brand-strong' : 'text-ink-soft hover:bg-surface-2 hover:text-ink'
  }`

/**
 * Cabeçalho para quem ainda não iniciou sessão. Só há uma página pública (Início), por isso não há botão «Início»;
 * «Aprender», «Criar conta» (no cabeçalho) e o rodapé estão comentados. Os links só aparecem com o modo convidado.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const { accountsAvailable, config } = useConfig()
  const { loading } = useAuth()

  const links = [
    // { to: '/', label: 'Início', end: true },
    ...(config.guest_allowed
      ? [
          { to: '/ocultar', label: 'Ocultar', end: false },
          { to: '/extrair', label: 'Extrair', end: false },
        ]
      : []),
    // { to: '/aprender', label: 'Aprender', end: false },
  ]

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-lg bg-brand px-4 py-2 font-semibold text-on-brand focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Saltar para o conteúdo
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/" aria-label="InvisioMZ — página inicial" className="shrink-0">
            <Logo size={34} />
          </Link>

          {links.length > 0 && (
            <nav aria-label="Principal" className="flex items-center gap-1">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className={navCls}>
                  {l.label}
                </NavLink>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-1">
            <ThemeToggle />
            {accountsAvailable && !loading && (
              <>
                {/* <Link to="/registar" className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold text-ink-soft hover:bg-surface-2 hover:text-ink">
                  Criar conta
                </Link> */}
                <Link
                  to="/entrar"
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-on-brand hover:bg-brand-hover"
                >
                  <LogIn className="h-4 w-4" aria-hidden="true" /> Entrar
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {children}

      {/* Rodapé desligado de propósito. Para o reactivar, descomente este bloco (e o import do Logo já existe).
      <footer className="border-t border-line bg-bg-deep/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-ink-soft sm:px-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md space-y-2">
            <Logo size={28} />
            <p>
              Projecto académico de Segurança Informática. LSB + AES-256-GCM implementados de raiz em Python. LSB é detectável
              por estegoanálise: não use como única protecção para segredos reais.
            </p>
          </div>
          <nav aria-label="Rodapé" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link to="/aprender" className="hover:text-brand-strong hover:underline">Como funciona</Link>
            {accountsAvailable && <Link to="/entrar" className="hover:text-brand-strong hover:underline">Entrar</Link>}
          </nav>
        </div>
      </footer>
      */}
    </div>
  )
}
