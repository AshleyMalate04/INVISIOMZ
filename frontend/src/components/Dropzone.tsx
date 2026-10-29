import { useId, useRef, useState, type ReactNode } from 'react'
import { UploadCloud } from 'lucide-react'

interface DropzoneProps {
  label: string
  description?: ReactNode
  accept?: string
  multiple?: boolean
  disabled?: boolean
  onFiles: (files: File[]) => void
  compact?: boolean
}

/** Zona de largar + selector. Todo o fluxo é utilizável só com teclado (Enter/Espaço abrem o selector). */
export function Dropzone({ label, description, accept, multiple, disabled, onFiles, compact }: DropzoneProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function handle(list: FileList | null) {
    if (!list || list.length === 0) return
    onFiles(Array.from(list))
    if (inputRef.current) inputRef.current.value = '' // permite escolher o mesmo ficheiro outra vez
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled) handle(e.dataTransfer.files)
      }}
      className={`rounded-2xl border-2 border-dashed text-center transition-colors ${compact ? 'p-5' : 'p-8'} ${
        over ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface-2/60 hover:border-brand/60'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => handle(e.target.files)}
      />
      <label htmlFor={id} className="flex cursor-pointer flex-col items-center gap-2 focus-within:outline-none">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand-strong">
          <UploadCloud className="h-6 w-6" aria-hidden="true" />
        </span>
        <span className="text-sm font-semibold text-ink">{label}</span>
        {description && <span className="max-w-sm text-xs text-ink-soft">{description}</span>}
        <span className="mt-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold text-ink">
          Escolher {multiple ? 'ficheiros' : 'ficheiro'}
        </span>
      </label>
    </div>
  )
}
