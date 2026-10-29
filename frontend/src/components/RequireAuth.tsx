import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { Alert, Spinner } from './ui'

/**
 * Protege a área autenticada. Sem sessão redireciona para «Entrar», excepto nas páginas marcadas com
 * `guestOk` (Ocultar/Extrair) quando o servidor tem o modo convidado ligado (`ALLOW_GUEST=true`).
 */
export function RequireAuth({ children, guestOk = false }: { children: ReactNode; guestOk?: boolean }) {
  const { user, loading, configured } = useAuth()
  const { status, accountsAvailable, config } = useConfig()
  const location = useLocation()

  if (loading || status === 'loading') return <Spinner label="A verificar a sessão…" />
  if (user) return <>{children}</>
  if (guestOk && config.guest_allowed) return <>{children}</>

  if (!configured || !accountsAvailable) {
    return (
      <Alert kind="info" title="Contas indisponíveis neste ambiente">
        <p>
          O Supabase não está configurado, por isso não é possível iniciar sessão. Configure-o (ver README) ou, só em desenvolvimento, ligue
          o modo convidado com <code>ALLOW_GUEST=true</code> no backend.
        </p>
      </Alert>
    )
  }
  return <Navigate to="/entrar" replace state={{ from: location.pathname }} />
}
