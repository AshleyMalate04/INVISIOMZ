/** SHA-256 de um ficheiro, calculado no navegador (o ficheiro não sai do computador). Devolve 64 caracteres hex em minúsculas. */
export async function sha256Hex(file: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Este navegador só calcula o SHA-256 em ligações seguras (HTTPS ou localhost).')
  }
  const digest = await subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Limpa o que o utilizador colou: espaços, quebras de linha, prefixo «SHA-256:» ou «sha256:», maiúsculas.
 * Devolve `null` se o resultado não tiver exactamente 64 caracteres hexadecimais.
 */
export function normalizeSha256(input: string): string | null {
  const cleaned = input
    .trim()
    .replace(/^sha-?256\s*[:=]?\s*/i, '')
    .replace(/[\s:-]/g, '')
    .toLowerCase()
  return /^[0-9a-f]{64}$/.test(cleaned) ? cleaned : null
}
