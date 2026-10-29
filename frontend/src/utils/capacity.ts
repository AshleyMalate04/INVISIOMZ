import type { Bits, CapacityInfo } from '../types'
import { utf8Length } from './format'

/** Mesmas fórmulas do backend (`app/steganography/capacity.py`). */
export const HEADER_BYTES = 46
export const AEAD_TAG_BYTES = 16

export function rawCapacityBytes(width: number, height: number, bits: Bits): number {
  return Math.floor((width * height * 3 * bits) / 8)
}

export function usefulCapacityBytes(width: number, height: number, bits: Bits): number {
  const slots = width * height * 3 - HEADER_BYTES * 8
  return Math.max(0, Math.floor((Math.max(0, slots) * bits) / 8) - AEAD_TAG_BYTES)
}

/**
 * Estimativa conservadora do tamanho do pacote (ZIP + manifesto). O backend é quem decide; esta estimativa
 * serve para a barra de utilização e para avisar antes de enviar.
 */
export function estimatePackageBytes(
  message: string,
  files: { name: string; size: number }[],
  overhead: CapacityInfo['overhead'],
): number {
  const messageJson = message.trim() ? utf8Length(JSON.stringify(message)) : 0
  let total = overhead.fixed_bytes + messageJson
  for (const f of files) total += f.size + overhead.per_file_bytes + utf8Length(f.name)
  return total
}
