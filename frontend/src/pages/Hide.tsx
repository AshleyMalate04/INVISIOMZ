import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Download,
  EyeOff,
  FileText,
  ImageIcon,
  Layers,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Stepper } from '../components/Stepper'
import { Dropzone } from '../components/Dropzone'
import { CapacityBar } from '../components/CapacityBar'
import { PasswordField } from '../components/PasswordField'
import { ConfirmDialog } from '../components/Dialog'
import { Alert, Button, CopyButton, Spinner, TextArea, TextField } from '../components/ui'
import { api, ApiError } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useConfig } from '../context/ConfigContext'
import { useToast } from '../context/ToastContext'
import { useObjectUrl } from '../hooks/useObjectUrl'
import type { Bits, CapacityInfo, HideOutcome } from '../types'
import { describeError, type FriendlyError } from '../utils/errors'
import { estimatePackageBytes } from '../utils/capacity'
import { saveBlob } from '../utils/download'
import { formatBytes, formatDuration, formatInt, formatPercent, formatSignedBytes, formatSizeChange } from '../utils/format'

const STEPS = ['Imagem', 'Conteúdo', 'Senha', 'Rever e ocultar', 'Resultado']
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/bmp,image/gif,image/tiff,image/x-icon,image/vnd.microsoft.icon,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff,.ico'

function ErrorBox({ error }: { error: FriendlyError }) {
  return (
    <Alert kind="error" title={error.title}>
      <p>{error.message}</p>
      {error.hint && <p className="mt-1">{error.hint}</p>}
    </Alert>
  )
}

export function HidePage() {
  const { config, accountsAvailable } = useConfig()
  const { user } = useAuth()
  const toast = useToast()
  const limits = config.limits

  const [step, setStep] = useState(0)
  const [image, setImage] = useState<File | null>(null)
  const [cap, setCap] = useState<CapacityInfo | null>(null)
  const [capLoading, setCapLoading] = useState(false)
  const [capError, setCapError] = useState<FriendlyError | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [bits, setBits] = useState<Bits>(1)
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [save, setSave] = useState(false)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [outcome, setOutcome] = useState<HideOutcome | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const capAbort = useRef<AbortController | null>(null)

  const imageUrl = useObjectUrl(image)
  const resultBlob = outcome ? outcome.blob : null
  const resultUrl = useObjectUrl(resultBlob)

  const dirty = (image !== null && step < 4) || (step === 4 && outcome !== null && !downloaded)

  /* Bloqueia a navegação (e o fecho do separador) quando há trabalho por descarregar/descartar. */
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  useEffect(
    () => () => {
      abortRef.current?.abort()
      capAbort.current?.abort()
    },
    [],
  )

  /* ── Passo 1: imagem + capacidade ── */
  async function chooseImage(list: File[]) {
    const file = list[0]
    if (!file) return
    setImageError(null)
    setCapError(null)
    if (file.size > limits.max_image_bytes) {
      setImageError(`A imagem tem ${formatBytes(file.size)}; o máximo é ${formatBytes(limits.max_image_bytes)}.`)
      return
    }
    capAbort.current?.abort()
    const ctrl = new AbortController()
    capAbort.current = ctrl
    setImage(file)
    setPreviewFailed(false)
    setCap(null)
    setCapLoading(true)
    try {
      const info = await api.capacity(file, bits, ctrl.signal)
      setCap(info)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setCapError(describeError(e))
    } finally {
      if (capAbort.current === ctrl) setCapLoading(false)
    }
  }

  function removeImage() {
    capAbort.current?.abort()
    setImage(null)
    setCap(null)
    setCapError(null)
    setCapLoading(false)
  }

  /* ── Passo 2: conteúdo ── */
  const totalFiles = useMemo(() => files.reduce((n, f) => n + f.size, 0), [files])

  function addFiles(list: File[]) {
    setFileError(null)
    const next = [...files]
    for (const f of list) {
      if (f.size > limits.max_file_bytes) {
        setFileError(`«${f.name}» tem ${formatBytes(f.size)}; o máximo por ficheiro é ${formatBytes(limits.max_file_bytes)}.`)
        continue
      }
      if (next.length >= limits.max_files) {
        setFileError(`O máximo é ${limits.max_files} ficheiros por operação.`)
        break
      }
      if (next.reduce((n, x) => n + x.size, 0) + f.size > limits.max_total_bytes) {
        setFileError(`O total dos anexos não pode exceder ${formatBytes(limits.max_total_bytes)}.`)
        continue
      }
      next.push(f)
    }
    setFiles(next)
  }

  const estimate = useMemo(
    () => (cap ? estimatePackageBytes(message, files, cap.overhead) : 0),
    [cap, message, files],
  )
  const useful = cap ? cap.modes[String(bits)].useful_capacity_bytes : 0
  const hasContent = message.trim().length > 0 || files.length > 0
  const overCapacity = cap !== null && hasContent && estimate > useful
  const messageTooLong = message.length > limits.max_message_chars

  /* ── Passo 3: senha ── */
  const pwMismatch = confirm.length > 0 && confirm !== password
  const pwOk = password.length >= limits.password_min_length && confirm === password
  const pwError =
    password.length > 0 && password.length < limits.password_min_length
      ? `Faltam ${limits.password_min_length - password.length} caracteres (mínimo ${limits.password_min_length}).`
      : null

  /* ── Passo 4: ocultar ── */
  async function run() {
    if (!image || !cap) return
    setError(null)
    setBusy(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const result = await api.hide({ image, message, files, password, bits, save: save && !!user, label }, ctrl.signal)
      setOutcome(result)
      setPassword('') // a senha não fica em memória da interface depois de usada
      setConfirm('')
      setDownloaded(false)
      setStep(4)
      if (result.kind === 'png' && result.saveFailed) toast.error('O PNG foi criado, mas não foi possível guardá-lo no histórico.')
      else toast.success('Imagem criada e verificada com sucesso.')
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        toast.info('Operação cancelada.')
      } else {
        setError(describeError(e))
        if (e instanceof ApiError && e.code === 'CAPACITY_EXCEEDED') setStep(1)
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const resetAll = useCallback(() => {
    abortRef.current?.abort()
    capAbort.current?.abort()
    setStep(0)
    setImage(null)
    setCap(null)
    setCapError(null)
    setImageError(null)
    setCapLoading(false)
    setBits(1)
    setMessage('')
    setFiles([])
    setFileError(null)
    setPassword('')
    setConfirm('')
    setSave(false)
    setLabel('')
    setError(null)
    setOutcome(null)
    setDownloaded(false)
    setConfirmReset(false)
  }, [])

  function requestReset() {
    if (dirty) setConfirmReset(true)
    else resetAll()
  }

  const canNext =
    step === 0 ? cap !== null && !capLoading
    : step === 1 ? hasContent && !overCapacity && !messageTooLong
    : step === 2 ? pwOk
    : false

  return (
    <div>
      <PageHeader eyebrow="Passo a passo" title="Esconder informação numa imagem">
        <p>
          Escolha uma imagem, junte uma mensagem e/ou ficheiros e proteja tudo com uma senha. O resultado é sempre um{' '}
          <strong className="text-ink">PNG real</strong>, cifrado com AES-256-GCM antes de ser escondido.
        </p>
      </PageHeader>

      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Stepper steps={STEPS} current={step} />
        </div>
        {(image || step > 0) && (
          <Button variant="ghost" onClick={requestReset} disabled={busy}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Recomeçar
          </Button>
        )}
      </div>

      <section aria-labelledby="passo-titulo" className="card rise p-5 sm:p-8">
        {/* ───────────── Passo 1 ───────────── */}
        {step === 0 && (
          <div className="space-y-6">
            <div>
              <h2 id="passo-titulo" className="text-2xl font-semibold">
                1 · Imagem portadora
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                Formatos: PNG, JPG, WEBP, BMP, GIF, TIFF, ICO (máx. {formatBytes(limits.max_image_bytes)}). A imagem original nunca é alterada.
              </p>
            </div>

            {!image && (
              <Dropzone
                label="Largue a imagem aqui"
                description="Imagens com mais píxeis guardam mais dados. Fotografias com ruído escondem melhor do que cores lisas."
                accept={IMAGE_ACCEPT}
                onFiles={chooseImage}
              />
            )}
            {imageError && <Alert kind="error" title="Imagem recusada">{imageError}</Alert>}

            {image && (
              <div className="grid gap-5 md:grid-cols-[minmax(0,16rem)_1fr]">
                <div className="relative grid aspect-square place-items-center overflow-hidden rounded-2xl border border-line bg-surface-2">
                  {imageUrl && (
                    <img
                      src={imageUrl}
                      alt={`Pré-visualização de ${image.name}`}
                      className="h-full w-full object-contain"
                      onError={() => setPreviewFailed(true)}
                    />
                  )}
                  {previewFailed && (
                    <div className="flex flex-col items-center gap-2 p-4 text-center text-xs text-ink-soft">
                      <ImageIcon className="h-10 w-10 text-ink-soft/50" aria-hidden="true" />
                      O navegador não consegue pré-visualizar este formato, mas o ficheiro será processado normalmente.
                    </div>
                  )}
                </div>
                <div className="space-y-4">
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <dt className="text-xs uppercase tracking-wide text-ink-soft">Ficheiro</dt>
                      <dd className="break-all font-medium">{image.name}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-ink-soft">Tamanho original</dt>
                      <dd className="font-medium tabular-nums">{formatBytes(image.size)}</dd>
                    </div>
                    {cap && (
                      <>
                        <div>
                          <dt className="text-xs uppercase tracking-wide text-ink-soft">Formato · dimensões</dt>
                          <dd className="font-medium tabular-nums">
                            {cap.format} · {formatInt(cap.width)} × {formatInt(cap.height)} px
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                  {capLoading && <Spinner label="A analisar a imagem…" />}
                  {capError && <ErrorBox error={capError} />}
                  {cap?.warnings.map((w) => (
                    <Alert key={w} kind="warn" title="Atenção">
                      {w}
                    </Alert>
                  ))}
                  <Button variant="secondary" onClick={removeImage}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" /> Trocar imagem
                  </Button>
                </div>
              </div>
            )}

            {cap && (
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Bits por canal de cor</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {([1, 2] as Bits[]).map((b) => (
                    <label
                      key={b}
                      className={`flex cursor-pointer flex-col gap-1 rounded-2xl border p-4 transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-glow ${
                        bits === b ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface hover:bg-surface-2'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <input type="radio" name="bits" checked={bits === b} onChange={() => setBits(b)} className="h-4 w-4 accent-[var(--brand)]" />
                        <span className="font-semibold">{b === 1 ? '1 bit · discreto' : '2 bits · mais espaço'}</span>
                      </span>
                      <span className="pl-6 text-sm text-ink-soft">
                        Capacidade útil: <strong className="text-ink">{formatBytes(cap.modes[String(b)].useful_capacity_bytes)}</strong>
                        {b === 2 ? ' · alterações mais visíveis' : ' · alterações mínimas (±1)'}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        )}

        {/* ───────────── Passo 2 ───────────── */}
        {step === 1 && cap && (
          <div className="space-y-6">
            <div>
              <h2 id="passo-titulo" className="text-2xl font-semibold">
                2 · O que quer esconder?
              </h2>
              <p className="mt-1 text-sm text-ink-soft">Uma mensagem de texto, ficheiros, ou ambos.</p>
            </div>

            <TextArea
              label="Mensagem"
              optional
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Escreva aqui o texto secreto…"
              error={messageTooLong ? `A mensagem excede ${formatInt(limits.max_message_chars)} caracteres.` : null}
              hint={`${formatInt(message.length)} / ${formatInt(limits.max_message_chars)} caracteres`}
            />

            <div className="space-y-3">
              <h3 className="text-sm font-medium">
                Ficheiros <span className="text-xs font-normal text-ink-soft">opcional</span>
              </h3>
              <Dropzone
                compact
                multiple
                label="Largue ficheiros aqui"
                description={`Até ${limits.max_files} ficheiros · ${formatBytes(limits.max_file_bytes)} cada · ${formatBytes(limits.max_total_bytes)} no total`}
                onFiles={addFiles}
              />
              {fileError && <Alert kind="warn">{fileError}</Alert>}
              {files.length > 0 && (
                <div>
                  <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line" aria-label="Ficheiros a esconder">
                    {files.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center gap-3 bg-surface px-4 py-2.5 text-sm">
                        <FileText className="h-4 w-4 shrink-0 text-brand-strong" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate font-medium" title={f.name}>
                          {f.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-ink-soft">{formatBytes(f.size)}</span>
                        <button
                          type="button"
                          onClick={() => setFiles(files.filter((_, j) => j !== i))}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-danger-soft hover:text-danger"
                          aria-label={`Remover ${f.name}`}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-right text-sm text-ink-soft">
                    {files.length} {files.length === 1 ? 'ficheiro' : 'ficheiros'} · total <strong className="tabular-nums text-ink">{formatBytes(totalFiles)}</strong>
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-line bg-surface-2/60 p-4">
              <CapacityBar used={estimate} total={useful} label={`Conteúdo estimado vs. capacidade útil (${bits} ${bits === 1 ? 'bit' : 'bits'})`} />
              <p className="mt-2 text-xs text-ink-soft">
                Estimativa conservadora com o pacote interno (ZIP + manifesto). A verificação final é feita no servidor.
              </p>
            </div>
          </div>
        )}

        {/* ───────────── Passo 3 ───────────── */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 id="passo-titulo" className="text-2xl font-semibold">
                3 · Proteja com uma senha
              </h2>
              <p className="mt-1 text-sm text-ink-soft">A senha gera a chave de cifra (Scrypt). Nunca é guardada em lado nenhum.</p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <PasswordField
                label="Senha"
                value={password}
                onChange={(v) => {
                  setPassword(v)
                }}
                showStrength
                minLength={limits.password_min_length}
                error={pwError}
                hint={`Mínimo ${limits.password_min_length} caracteres. Uma frase longa é melhor do que uma palavra complicada.`}
              />
              <PasswordField
                label="Confirmar senha"
                value={confirm}
                onChange={setConfirm}
                error={pwMismatch ? 'As senhas não coincidem.' : null}
              />
            </div>
            <Alert kind="warn" title="Senha esquecida = dados irrecuperáveis">
              Não existe «recuperar senha»: sem ela, nem o InvisioMZ nem o seu autor conseguem abrir a imagem. 
            </Alert>

            {accountsAvailable && (
              <div className="rounded-2xl border border-line bg-surface-2/60 p-4">
                {user ? (
                  <div className="space-y-3">
                    <label className="flex items-start gap-3 text-sm">
                      <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--brand)]" />
                      <span>
                        <span className="font-medium">Guardar o PNG no histórico</span>
                        <span className="block text-ink-soft">
                          Fica num armazenamento privado durante {config.record_ttl_days} dias. Só é útil com a senha.
                        </span>
                      </span>
                    </label>
                    {save && <TextField label="Etiqueta" optional maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Entrega do trabalho" />}
                  </div>
                ) : (
                  <p className="text-sm text-ink-soft">
                    Quer guardar o resultado no histórico? <Link to="/entrar" className="font-semibold text-brand-strong underline">Entre na sua conta</Link>. Sem conta, nada é guardado.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ───────────── Passo 4 ───────────── */}
        {step === 3 && cap && image && (
          <div className="space-y-6">
            <div>
              <h2 id="passo-titulo" className="text-2xl font-semibold">
                4 · Rever e ocultar
              </h2>
              <p className="mt-1 text-sm text-ink-soft">Confirme os dados. Depois de ocultar, o PNG é verificado (lido de novo e decifrado) antes de lho entregarmos.</p>
            </div>
            <dl className="grid gap-4 rounded-2xl border border-line bg-surface-2/60 p-5 text-sm sm:grid-cols-2">
              <Summary k="Imagem" v={`${image.name} · ${formatBytes(image.size)}`} />
              <Summary k="Dimensões" v={`${formatInt(cap.width)} × ${formatInt(cap.height)} px`} />
              <Summary k="Modo" v={`${bits} ${bits === 1 ? 'bit' : 'bits'} por canal`} />
              <Summary k="Mensagem" v={message.trim() ? `${formatInt(message.length)} caracteres` : 'Sem mensagem'} />
              <Summary k="Ficheiros" v={files.length ? `${files.length} · ${formatBytes(totalFiles)}` : 'Nenhum'} />
              <Summary k="Senha" v="••••••••••" />
              <Summary k="Histórico" v={save && user ? 'Guardar no histórico' : 'Não guardar'} />
            </dl>
            <CapacityBar used={estimate} total={useful} label="Utilização estimada" />

            {error && <ErrorBox error={error} />}

            {busy ? (
              <div className="space-y-3 rounded-2xl border border-line bg-surface-2/60 p-5" aria-live="polite">
                <Spinner label="A cifrar, a esconder e a verificar… (imagens grandes podem demorar alguns segundos)" />
                <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <Button onClick={run} disabled={overCapacity || !pwOk} className="w-full sm:w-auto">
                <EyeOff className="h-4 w-4" aria-hidden="true" /> Ocultar agora
              </Button>
            )}
          </div>
        )}

        {/* ───────────── Passo 5 ───────────── */}
        {step === 4 && outcome && (
          <ResultView
            outcome={outcome}
            imageName={image?.name ?? ''}
            resultUrl={resultUrl}
            onDownload={() => {
              if (outcome.blob) {
                saveBlob(outcome.blob, outcome.meta.output_filename)
                setDownloaded(true)
              }
            }}
            onSavedOpen={() => setDownloaded(true)}
            onReset={requestReset}
            ttlDays={config.record_ttl_days}
          />
        )}

        {/* ───────────── Navegação ───────────── */}
        {step < 3 && (
          <div className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-6">
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Anterior
            </Button>
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Seguinte <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}
        {step === 3 && !busy && (
          <div className="mt-8 border-t border-line pt-6">
            <Button variant="ghost" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Anterior
            </Button>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmReset}
        title="Descartar o trabalho actual?"
        confirmLabel="Descartar e recomeçar"
        danger
        onConfirm={resetAll}
        onCancel={() => setConfirmReset(false)}
      >
        <p>
          {step === 4 && !downloaded
            ? 'Ainda não descarregou o PNG. Se continuar, perde-o (terá de repetir a operação).'
            : 'A imagem, o conteúdo e a senha introduzidos serão descartados.'}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Sair desta página?"
        confirmLabel="Sair e descartar"
        cancelLabel="Ficar"
        danger
        onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
        onCancel={() => blocker.state === 'blocked' && blocker.reset()}
      >
        <p>
          {step === 4 && !downloaded
            ? 'O PNG ainda não foi descarregado e será perdido.'
            : 'O trabalho em curso será descartado.'}
        </p>
      </ConfirmDialog>
    </div>
  )
}

function Summary({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-soft">{k}</dt>
      <dd className="break-all font-medium">{v}</dd>
    </div>
  )
}

interface ResultProps {
  outcome: HideOutcome
  imageName: string
  resultUrl: string | null
  onDownload: () => void
  onSavedOpen: () => void
  onReset: () => void
  ttlDays: number
}

function ResultView({ outcome, imageName, resultUrl, onDownload, onSavedOpen, onReset, ttlDays }: ResultProps) {
  const m = outcome.meta
  const usedPct = m.useful_capacity_bytes > 0 ? (m.package_bytes / m.useful_capacity_bytes) * 100 : 0
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-success-soft text-success">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 id="passo-titulo" className="text-2xl font-semibold">
            5 · Imagem criada
          </h2>
          <p className="text-sm text-ink-soft">PNG verificado: o servidor releu o ficheiro e confirmou o conteúdo cifrado antes de o devolver.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="space-y-3">
          <div className="grid aspect-square place-items-center overflow-hidden rounded-2xl border border-line bg-surface-2">
            {resultUrl ? (
              <img src={resultUrl} alt="Pré-visualização do PNG com dados escondidos" className="h-full w-full object-contain" />
            ) : (
              <p className="p-4 text-center text-sm text-ink-soft">Pré-visualização indisponível.</p>
            )}
          </div>
          {outcome.blob ? (
            <Button onClick={onDownload} className="w-full">
              <Download className="h-4 w-4" aria-hidden="true" /> Descarregar PNG
            </Button>
          ) : (
            <a
              href={outcome.kind === 'saved' ? outcome.signedUrl : '#'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onSavedOpen}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand hover:bg-brand-hover"
            >
              <Download className="h-4 w-4" aria-hidden="true" /> Abrir ficheiro guardado
            </a>
          )}
          <p className="break-all text-center text-xs text-ink-soft">{m.output_filename}</p>
        </div>

        <div className="space-y-5">
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Comparação entre a imagem original e a final</caption>
              <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-semibold"><span className="sr-only">Propriedade</span></th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Original</th>
                  <th scope="col" className="px-4 py-2.5 font-semibold">Final</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                <tr>
                  <th scope="row" className="px-4 py-2.5 font-medium text-ink-soft">Nome</th>
                  <td className="break-all px-4 py-2.5">{imageName}</td>
                  <td className="break-all px-4 py-2.5">{m.output_filename}</td>
                </tr>
                <tr>
                  <th scope="row" className="px-4 py-2.5 font-medium text-ink-soft">Formato</th>
                  <td className="px-4 py-2.5">{m.original_format}</td>
                  <td className="px-4 py-2.5">PNG</td>
                </tr>
                <tr>
                  <th scope="row" className="px-4 py-2.5 font-medium text-ink-soft">Dimensões</th>
                  <td className="px-4 py-2.5">{formatInt(m.width)} × {formatInt(m.height)} px</td>
                  <td className="px-4 py-2.5">{formatInt(m.width)} × {formatInt(m.height)} px</td>
                </tr>
                <tr>
                  <th scope="row" className="px-4 py-2.5 font-medium text-ink-soft">Tamanho</th>
                  <td className="px-4 py-2.5">{formatBytes(m.original_size_bytes)}</td>
                  <td className="px-4 py-2.5">{formatBytes(m.output_size_bytes)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="bg-brand-soft/60">
                  <th scope="row" className="px-4 py-2.5 font-medium text-ink-soft">Diferença</th>
                  <td colSpan={2} className="px-4 py-2.5 font-semibold text-brand-strong">
                    {formatSizeChange(m.original_size_bytes, m.output_size_bytes)} <span className="font-normal text-ink-soft">({formatSignedBytes(m.original_size_bytes, m.output_size_bytes)})</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
{/* 
          <Alert kind="info" title="Porque é que o ficheiro cresceu?">
            O PNG é um formato sem perdas, por isso costuma ser maior do que um JPG ou WEBP com a mesma imagem. Isso <strong>não</strong> significa que os dados escondidos ocupem todo esse aumento: o espaço usado é só {formatBytes(m.package_bytes)}.
          </Alert> */}

          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Espaço usado</dt>
              <dd className="font-medium tabular-nums">
                {formatBytes(m.package_bytes)} de {formatBytes(m.useful_capacity_bytes)} ({formatPercent(usedPct, usedPct < 10 ? 1 : 0)})
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-soft">Modo · conteúdo · tempo</dt>
              <dd className="font-medium">
                {m.bits} {m.bits === 1 ? 'bit' : 'bits'} · {m.has_message ? 'mensagem' : 'sem mensagem'}, {m.file_count} {m.file_count === 1 ? 'ficheiro' : 'ficheiros'} · {formatDuration(m.duration_ms)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="flex items-center justify-between text-xs uppercase tracking-wide text-ink-soft">
                SHA-256 do PNG <CopyButton text={m.sha256} />
              </dt>
              <dd className="mt-1 space-y-2">
                <span className="block break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs">{m.sha256}</span>
                <span className="block text-xs normal-case tracking-normal text-ink-soft">
                  {/* É a «impressão digital» do PNG. Guarde-a: em <Link to="/extrair" className="font-semibold text-brand-strong underline">Extrair</Link>  */}
                  pode colá-la para confirmar que o ficheiro chegou intacto. Não é a senha e pode ser partilhada.
                </span>
              </dd>
            </div>
          </dl>

          {outcome.kind === 'saved' && (
            <Alert kind="success" title="Guardado no histórico">
              O PNG ficou no armazenamento privado e expira em {ttlDays} dias. Pode descarregá-lo ou eliminá-lo em <Link to="/historico" className="font-semibold text-brand-strong underline">Histórico</Link>.
            </Alert>
          )}
          {m.warnings.map((w) => (
            <Alert key={w} kind="warn" title="Atenção">
              {w}
            </Alert>
          ))}
          <Alert kind="warn" title="Não altere o PNG">
            Redimensionar, recortar, converter para JPG ou partilhar por aplicações que recomprimem imagens (p. ex. WhatsApp) destrói os dados escondidos. Envie como <em>documento</em>/anexo.
          </Alert>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={onReset}>
              <Layers className="h-4 w-4" aria-hidden="true" /> Esconder noutra imagem
            </Button>
            <Link to="/extrair" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-brand-strong hover:bg-surface-2">
              <LockKeyhole className="h-4 w-4" aria-hidden="true" /> Testar a extracção
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
