import { describe, expect, it } from 'vitest'
import { formatBytes, formatPercent, formatSignedBytes, formatSizeChange } from './format'
import { estimatePackageBytes, rawCapacityBytes, usefulCapacityBytes } from './capacity'
import { passwordStrength } from './password'

describe('formatBytes', () => {
  it('usa B, KB e MB com 1–2 casas decimais e vírgula decimal', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toMatch(/^1,5 KB$/)
    expect(formatBytes(2.4 * 1024 * 1024)).toMatch(/^2,4 MB$/)
    expect(formatBytes(5.1 * 1024 * 1024)).toMatch(/^5,1 MB$/)
    expect(formatBytes(1024 * 1024 * 1.05)).toMatch(/^1,05 MB$/)
  })
  it('rejeita valores inválidos', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})

describe('formatSizeChange', () => {
  it('mostra original → final com percentagem (exemplo do enunciado)', () => {
    const out = formatSizeChange(2.4 * 1024 * 1024, 5.1 * 1024 * 1024)
    expect(out).toContain('2,4 MB → 5,1 MB')
    expect(out).toContain('+113 %') // (5,1 − 2,4) / 2,4 = 112,5 %
  })
  it('trata diminuição e divisão por zero', () => {
    expect(formatSizeChange(1000, 500)).toContain('−50 %')
    expect(formatSizeChange(0, 500)).toContain('0 %')
    expect(formatSignedBytes(1000, 3048)).toBe('+2 KB')
  })
  it('formata percentagens', () => {
    expect(formatPercent(12.34, 1)).toBe('12,3 %')
  })
})

describe('capacidade (mesmas fórmulas do backend)', () => {
  it('capacidade bruta: largura × altura × 3 × bits ÷ 8', () => {
    expect(rawCapacityBytes(1000, 1000, 1)).toBe(375_000)
    expect(rawCapacityBytes(1000, 1000, 2)).toBe(750_000)
    expect(rawCapacityBytes(1920, 1080, 1)).toBe(777_600)
  })
  it('capacidade útil desconta cabeçalho (368 posições) e tag GCM (16 B)', () => {
    expect(usefulCapacityBytes(1000, 1000, 1)).toBe(374_938) // valor do pytest: 375000 − 46 − 16
    expect(usefulCapacityBytes(1, 1, 1)).toBe(0)
  })
  it('estimativa do pacote soma conteúdo e sobrecargas', () => {
    const overhead = { header_bytes: 46, aead_tag_bytes: 16, fixed_bytes: 200, per_file_bytes: 300 }
    expect(estimatePackageBytes('', [], overhead)).toBe(200)
    expect(estimatePackageBytes('olá', [{ name: 'a.txt', size: 1000 }], overhead)).toBe(200 + new TextEncoder().encode('"olá"').length + 1000 + 300 + 5)
  })
})

describe('passwordStrength', () => {
  it('senha vazia ou curta nunca passa de «fraca»', () => {
    expect(passwordStrength('').score).toBe(0)
    expect(passwordStrength('Ab1!xY').score).toBeLessThanOrEqual(1)
  })
  it('penaliza palavras comuns e sequências', () => {
    expect(passwordStrength('password1234').score).toBeLessThanOrEqual(2)
    expect(passwordStrength('aaaaaaaaaaaa').score).toBeLessThanOrEqual(1)
  })
  it('frases longas e variadas são fortes', () => {
    expect(passwordStrength('Maputo-pao-quente-2026!').score).toBeGreaterThanOrEqual(3)
  })
})
