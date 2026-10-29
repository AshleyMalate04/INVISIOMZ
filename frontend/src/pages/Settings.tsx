import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Monitor, Moon, Sun, Trash2 } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { ConfirmDialog } from '../components/Dialog'
import { Alert, Button, TextField } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { useTheme, type ThemeMode } from '../context/ThemeContext'
import { useToast } from '../context/ToastContext'
import { api } from '../services/api'
import { supabase } from '../services/supabase'
import { describeError } from '../utils/errors'

const CONFIRM_WORD = 'ELIMINAR'

const THEMES: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: 'light', label: 'Claro', Icon: Sun },
  { mode: 'dark', label: 'Escuro', Icon: Moon },
  { mode: 'system', label: 'Sistema', Icon: Monitor },
]

export function SettingsPage() {
  const { user, signOut } = useAuth()
  const { config } = useConfig()
  const { mode, setMode } = useTheme()
  const toast = useToast()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [nameLoaded, setNameLoaded] = useState(false)
  const [savingName, setSavingName] = useState(false)
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!supabase || !user) return
    let active = true
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        setName(data?.display_name ?? '')
        setNameLoaded(true)
      })
    return () => {
      active = false
    }
  }, [user])

  async function saveName(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !user) return
    setSavingName(true)
    const { error } = await supabase.from('profiles').update({ display_name: name.trim() || null }).eq('id', user.id)
    setSavingName(false)
    if (error) toast.error('Não foi possível guardar o nome.')
    else toast.success('Nome actualizado.')
  }

  async function deleteAccount() {
    setDeleting(true)
    try {
      await api.deleteAccount()
      setOpen(false)
      navigate('/', { replace: true }) // sai da página protegida antes de a sessão terminar
      try {
        await signOut()
      } catch {
        /* o utilizador já não existe no servidor: a sessão local é limpa na mesma */
      }
      toast.success('Conta e dados eliminados.')
    } catch (e) {
      toast.error(describeError(e).message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader eyebrow="A sua conta" title="Definições" />

      <div className="space-y-6">
        <section className="card space-y-4 p-6" aria-labelledby="perfil">
          <h2 id="perfil" className="text-xl font-semibold">Perfil</h2>
          <dl className="text-sm">
            <dt className="text-xs uppercase tracking-wide text-ink-soft">Email</dt>
            <dd className="font-medium">{user?.email}</dd>
          </dl>
          <form onSubmit={saveName} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <TextField label="Nome a mostrar" optional maxLength={80} value={name} onChange={(e) => setName(e.target.value)} disabled={!nameLoaded} />
            </div>
            <Button type="submit" variant="secondary" loading={savingName} disabled={!nameLoaded}>
              Guardar
            </Button>
          </form>
        </section>

        <section className="card space-y-4 p-6" aria-labelledby="aparencia">
          <h2 id="aparencia" className="text-xl font-semibold">Aparência</h2>
          <fieldset>
            <legend className="sr-only">Tema</legend>
            <div className="grid grid-cols-3 gap-3">
              {THEMES.map(({ mode: m, label, Icon }) => (
                <label
                  key={m}
                  className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-glow ${
                    mode === m ? 'border-brand bg-brand-soft text-brand-strong' : 'border-line-strong bg-surface hover:bg-surface-2'
                  }`}
                >
                  <input type="radio" name="tema" className="sr-only" checked={mode === m} onChange={() => setMode(m)} />
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="card space-y-4 border-danger/30 p-6" aria-labelledby="perigo">
          <h2 id="perigo" className="text-xl font-semibold text-danger">Zona de perigo</h2>
          <p className="text-sm text-ink-soft">
            Eliminar a conta apaga, de forma definitiva, o seu perfil, o histórico, os registos de auditoria e todos os PNG guardados no armazenamento
            (que expirariam em {config.record_ttl_days} dias). As imagens que já descarregou ficam consigo.
          </p>
          <Button variant="danger" onClick={() => setOpen(true)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Eliminar conta e dados
          </Button>
        </section>
      </div>

      <ConfirmDialog
        open={open}
        title="Eliminar a conta?"
        confirmLabel="Eliminar definitivamente"
        danger
        loading={deleting}
        confirmDisabled={typed !== CONFIRM_WORD}
        onConfirm={deleteAccount}
        onCancel={() => {
          if (!deleting) {
            setOpen(false)
            setTyped('')
          }
        }}
      >
        <Alert kind="error" title="Acção irreversível">
          Todos os dados associados a <strong>{user?.email}</strong> serão apagados.
        </Alert>
        <TextField label={`Escreva ${CONFIRM_WORD} para confirmar`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </ConfirmDialog>
    </div>
  )
}
