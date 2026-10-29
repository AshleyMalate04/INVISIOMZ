import type { RouteObject } from 'react-router-dom'
import { Layout } from './components/Layout'
import { RequireAuth } from './components/RequireAuth'
import { HomePage } from './pages/Home'
import { DashboardPage } from './pages/Dashboard'
import { HidePage } from './pages/Hide'
import { ExtractPage } from './pages/Extract'
import { HistoryPage } from './pages/History'
// import { LearnPage } from './pages/Learn' // «Aprender» desligado de propósito
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from './pages/Auth'
import { SettingsPage } from './pages/Settings'
import { NotFoundPage } from './pages/NotFound'

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/painel', element: <RequireAuth><DashboardPage /></RequireAuth> },
      { path: '/ocultar', element: <RequireAuth guestOk><HidePage /></RequireAuth> },
      { path: '/extrair', element: <RequireAuth guestOk><ExtractPage /></RequireAuth> },
      { path: '/historico', element: <RequireAuth><HistoryPage /></RequireAuth> },
      // { path: '/aprender', element: <LearnPage /> }, // «Aprender» desligado de propósito
      { path: '/entrar', element: <LoginPage /> },
      { path: '/registar', element: <RegisterPage /> },
      { path: '/recuperar-senha', element: <ForgotPasswordPage /> },
      { path: '/redefinir-senha', element: <ResetPasswordPage /> },
      { path: '/definicoes', element: <RequireAuth><SettingsPage /></RequireAuth> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
