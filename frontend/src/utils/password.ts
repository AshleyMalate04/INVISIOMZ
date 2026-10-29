export interface Strength {
  score: 0 | 1 | 2 | 3 | 4
  label: string
  hints: string[]
  bits: number
}

const LABELS = ['Muito fraca', 'Fraca', 'Razoável', 'Forte', 'Excelente'] as const
const COMMON = ['password', 'senha', '123456', 'qwerty', 'abcdef', 'mocambique', 'moçambique', 'maputo', 'letmein', 'admin']

/** Estimativa simples por entropia (tamanho × conjunto de caracteres), com penalizações por padrões óbvios. */
export function passwordStrength(password: string, minLength = 10): Strength {
  const hints: string[] = []
  if (!password) return { score: 0, label: LABELS[0], hints: [`Use pelo menos ${minLength} caracteres.`], bits: 0 }

  let pool = 0
  if (/[a-zà-ÿ]/.test(password)) pool += 26
  if (/[A-ZÀ-ß]/.test(password)) pool += 26
  if (/\d/.test(password)) pool += 10
  if (/[^A-Za-z0-9à-ÿÀ-ß]/.test(password)) pool += 32
  const unique = new Set(password).size
  let bits = Math.log2(Math.max(pool, 2)) * Math.min(password.length, unique * 2)

  const lower = password.toLowerCase()
  if (COMMON.some((c) => lower.includes(c))) {
    bits *= 0.5
    hints.push('Evite palavras comuns.')
  }
  if (/(.)\1{2,}/.test(password)) {
    bits *= 0.8
    hints.push('Evite repetir o mesmo carácter.')
  }
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef)/i.test(password)) {
    bits *= 0.7
    hints.push('Evite sequências como 1234 ou abcd.')
  }
  if (password.length < minLength) hints.unshift(`Use pelo menos ${minLength} caracteres.`)
  else if (!/[^A-Za-z0-9]/.test(password) && password.length < 16) hints.push('Misture símbolos ou use uma frase longa.')

  let score: Strength['score'] = bits < 35 ? 0 : bits < 50 ? 1 : bits < 65 ? 2 : bits < 85 ? 3 : 4
  if (password.length < minLength) score = Math.min(score, 1) as Strength['score']
  return { score, label: LABELS[score], hints, bits: Math.round(bits) }
}
