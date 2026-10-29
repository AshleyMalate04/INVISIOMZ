import type { ReactNode } from 'react'

export function PageHeader({ title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="rise mb-8 max-w-3xl space-y-3">
     
      <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{title}</h1>
      {children && <div className="text-base text-ink-soft">{children}</div>}
    </header>
  )
}
