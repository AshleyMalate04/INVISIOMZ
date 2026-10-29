import { Check } from 'lucide-react'

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <nav aria-label="Progresso">
      <ol className="flex items-center gap-2 overflow-x-auto pb-1">
        {steps.map((label, i) => {
          const done = i < current
          const active = i === current
          return (
            <li key={label} className="flex min-w-0 flex-1 items-center gap-2" aria-current={active ? 'step' : undefined}>
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm font-semibold transition-colors ${
                  done
                    ? 'border-brand bg-brand text-on-brand'
                    : active
                      ? 'border-brand bg-brand-soft text-brand-strong'
                      : 'border-line-strong bg-surface text-ink-soft'
                }`}
              >
                {done ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
                <span className="sr-only">{done ? ' (concluído)' : active ? ' (passo actual)' : ''}</span>
              </span>
              <span className={`hidden truncate text-sm sm:inline ${active ? 'font-semibold text-ink' : 'text-ink-soft'}`}>{label}</span>
              {i < steps.length - 1 && <span className={`h-px flex-1 ${done ? 'bg-brand' : 'bg-line-strong'}`} aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-sm font-semibold text-ink sm:hidden">
        Passo {current + 1} de {steps.length}: {steps[current]}
      </p>
    </nav>
  )
}
