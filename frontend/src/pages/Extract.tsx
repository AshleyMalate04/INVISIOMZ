import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileArchive, FileText, KeyRound, MessageSquareText, Trash2, Unlock } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { Dropzone } from '../components/Dropzone'
import { PasswordField } from '../components/PasswordField'
import { IntegrityCheck } from '../components/IntegrityCheck'
import { Alert, Button, CopyButton, Spinner } from '../components/ui'
import { api, ApiError } from '../services/api'
import { useConfig } from '../context/ConfigContext'
import { useToast } from '../context/ToastContext'
import { useObjectUrl } from '../hooks/useObjectUrl'
import type { ExtractedFile, ExtractResult } from '../types'
import { describeError, type FriendlyError } from '../utils/errors'
import { base64ToBlob, saveBlob } from '../utils/download'
import { formatBytes, formatDuration, formatInt } from '../utils/format'

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/bmp,image/gif,image/tiff,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff,.ico'

export function ExtractPage() {
  const { config } = useConfig()
  const toast = useToast()
  const [image, setImage] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [result, setResult] = useState<ExtractResult | null>(null)
  const [zipBlob, setZipBlob] = useState<Blob | null>(null)
  const [zipState, setZipState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [fileBlobs, setFileBlobs] = useState<Record<string, Blob>>({})
  const [busyFile, setBusyFile] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const generation = useRef(0)

  const imageUrl = useObjectUrl(image)

  useEffect(() => () => abortRef.current?.abort(), [])

  /** Limpa o resultado da memória (mensagem, ficheiros, blobs e tokens). */
  const clearResults = useCallback(() => {
    generation.current++
    setResult(null)
    setZipBlob(null)
    setZipState('idle')
    setFileBlobs({})
    setError(null)
  }, [])

  const minLen = 1 // ao extrair, aceita-se qualquer senha: a validação real é a tag GCM

  async function run() {
    if (!image) return
    clearResults()
    const gen = generation.current
    setBusy(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const r = await api.extract(image, password, ctrl.signal)
      if (gen !== generation.current) return
      setResult(r)
      setPassword('')
      toast.success('Conteúdo extraído com sucesso.')
      if (r.zip_token) {
        // O token do ZIP é de uso único: busca já o ficheiro para o ter pronto (e em memória do navegador).
        setZipState('loading')
        api
          .fetchToken(r.zip_token)
          .then((b) => {
            if (gen !== generation.current) return
            setZipBlob(b)
            setZipState('ready')
          })
          .catch(() => gen === generation.current && setZipState('failed'))
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') toast.info('Operação cancelada.')
      else {
        setError(describeError(e))
        // A senha errada nunca revela nada: apenas limpa o campo para nova tentativa.
        if (e instanceof ApiError && e.code === 'WRONG_PASSWORD_OR_TAMPERED') setPassword('')
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  async function downloadFile(f: ExtractedFile) {
    try {
      let blob = fileBlobs[f.id]
      if (!blob) {
        setBusyFile(f.id)
        if (f.content_b64 !== null) blob = base64ToBlob(f.content_b64)
        else if (f.download_token) blob = await api.fetchToken(f.download_token)
        else throw new Error('Conteúdo indisponível.')
        setFileBlobs((m) => ({ ...m, [f.id]: blob }))
      }
      saveBlob(blob, f.name)
    } catch (e) {
      toast.error(describeError(e).message)
    } finally {
      setBusyFile(null)
    }
  }

  const ready = image !== null && password.length >= minLen

  return (
    <div>
      <PageHeader eyebrow="Recuperar" title="Extrair informação de uma imagem">
        <p>
          Carregue o PNG criado pelo InvisioMZ e indique a senha. Só depois de a autenticação AES-GCM passar é que algo é revelado.
        </p>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <section className="card rise space-y-5 p-5 sm:p-7" aria-labelledby="extrair-form">
          <h2 id="extrair-form" className="text-xl font-semibold">
            Imagem e senha
          </h2>

          {!image ? (
            <Dropzone
              label="Largue o PNG aqui"
              description={`Máx. ${formatBytes(config.limits.max_image_bytes)}. Use o ficheiro exactamente como foi descarregado.`}
              accept={IMAGE_ACCEPT}
              onFiles={(f) => {
                clearResults()
                setImage(f[0] ?? null)
              }}
            />
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 p-3">
              {imageUrl && <img src={imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />}
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-medium" title={image.name}>
                  {image.name}
                </p>
                <p className="text-ink-soft tabular-nums">{formatBytes(image.size)}</p>
              </div>
              <Button
                variant="ghost"
                className="min-h-9 px-3"
                onClick={() => {
                  clearResults()
                  setImage(null)
                }}
                aria-label="Remover imagem"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (ready && !busy) void run()
            }}
            className="space-y-4"
          >
            <PasswordField label="Senha" value={password} onChange={setPassword} autoComplete="off" placeholder="A senha usada ao esconder" />
            {busy ? (
              <div className="space-y-3" aria-live="polite">
                <Spinner label="A derivar a chave e a procurar os dados…" />
                <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <Button type="submit" disabled={!ready} className="w-full">
                <Unlock className="h-4 w-4" aria-hidden="true" /> Extrair
              </Button>
            )}
          </form>

          {image && <IntegrityCheck file={image} />}

          {error && (
            <Alert kind="error" title={error.title}>
              <p>{error.message}</p>
              {error.hint && <p className="mt-1">{error.hint}</p>}
            </Alert>
          )}
        </section>

        <section aria-live="polite" aria-label="Resultado da extracção" className="min-w-0">
          {!result ? (
            <div className="grid h-full min-h-64 place-items-center rounded-2xl border border-dashed border-line-strong bg-surface-2/40 p-8 text-center">
              <div className="max-w-sm space-y-2 text-sm text-ink-soft">
                <KeyRound className="mx-auto h-8 w-8 text-brand-strong" aria-hidden="true" />
                <p className="font-semibold text-ink">O conteúdo aparecerá aqui</p>
                <p>
                  Ainda não escondeu nada? Comece em <Link to="/ocultar" className="font-semibold text-brand-strong underline">Ocultar</Link>.
                </p>
              </div>
            </div>
          ) : (
            <div className="card rise space-y-6 p-5 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">Conteúdo recuperado</h2>
                  <p className="text-sm text-ink-soft">
                    Modo de {result.bits} {result.bits === 1 ? 'bit' : 'bits'} · imagem {formatInt(result.width)} × {formatInt(result.height)} px · {formatDuration(result.duration_ms)}
                  </p>
                </div>
                <Button variant="secondary" onClick={clearResults}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> Limpar resultados
                </Button>
              </div>

              {result.message !== null && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <MessageSquareText className="h-4 w-4 text-brand-strong" aria-hidden="true" /> Mensagem
                    </h3>
                    <CopyButton text={result.message} label="Copiar mensagem" />
                  </div>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-surface-2 p-4 font-sans text-sm" tabIndex={0}>
                    {result.message}
                  </pre>
                </div>
              )}

              {result.files.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <FileText className="h-4 w-4 text-brand-strong" aria-hidden="true" /> Ficheiros ({result.files.length}) · {formatBytes(result.total_bytes)}
                    </h3>
                    {zipState === 'loading' && <Spinner label="A preparar o ZIP…" />}
                    {zipState === 'ready' && zipBlob && (
                      <Button onClick={() => saveBlob(zipBlob, 'invisiomz_ficheiros.zip')}>
                        <FileArchive className="h-4 w-4" aria-hidden="true" /> Descarregar tudo (ZIP)
                      </Button>
                    )}
                    {zipState === 'failed' && <span className="text-xs text-danger">ZIP indisponível: extraia de novo.</span>}
                  </div>
                  <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                    {result.files.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center gap-3 bg-surface px-4 py-3 text-sm">
                        <FileText className="h-4 w-4 shrink-0 text-brand-strong" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium" title={f.name}>
                            {f.name}
                          </p>
                          <p className="text-xs text-ink-soft">
                            {f.mime} · <span className="tabular-nums">{formatBytes(f.size)}</span>
                          </p>
                        </div>
                        <Button variant="secondary" className="min-h-9 px-3 py-1.5" loading={busyFile === f.id} onClick={() => downloadFile(f)} aria-label={`Descarregar ${f.name}`}>
                          <Download className="h-4 w-4" aria-hidden="true" /> Descarregar
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-ink-soft">Os ficheiros foram verificados com o SHA-256 do manifesto. Nada é executado: são tratados como bytes.</p>
                </div>
              )}

              {result.message === null && result.files.length === 0 && <Alert kind="info">A imagem não continha mensagem nem ficheiros.</Alert>}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
