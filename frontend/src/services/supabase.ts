import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Só a chave *anon* (pública). A service_role vive apenas no backend. */
export const supabase: SupabaseClient | null =
  url && anon && !anon.startsWith('coloque-aqui')
    ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null

export const supabaseConfigured = supabase !== null
