import { describe, expect, it } from 'vitest'
import { normalizeSha256, sha256Hex } from './hash'

const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' // SHA-256("abc"), vector padrão FIPS 180-2

describe('sha256Hex', () => {
  it('calcula o SHA-256 correcto (vector padrão «abc»)', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe(ABC)
  })
  it('um único byte diferente muda tudo', async () => {
    expect(await sha256Hex(new Blob(['abd']))).not.toBe(ABC)
  })
  it('ficheiro vazio', async () => {
    expect(await sha256Hex(new Blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('normalizeSha256', () => {
  it('aceita minúsculas, maiúsculas, espaços, quebras de linha e prefixos', () => {
    expect(normalizeSha256(ABC)).toBe(ABC)
    expect(normalizeSha256(ABC.toUpperCase())).toBe(ABC)
    expect(normalizeSha256(`  ${ABC}\n`)).toBe(ABC)
    expect(normalizeSha256(`SHA256: ${ABC}`)).toBe(ABC)
    expect(normalizeSha256(`sha-256=${ABC}`)).toBe(ABC)
    expect(normalizeSha256(ABC.replace(/(.{8})/g, '$1 '))).toBe(ABC) // em blocos de 8, como alguns programas mostram
  })
  it('recusa o que não tem 64 caracteres hexadecimais', () => {
    expect(normalizeSha256('')).toBeNull()
    expect(normalizeSha256(ABC.slice(1))).toBeNull()
    expect(normalizeSha256(`${ABC}0`)).toBeNull()
    expect(normalizeSha256(`${'g'.repeat(64)}`)).toBeNull()
  })
})
