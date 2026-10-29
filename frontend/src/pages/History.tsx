import { useCallback, useEffect, useState } from 'react'
// import { Link } from 'react-router-dom' // usado pelo link de «Aprender» (desligado)
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, Download, EyeOff, History as HistoryIcon, Trash2, Unlock } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { ConfirmDialog } from '../components/Dialog'
import { Alert, Badge, Button, EmptyState, LinkButton, Spinner } from '../components/ui'
import { api } from '../services/api'
import { useToast } from '../context/ToastContext'
import type { HistoryItem, HistoryPage } from '../types'
import { describeError, type FriendlyError } from '../utils/errors'
import { saveBlob } from '../utils/download'
import { formatBytes, formatDateTime, formatInt } from '../utils/format'

const PAGE_SIZE = 10

function sizeOf(item: HistoryItem): string {
  if (item.file) return formatBytes(item.file.size_bytes)
  return item.payload_bytes > 0 ? formatBytes(item.payload_bytes) : '—'
}

export function HistoryPage() {
  const toast = useToast()
  const [page, setPage] = useState(0)
  const [data, setData] = useState<HistoryPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [toDelete, setToDelete] = useState<HistoryItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)

  const load = useCallback(async (p: number) => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.history(PAGE_SIZE, p * PAGE_SIZE))
    } catch (e) {
      setError(describeError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Carregamento de dados ao montar/mudar de página (sincroniza com o servidor).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(page)
  }, [load, page])

  async function download(item: HistoryItem) {
    setDownloading(item.id)
    try {
      const { url } = await api.historyDownloadUrl(item.id) // URL assinado de curta duração
      const res = await fetch(url)
      if (!res.ok) throw new Error('O ficheiro já não está disponível.')
      saveBlob(await res.blob(), `invisiomz-${item.id.slice(0, 8)}.png`)
    } catch (e) {
      toast.error(describeError(e).message)
    } finally {
      setDownloading(null)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    setDeleting(true)
    try {
      await api.deleteHistory(toDelete.id)
      toast.success('Registo eliminado.')
      setToDelete(null)
      const remaining = (data?.items.length ?? 1) - 1
      const nextPage = remaining === 0 && page > 0 ? page - 1 : page
      if (nextPage !== page) setPage(nextPage)
      else await load(page)
    } catch (e) {
      toast.error(describeError(e).message)
    } finally {
      setDeleting(false)
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div>
      <PageHeader eyebrow="A sua conta" title="Histórico">
        <p>
          Registo das suas operações (só metadados: nunca senhas, mensagens ou nomes de ficheiros). Os PNG guardados expiram e são apagados
          automaticamente.
        </p>
      </PageHeader>

      {loading && !data && <Spinner label="A carregar o histórico…" />}

      {error && (
        <Alert kind="error" title={error.title}>
          <p>{error.message}</p>
          <Button variant="secondary" className="mt-2 min-h-9 px-3 py-1.5" onClick={() => load(page)}>
            Tentar de novo
          </Button>
        </Alert>
      )}

      {data && data.items.length === 0 && page === 0 && (
        <EmptyState
          icon={<HistoryIcon className="h-7 w-7" aria-hidden="true" />}
          title="Ainda não há operações"
          action={
            <LinkButton to="/ocultar" variant="primary">
              Esconder a primeira imagem
            </LinkButton>
          }
        >
          As operações feitas com a sessão iniciada aparecem aqui. Ao esconder, active «Guardar no histórico» para poder descarregar o PNG mais tarde.
        </EmptyState>
      )}

      {data && data.items.length > 0 && (
        <div className="space-y-4" aria-busy={loading}>
          <div className="card hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Operações recentes</caption>
              <thead className="border-b border-line bg-surface-2 text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th scope="col" className="px-4 py-3">Tipo</th>
                  <th scope="col" className="px-4 py-3">Data</th>
                  <th scope="col" className="px-4 py-3">Estado</th>
                  <th scope="col" className="px-4 py-3">Tamanho</th>
                  <th scope="col" className="px-4 py-3">Modo</th>
                  <th scope="col" className="px-4 py-3 text-right">Acções</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-4 py-3"><TypeBadge item={it} /></td>
                    <td className="px-4 py-3 tabular-nums">{formatDateTime(it.created_at)}</td>
                    <td className="px-4 py-3"><StatusBadge item={it} /></td>
                    <td className="px-4 py-3 tabular-nums">{sizeOf(it)}</td>
                    <td className="px-4 py-3">{it.bits_per_channel ? `${it.bits_per_channel} ${it.bits_per_channel === 1 ? 'bit' : 'bits'}` : '—'}</td>
                    <td className="px-4 py-3">
                      <Actions item={it} downloading={downloading} onDownload={download} onDelete={setToDelete} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-3 md:hidden" aria-label="Operações recentes">
            {data.items.map((it) => (
              <li key={it.id} className="card space-y-3 p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <TypeBadge item={it} />
                  <StatusBadge item={it} />
                </div>
                <p className="tabular-nums text-ink-soft">
                  {formatDateTime(it.created_at)} · {sizeOf(it)}
                  {it.bits_per_channel ? ` · ${it.bits_per_channel} ${it.bits_per_channel === 1 ? 'bit' : 'bits'}` : ''}
                </p>
                <Actions item={it} downloading={downloading} onDownload={download} onDelete={setToDelete} />
              </li>
            ))}
          </ul>

          <nav className="flex items-center justify-between gap-3" aria-label="Paginação">
            <Button variant="secondary" onClick={() => setPage((p) => p - 1)} disabled={page === 0 || loading}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Anterior
            </Button>
            <p className="text-sm text-ink-soft" aria-live="polite">
              Página {formatInt(page + 1)} de {formatInt(totalPages)} · {formatInt(data.total)} {data.total === 1 ? 'registo' : 'registos'}
            </p>
            <Button variant="secondary" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= totalPages || loading}>
              Seguinte <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </nav>
        </div>
      )}

      {data && data.items.length === 0 && page > 0 && (
        <Alert kind="info">
          Esta página ficou vazia. <button type="button" className="font-semibold text-brand-strong underline" onClick={() => setPage(0)}>Voltar ao início</button>
        </Alert>
      )}

      {/* «Aprender» desligado de propósito
      <p className="mt-8 text-sm text-ink-soft">
        Precisa de ajuda a perceber os modos? Veja <Link to="/aprender" className="font-semibold text-brand-strong underline">Aprender</Link>.
      </p>
      */}

      <ConfirmDialog
        open={toDelete !== null}
        title="Eliminar este registo?"
        confirmLabel="Eliminar"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setToDelete(null)}
      >
        <p>
          O registo será apagado{toDelete?.file ? ' e o PNG guardado será eliminado do armazenamento' : ''}. Esta acção não pode ser anulada.
        </p>
      </ConfirmDialog>
    </div>
  )
}

function TypeBadge({ item }: { item: HistoryItem }) {
  return item.type === 'hide' ? (
    <Badge tone="brand"><EyeOff className="h-3 w-3" aria-hidden="true" /> Ocultar</Badge>
  ) : (
    <Badge><Unlock className="h-3 w-3" aria-hidden="true" /> Extrair</Badge>
  )
}

function StatusBadge({ item }: { item: HistoryItem }) {
  return item.status === 'success' ? (
    <Badge tone="success">Sucesso</Badge>
  ) : (
    <Badge tone="danger"><AlertTriangle className="h-3 w-3" aria-hidden="true" /> Falhou{item.error_code ? ` · ${item.error_code}` : ''}</Badge>
  )
}

function Actions({
  item,
  downloading,
  onDownload,
  onDelete,
}: {
  item: HistoryItem
  downloading: string | null
  onDownload: (i: HistoryItem) => void
  onDelete: (i: HistoryItem) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {item.file && !item.file.expired && (
        <Button variant="secondary" className="min-h-9 px-3 py-1.5" loading={downloading === item.id} onClick={() => onDownload(item)}>
          <Download className="h-4 w-4" aria-hidden="true" /> Descarregar
        </Button>
      )}
      {item.file?.expired && (
        <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Ficheiro expirado
        </span>
      )}
      <Button variant="ghost" className="min-h-9 px-3 py-1.5 hover:text-danger" onClick={() => onDelete(item)} aria-label={`Eliminar registo de ${formatDateTime(item.created_at)}`}>
        <Trash2 className="h-4 w-4" aria-hidden="true" /> Eliminar
      </Button>
    </div>
  )
}
