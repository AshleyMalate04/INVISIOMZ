import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { PasswordField } from '../components/PasswordField'
import { Alert, Button, TextField } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { useToast } from '../context/ToastContext'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function Unavailable() {
  return (
    <Alert kind="info" title="Contas indisponíveis neste ambiente">
      O Supabase não está configurado. Pode usar «Ocultar» e «Extrair» em modo convidado, sem conta.
    </Alert>
  )
}

function useAccounts() {
  const { configured } = useAuth()
  const { status, accountsAvailable } = useConfig()
  return { available: configured && (status === 'loading' || accountsAvailable) }
}

/* ───────────────────────── Entrar ───────────────────────── */
export function LoginPage() {
  const { signIn, user, resendConfirmation } = useAuth()
  const { available } = useAccounts()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [resending, setResending] = useState(false)
  const from = (location.state as { from?: string } | null)?.from ?? '/painel'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={from} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (!EMAIL_RE.test(email.trim())) next.email = 'Indique um email válido.'
    if (!password) next.password = 'Indique a senha.'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      toast.success('Sessão iniciada.')
      navigate(from, { replace: true })
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Não foi possível entrar.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader eyebrow="Conta" title="Bem vindo de Volta!">
        {/* <p>Inicie sessão para aceder ao seu painel: ocultar, extrair e consultar o histórico das suas operações.</p> */}
      </PageHeader>
      {!available ? (
        <Unavailable />
      ) : (
        <form onSubmit={submit} noValidate className="card space-y-5 p-6 sm:p-8">
          {errors.form && (
            <Alert kind="error">
              <p>{errors.form}</p>
              {errors.form.startsWith('Confirme o seu email') && EMAIL_RE.test(email.trim()) && (
                <Button
                  variant="secondary"
                  className="mt-2 min-h-9 px-3 py-1.5"
                  loading={resending}
                  onClick={async () => {
                    setResending(true)
                    try {
                      await resendConfirmation(email.trim())
                      toast.success('Enviámos um novo email de confirmação.')
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Não foi possível reenviar o email.')
                    } finally {
                      setResending(false)
                    }
                  }}
                >
                  Reenviar email de confirmação
                </Button>
              )}
            </Alert>
          )}
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
          <PasswordField label="Senha" value={password} onChange={setPassword} autoComplete="current-password" error={errors.password} />
          <Button type="submit" loading={busy} className="w-full">
            Entrar
          </Button>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <Link to="/recuperar-senha" className="font-medium text-brand-strong underline">
              Esqueci-me da senha
            </Link>
            <Link to="/registar" className="font-medium text-brand-strong underline">
              Criar conta
            </Link>
          </div>
        </form>
      )}
    </div>
  )
}

/* ───────────────────────── Registar ───────────────────────── */
export function RegisterPage() {
  const { signUp, user } = useAuth()
  const { config } = useConfig()
  const { available } = useAccounts()
  const toast = useToast()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirm?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const min = config.limits.password_min_length

  if (user && !pendingEmail) return <Navigate to="/painel" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (!EMAIL_RE.test(email.trim())) next.email = 'Indique um email válido.'
    if (password.length < min) next.password = `A senha deve ter pelo menos ${min} caracteres.`
    if (confirm !== password) next.confirm = 'As senhas não coincidem.'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      const { needsEmailConfirmation } = await signUp(email.trim(), password, name.trim() || undefined)
      if (needsEmailConfirmation) setPendingEmail(email.trim())
      else {
        toast.success('Conta criada. Bem-vindo(a)!')
        navigate('/painel', { replace: true })
      }
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Não foi possível criar a conta.' })
    } finally {
      setBusy(false)
    }
  }

  if (pendingEmail)
    return (
      <div className="mx-auto max-w-md">
        <Alert kind="success" title="Verifique o seu email">
          <p>
            Enviámos uma ligação de confirmação para <strong>{pendingEmail}</strong>. Abra-a para activar a conta e depois{' '}
            <Link to="/entrar" className="font-semibold text-brand-strong underline">entre</Link>.
          </p>
        </Alert>
      </div>
    )

  return (
    <div className="mx-auto max-w-md">
      <PageHeader eyebrow="Conta" title="Criar conta">
        {/* <p>É preciso uma conta para usar o InvisioMZ. A senha da conta é diferente da senha de ocultação, que nunca guardamos.</p> */}
      </PageHeader>
      {!available ? (
        <Unavailable />
      ) : (
        <form onSubmit={submit} noValidate className="card space-y-5 p-6 sm:p-8">
          {errors.form && <Alert kind="error">{errors.form}</Alert>}
          <TextField label="Nome" optional autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
          <PasswordField label="Senha" value={password} onChange={setPassword} showStrength minLength={min} error={errors.password} hint={`Mínimo ${min} caracteres.`} />
          <PasswordField label="Confirmar senha" value={confirm} onChange={setConfirm} error={errors.confirm} />
          <Button type="submit" loading={busy} className="w-full">
            Criar conta
          </Button>
          <p className="text-center text-sm text-ink-soft">
            Já tem conta?{' '}
            <Link to="/entrar" className="font-medium text-brand-strong underline">
              Entrar
            </Link>
          </p>
        </form>
      )}
    </div>
  )
}

/* ───────────────────────── Recuperar senha ───────────────────────── */
export function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth()
  const { available } = useAccounts()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!EMAIL_RE.test(email.trim())) return setError('Indique um email válido.')
    setError(null)
    setBusy(true)
    try {
      await sendPasswordReset(email.trim())
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar o email.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader eyebrow="Conta" title="Recuperar senha da conta">
        <p>Esta recuperação é só para a <strong>conta</strong>. A senha usada para esconder dados numa imagem não pode ser recuperada.</p>
      </PageHeader>
      {!available ? (
        <Unavailable />
      ) : sent ? (
        <Alert kind="success" title="Email enviado">
          Se existir uma conta com <strong>{email}</strong>, receberá uma ligação para definir uma nova senha.
        </Alert>
      ) : (
        <form onSubmit={submit} noValidate className="card space-y-5 p-6 sm:p-8">
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
          <Button type="submit" loading={busy} className="w-full">
            <Mail className="h-4 w-4" aria-hidden="true" /> Enviar ligação
          </Button>
          <p className="text-center text-sm">
            <Link to="/entrar" className="font-medium text-brand-strong underline">
              Voltar a entrar
            </Link>
          </p>
        </form>
      )}
    </div>
  )
}

/* ───────────────────────── Nova senha (link do email) ───────────────────────── */
export function ResetPasswordPage() {
  const { recovering, user, updatePassword } = useAuth()
  const { config } = useConfig()
  const toast = useToast()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const min = config.limits.password_min_length

  if (!recovering && !user)
    return (
      <div className="mx-auto max-w-md">
        <Alert kind="warn" title="Ligação inválida ou expirada">
          Peça uma nova ligação em <Link to="/recuperar-senha" className="font-semibold text-brand-strong underline">Recuperar senha</Link>.
        </Alert>
      </div>
    )

  async function submit(e: FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (password.length < min) next.password = `A senha deve ter pelo menos ${min} caracteres.`
    if (confirm !== password) next.confirm = 'As senhas não coincidem.'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await updatePassword(password)
      toast.success('Senha actualizada.')
      navigate('/painel', { replace: true })
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Não foi possível actualizar a senha.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader eyebrow="Conta" title="Definir nova senha" />
      <form onSubmit={submit} noValidate className="card space-y-5 p-6 sm:p-8">
        {errors.form && <Alert kind="error">{errors.form}</Alert>}
        <PasswordField label="Nova senha" value={password} onChange={setPassword} showStrength minLength={min} error={errors.password} />
        <PasswordField label="Confirmar nova senha" value={confirm} onChange={setConfirm} error={errors.confirm} />
        <Button type="submit" loading={busy} className="w-full">
          Guardar nova senha
        </Button>
      </form>
    </div>
  )
}
