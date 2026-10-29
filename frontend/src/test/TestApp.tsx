import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { Providers } from '../providers'
import { routes } from '../routes'

/** Aplicação completa com router em memória (o `useBlocker` exige um *data router*). */
export function TestApp({ initialEntries }: { initialEntries: string[] }) {
  const router = createMemoryRouter(routes, { initialEntries })
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  )
}
