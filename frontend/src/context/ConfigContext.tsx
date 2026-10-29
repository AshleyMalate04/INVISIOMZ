import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../services/api'
import { supabaseConfigured } from '../services/supabase'
import type { AppConfig } from '../types'

/** Limites por defeito (iguais aos do backend) usados enquanto /api/config não responde. */
export const DEFAULT_CONFIG: AppConfig = {
  limits: {
    max_image_bytes: 20 * 1024 * 1024,
    max_image_pixels: 12_000_000,
    max_files: 20,
    max_file_bytes: 10 * 1024 * 1024,
    max_total_bytes: 25 * 1024 * 1024,
    max_message_chars: 100_000,
    password_min_length: 10,
  },
  accounts_enabled: false,
  guest_allowed: false,
  record_ttl_days: 7,
  version: '—',
}

interface ConfigValue {
  config: AppConfig
  status: 'loading' | 'ready' | 'error'
  /** Contas disponíveis: Supabase configurado no frontend E activo no backend. */
  accountsAvailable: boolean
  reload: () => void
}

const ConfigContext = createContext<ConfigValue | null>(null)

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const [status, setStatus] = useState<ConfigValue['status']>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    api
      .config()
      .then((c) => {
        if (active) {
          setConfig(c)
          setStatus('ready')
        }
      })
      .catch(() => active && setStatus('error'))
    return () => {
      active = false
    }
  }, [attempt])

  const reload = useCallback(() => {
    setStatus('loading')
    setAttempt((n) => n + 1)
  }, [])

  const value = useMemo<ConfigValue>(
    () => ({ config, status, accountsAvailable: supabaseConfigured && config.accounts_enabled, reload }),
    [config, status, reload],
  )
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

export function useConfig(): ConfigValue {
  const ctx = useContext(ConfigContext)
  if (!ctx) throw new Error('useConfig fora de ConfigProvider')
  return ctx
}
