import { Compass } from 'lucide-react'
import { EmptyState, LinkButton } from '../components/ui'

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass className="h-7 w-7" aria-hidden="true" />}
      title="Página não encontrada"
      action={<LinkButton to="/">Voltar ao início</LinkButton>}
    >
      O endereço que abriu não existe no InvisioMZ.
    </EmptyState>
  )
}
