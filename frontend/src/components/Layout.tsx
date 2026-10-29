import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AppShell } from './AppShell'
import { PublicShell } from './PublicShell'
import { AuthShell } from './AuthShell'
import { Alert, Button } from './ui'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'

const AUTH_PATHS = ['/entrar', '/registar', '/recuperar-senha', '/redefinir-senha']

/** Escolhe a estrutura: área autenticada (menu lateral + painel) ou páginas públicas. */
export function Layout() {
  const { user } = useAuth()
  const { status, reload } = useConfig()
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    window.scrollTo({ top: 0 })
    mainRef.current?.focus({ preventScroll: true })
  }, [location.pathname])

  const isAuthPage = AUTH_PATHS.includes(location.pathname)
  const wide = isAuthPage ? 'max-w-md px-0' : user ? 'max-w-5xl px-4 sm:px-8' : 'max-w-6xl px-4 sm:px-6'
  const content = (
    <>
      {status === 'error' && (
        <div className={`mx-auto w-full pt-4 ${wide}`}>
          <Alert kind="warn" title="Servidor indisponível">
            <p>Não foi possível contactar o backend do InvisioMZ. Ocultar e extrair precisam dele.</p>
            <Button variant="secondary" className="mt-2 min-h-9 px-3 py-1.5" onClick={reload}>
              Tentar de novo
            </Button>
          </Alert>
        </div>
      )}
      <main id="conteudo" ref={mainRef} tabIndex={-1} className={`mx-auto w-full flex-1 py-8 outline-none sm:py-10 ${wide}`}>
        <Outlet />
      </main>
    </>
  )

  if (isAuthPage) return <AuthShell>{content}</AuthShell>
  return user ? <AppShell>{content}</AppShell> : <PublicShell>{content}</PublicShell>
}
