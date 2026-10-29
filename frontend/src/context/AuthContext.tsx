import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../services/supabase'
import { setTokenProvider, setUnauthorizedHandler } from '../services/api'

interface AuthValue {
  /** O Supabase está configurado neste frontend? */
  configured: boolean
  loading: boolean
  session: Session | null
  user: User | null
  /** true quando o utilizador abriu o link de recuperação de senha. */
  recovering: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName?: string) => Promise<{ needsEmailConfirmation: boolean }>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  resendConfirmation: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

function requireClient() {
  if (!supabase) throw new Error('As contas não estão configuradas neste ambiente.')
  return supabase
}

function translate(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login')) return 'Email ou senha incorretos.'
  if (m.includes('email not confirmed')) return 'Confirme o seu email antes de entrar (verifique a caixa de entrada).'
  if (m.includes('already registered') || m.includes('already been registered')) return 'Já existe uma conta com este email.'
  if (m.includes('password should be') || m.includes('weak')) return 'A senha é demasiado fraca. Use pelo menos 10 caracteres.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Demasiadas tentativas. Aguarde um pouco e tente de novo.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Não foi possível contactar o serviço de contas.'
  if (m.includes('same password')) return 'A nova senha tem de ser diferente da actual.'
  return message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState<boolean>(supabase !== null)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session)
        setLoading(false)
      }
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') setRecovering(false)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    setTokenProvider(async () => {
      if (!supabase) return null
      const { data } = await supabase.auth.getSession() // renova o token automaticamente se estiver a expirar
      return data.session?.access_token ?? null
    })
    // Se o backend rejeitar o token (expirado/revogado), termina a sessão local.
    setUnauthorizedHandler(() => {
      if (supabase) void supabase.auth.signOut({ scope: 'local' })
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await requireClient().auth.signInWithPassword({ email, password })
    if (error) throw new Error(translate(error.message))
  }, [])

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    const { data, error } = await requireClient().auth.signUp({
      email,
      password,
      options: { data: displayName ? { display_name: displayName } : undefined, emailRedirectTo: window.location.origin },
    })
    if (error) throw new Error(translate(error.message))
    return { needsEmailConfirmation: !data.session }
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await requireClient().auth.signOut()
    if (error) throw new Error(translate(error.message))
  }, [])

  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await requireClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    })
    if (error) throw new Error(translate(error.message))
  }, [])

  const resendConfirmation = useCallback(async (email: string) => {
    const { error } = await requireClient().auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) throw new Error(translate(error.message))
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await requireClient().auth.updateUser({ password })
    if (error) throw new Error(translate(error.message))
    setRecovering(false)
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      configured: supabase !== null,
      loading,
      session,
      user: session?.user ?? null,
      recovering,
      signIn,
      signUp,
      signOut,
      sendPasswordReset,
      resendConfirmation,
      updatePassword,
    }),
    [loading, session, recovering, signIn, signUp, signOut, sendPasswordReset, resendConfirmation, updatePassword],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora de AuthProvider')
  return ctx
}
