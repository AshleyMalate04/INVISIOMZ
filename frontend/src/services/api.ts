import type {
  AppConfig,
  Bits,
  CapacityInfo,
  DashboardData,
  ExtractResult,
  HideMeta,
  HideOutcome,
  HistoryPage,
} from '../types'

const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  code: string
  status: number
  correlationId?: string
  details?: Record<string, unknown>
  retryAfter?: number

  constructor(code: string, message: string, status = 0, extra?: Partial<ApiError>) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    Object.assign(this, extra)
  }
}

type TokenProvider = () => Promise<string | null>
let tokenProvider: TokenProvider = async () => null
let unauthorizedHandler: (() => void) | null = null

export function setTokenProvider(fn: TokenProvider) {
  tokenProvider = fn
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await tokenProvider()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; correlation_id?: string; details?: Record<string, unknown> } } = {}
  try {
    body = await res.json()
  } catch {
    /* corpo não-JSON */
  }
  const e = body.error
  const retry = Number(res.headers.get('retry-after'))
  return new ApiError(e?.code ?? 'HTTP_ERROR', e?.message ?? `Erro ${res.status} do servidor.`, res.status, {
    correlationId: e?.correlation_id ?? res.headers.get('x-request-id') ?? undefined,
    details: e?.details,
    retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined,
  })
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers: { ...(await authHeaders()), ...init.headers } })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError('NETWORK_ERROR', 'Não foi possível contactar o servidor. Verifique a ligação e se o backend está activo.')
  }
  if (!res.ok) {
    const err = await toApiError(res)
    if (res.status === 401 && unauthorizedHandler) unauthorizedHandler()
    throw err
  }
  return res
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await send(path, init)).json() as Promise<T>
}

export const api = {
  config: () => json<AppConfig>('/api/config'),
  health: () => json<{ status: string; version: string; supabase: string }>('/api/health'),

  capacity(image: File, bits: Bits, signal?: AbortSignal) {
    const form = new FormData()
    form.append('image', image)
    form.append('bits', String(bits))
    return json<CapacityInfo>('/api/capacity', { method: 'POST', body: form, signal })
  },

  async hide(
    p: { image: File; message: string; files: File[]; password: string; bits: Bits; save: boolean; label?: string },
    signal?: AbortSignal,
  ): Promise<HideOutcome> {
    const form = new FormData()
    form.append('image', p.image)
    form.append('password', p.password)
    form.append('bits', String(p.bits))
    if (p.message.trim()) form.append('message', p.message)
    for (const f of p.files) form.append('files', f, f.name)
    if (p.save) {
      form.append('save_to_history', 'true')
      if (p.label?.trim()) form.append('label', p.label.trim())
    }
    const res = await send('/api/hide', { method: 'POST', body: form, signal })
    if (res.headers.get('content-type')?.includes('application/json')) {
      const j = (await res.json()) as { operation_id: string; signed_url: string; expires_at: string; meta: HideMeta }
      let blob: Blob | null = null
      try {
        const r = await fetch(j.signed_url, { signal })
        if (r.ok) blob = await r.blob()
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err
      }
      return { kind: 'saved', blob, signedUrl: j.signed_url, operationId: j.operation_id, expiresAt: j.expires_at, meta: j.meta }
    }
    const metaHeader = res.headers.get('x-meta')
    const meta = JSON.parse(decodeURIComponent(metaHeader ?? '{}')) as HideMeta
    return { kind: 'png', blob: await res.blob(), meta, saveFailed: res.headers.get('x-save-error') === '1' }
  },

  extract(image: File, password: string, signal?: AbortSignal) {
    const form = new FormData()
    form.append('image', image)
    form.append('password', password)
    return json<ExtractResult>('/api/extract', { method: 'POST', body: form, signal })
  },

  /** Descarga de uso único: cada token só funciona uma vez. */
  async fetchToken(token: string): Promise<Blob> {
    return (await send(`/api/files/${encodeURIComponent(token)}`)).blob()
  },

  dashboard: () => json<DashboardData>('/api/dashboard'),
  history: (limit: number, offset: number) => json<HistoryPage>(`/api/history?limit=${limit}&offset=${offset}`),
  historyDownloadUrl: (id: string) => json<{ url: string; expires_in: number }>(`/api/history/${id}/download`),
  async deleteHistory(id: string) {
    await send(`/api/history/${id}`, { method: 'DELETE' })
  },
  async deleteAccount() {
    await send('/api/account', { method: 'DELETE' })
  },
}
