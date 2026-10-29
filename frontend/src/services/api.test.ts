import { describe, expect, it, vi } from 'vitest'
import { api, ApiError, setTokenProvider, setUnauthorizedHandler } from './api'
import { apiError, json, mockFetch } from '../test/mockApi'
import { describeError } from '../utils/errors'

describe('api client', () => {
  it('converte o corpo de erro do backend em ApiError com código estável', async () => {
    mockFetch({ '/api/extract': () => apiError('WRONG_PASSWORD_OR_TAMPERED', 'senha errada ou adulterada') })
    const err = await api.extract(new File(['x'], 'a.png'), 'senha').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('WRONG_PASSWORD_OR_TAMPERED')
    expect(err.correlationId).toBe('abc123')
    expect(describeError(err).title).toBe('Senha errada ou imagem alterada')
  })

  it('erro de rede -> NETWORK_ERROR (nunca rebenta com stack trace)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const err = await api.config().catch((e) => e)
    expect(err.code).toBe('NETWORK_ERROR')
    expect(describeError(err).hint).toMatch(/backend/)
  })

  it('RATE_LIMITED inclui Retry-After', async () => {
    mockFetch({ '/api/config': () => new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'x' } }), { status: 429, headers: { 'retry-after': '42', 'content-type': 'application/json' } }) })
    const err = await api.config().catch((e) => e)
    expect(describeError(err).message).toContain('42 s')
  })

  it('envia o JWT quando há sessão e chama o handler em 401 (sessão expirada)', async () => {
    const { calls } = mockFetch({ '/api/history': () => apiError('UNAUTHORIZED', 'expirada', 401) })
    const onUnauthorized = vi.fn()
    setTokenProvider(async () => 'jwt-de-teste')
    setUnauthorizedHandler(onUnauthorized)
    await expect(api.history(10, 0)).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 })
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer jwt-de-teste')
    expect(onUnauthorized).toHaveBeenCalledOnce()
    setTokenProvider(async () => null)
    setUnauthorizedHandler(null)
  })

  it('o formulário de hide leva a senha no corpo (nunca no URL)', async () => {
    const { calls } = mockFetch({ '/api/hide': () => apiError('CAPACITY_EXCEEDED', 'não cabe') })
    await api.hide({ image: new File(['x'], 'a.png'), message: 'm', files: [], password: 'SenhaSecreta123', bits: 1, save: false }).catch(() => {})
    expect(calls[0].path).toBe('/api/hide')
    expect(calls[0].path).not.toContain('SenhaSecreta')
    expect((calls[0].init?.body as FormData).get('password')).toBe('SenhaSecreta123')
  })

  it('config devolve JSON tipado', async () => {
    mockFetch({ '/api/config': () => json({ limits: {}, accounts_enabled: true, record_ttl_days: 7, version: '1' }) })
    expect((await api.config()).accounts_enabled).toBe(true)
  })
})
