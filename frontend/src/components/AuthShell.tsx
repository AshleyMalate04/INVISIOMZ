import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Logo } from './Logo'

/**
 * Estrutura dos ecrãs de entrada (Entrar, Criar conta, Recuperar/Redefinir senha):
 * sem cabeçalho nem rodapé, só o ícone ao centro e uma seta no canto superior esquerdo para voltar ao início.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center px-4 pb-12 pt-20 sm:pt-16">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-lg bg-brand px-4 py-2 font-semibold text-on-brand focus:not-sr-only focus:fixed focus:right-4 focus:top-4"
      >
        Saltar para o conteúdo
      </a>
      <Link
        to="/"
        aria-label="Voltar à página inicial"
        title="Voltar à página inicial"
        className="absolute left-4 top-4 grid h-11 w-11 place-items-center rounded-xl text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink sm:left-6 sm:top-6"
      >
        <ArrowLeft className="h-6 w-6" aria-hidden="true" />
      </Link>

      <div className="mb-8 flex justify-center" aria-hidden="true">
        <Logo size={72} withText={false} />
      </div>

      <div className="flex w-full max-w-md flex-1 flex-col">{children}</div>
    </div>
  )
}
