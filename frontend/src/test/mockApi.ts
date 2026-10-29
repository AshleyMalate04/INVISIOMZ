import { vi } from 'vitest'
import type { AppConfig, CapacityInfo } from '../types'

export const CONFIG: AppConfig = {
  limits: {
    max_image_bytes: 20 * 1024 * 1024,
    max_image_pixels: 12_000_000,
    max_files: 20,
    max_file_bytes: 10 * 1024 * 1024,
    max_total_bytes: 25 * 1024 * 1024,
    max_message_chars: 100_000,
    password_min_length: 10,
  },
  accounts_enabled: false,
  guest_allowed: true, // os testes de páginas usam o modo convidado; o login obrigatório tem testes próprios
  record_ttl_days: 7,
  version: 'test',
}

export function capacityFor(width: number, height: number, size: number, format = 'PNG', warnings: string[] = []): CapacityInfo {
  const mode = (bits: number) => ({
    raw_capacity_bytes: Math.floor((width * height * 3 * bits) / 8),
    useful_capacity_bytes: Math.floor(((width * height * 3 - 368) * bits) / 8) - 16,
  })
  return {
    width,
    height,
    format,
    original_size_bytes: size,
    warnings,
    bits: 1,
    ...mode(1),
    modes: { '1': mode(1), '2': mode(2) },
    overhead: { header_bytes: 46, aead_tag_bytes: 16, fixed_bytes: 280, per_file_bytes: 330 },
    limits: CONFIG.limits,
  }
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

export const apiError = (code: string, message: string, status = 400) => json({ error: { code, message, correlation_id: 'abc123' } }, status)

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>

/** Substitui `fetch` por um router de testes: `/api/<rota>` -> handler. Rotas não tratadas falham o teste. */
export function mockFetch(handlers: Record<string, Handler>) {
  const calls: { path: string; init?: RequestInit }[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    calls.push({ path: url.pathname, init })
    const handler = handlers[url.pathname]
    if (!handler) throw new Error(`fetch sem handler: ${url.pathname}`)
    return handler(url, init)
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}
