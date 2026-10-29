import { useEffect, useState } from 'react'
import { ShieldQuestion
  
 } from 'lucide-react'
import { Alert, TextField } from './ui'
import { normalizeSha256, sha256Hex } from '../utils/hash'

type Computed = { file: File; hash: string | null; error: string | null }

/**
 * Verificação opcional: compara o SHA-256 do ficheiro escolhido com o código que o InvisioMZ mostrou ao criar a
 * imagem. Serve para saber, antes de extrair, se o PNG chegou intacto (sem recompressão, edição ou corrupção).
 */
export function IntegrityCheck({ file }: { file: File }) {
  const [computed, setComputed] = useState<Computed | null>(null)
  const [pasted, setPasted] = useState('')

  useEffect(() => {
    let active = true
    sha256Hex(file)
      .then((hash) => active && setComputed({ file, hash, error: null }))
      .catch((e: unknown) => active && setComputed({ file, hash: null, error: e instanceof Error ? e.message : 'Não foi possível calcular o código.' }))
    return () => {
      active = false
    }
  }, [file])

  // O resultado só vale para o ficheiro actual (evita mostrar o código do ficheiro anterior).
  const current = computed && computed.file === file ? computed : null
  const expected = pasted.trim() ? normalizeSha256(pasted) : null
  const malformed = pasted.trim() !== '' && expected === null

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface-2/50 p-4" aria-labelledby="integridade-titulo">
      <div className="space-y-1">
        <h3 id="integridade-titulo" className="flex items-center gap-2 text-sm font-semibold">
          <ShieldQuestion className="h-4 w-4 text-brand-strong" aria-hidden="true" />
          Verificar se o ficheiro está intacto <span className="text-xs font-normal text-ink-soft">opcional</span>
        </h3>
        <p className="text-xs text-ink-soft">
          Cole o código SHA-256 que a aplicação mostrou quando criou esta imagem. O cálculo é feito aqui, no seu navegador.
        </p>
      </div>

      <TextField
        label="SHA-256 original"
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        placeholder="64 caracteres, por exemplo 12dbb79d4531…"
        spellCheck={false}
        autoComplete="off"
        className="font-mono text-xs"
        error={malformed ? 'Código inválido: deve ter 64 caracteres (0–9 e a–f).' : null}
      />

      <div aria-live="polite" className="space-y-3">
        {current?.error && <Alert kind="warn">{current.error}</Alert>}

        {!current && <p className="text-xs text-ink-soft">A calcular o código do ficheiro…</p>}

        {current?.hash && expected && current.hash === expected && (
          <Alert kind="success" title="Ficheiro intacto">
            {/* <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              O código coincide: este é exactamente o PNG que o InvisioMZ criou.
            </span> */}
          </Alert>
        )}

        {current?.hash && expected && current.hash !== expected && (
          <Alert kind="error" title="Ficheiro diferente do original">
            <span className="flex items-start gap-2">
              {/* <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" /> */}
              {/* <span>
                O código não coincide, pois o ficheiro foi alterado ou corrompido. Isto acontece se o PNG foi editado, recomprimido ou enviado por aplicações como o WhatsApp.
              </span> */}
            </span>
          </Alert>
        )}

        {current?.hash && (
          <div className="space-y-1.5">
            {/* <div className="flex items-center justify-between gap-2">
              <span className="text-xs uppercase tracking-wide text-ink-soft">SHA-256 deste ficheiro</span>
              <CopyButton text={current.hash} />
            </div> */}
            {/* <p className="break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs">{current.hash}</p> */}
          </div>
        )}
      </div>
    </section>
  )
}
