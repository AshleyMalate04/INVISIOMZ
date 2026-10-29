export type Bits = 1 | 2

export interface Limits {
  max_image_bytes: number
  max_image_pixels: number
  max_files: number
  max_file_bytes: number
  max_total_bytes: number
  max_message_chars: number
  password_min_length: number
}

export interface AppConfig {
  limits: Limits
  accounts_enabled: boolean
  guest_allowed: boolean
  record_ttl_days: number
  version: string
}

export interface ModeCapacity {
  raw_capacity_bytes: number
  useful_capacity_bytes: number
}

export interface CapacityInfo {
  width: number
  height: number
  format: string
  original_size_bytes: number
  warnings: string[]
  bits: number
  raw_capacity_bytes: number
  useful_capacity_bytes: number
  modes: Record<string, ModeCapacity>
  overhead: { header_bytes: number; aead_tag_bytes: number; fixed_bytes: number; per_file_bytes: number }
  limits: Limits
}

export interface HideMeta {
  output_filename: string
  width: number
  height: number
  original_format: string
  original_size_bytes: number
  output_size_bytes: number
  sha256: string
  bits: number
  package_bytes: number
  useful_capacity_bytes: number
  file_count: number
  has_message: boolean
  duration_ms: number
  warnings: string[]
}

export type HideOutcome =
  | { kind: 'png'; blob: Blob; meta: HideMeta; saveFailed: boolean }
  | { kind: 'saved'; blob: Blob | null; signedUrl: string; operationId: string; expiresAt: string; meta: HideMeta }

export interface ExtractedFile {
  id: string
  name: string
  size: number
  sha256: string
  mime: string
  content_b64: string | null
  download_token: string | null
}

export interface ExtractResult {
  message: string | null
  files: ExtractedFile[]
  zip_token: string | null
  inline: boolean
  total_bytes: number
  bits: number
  width: number
  height: number
  duration_ms: number
  token_ttl_s: number
}

export interface HistoryFile {
  id: string
  size_bytes: number
  sha256: string
  label: string | null
  created_at: string
  expires_at: string
  expired: boolean
}

export interface HistoryItem {
  id: string
  type: 'hide' | 'extract'
  status: 'success' | 'failed'
  error_code: string | null
  bits_per_channel: number | null
  image_width: number | null
  image_height: number | null
  payload_bytes: number
  file_count: number
  has_message: boolean
  duration_ms: number
  created_at: string
  file: HistoryFile | null
}

export interface HistoryPage {
  items: HistoryItem[]
  total: number
  limit: number
  offset: number
}

export interface DashboardData {
  totals: { operations: number; hide: number; extract: number; success: number; failed: number }
  saved: { count: number; bytes: number; expiring_soon: number; expired: number }
  last_7_days: { date: string; hide: number; extract: number }[]
  recent: HistoryItem[]
  truncated: boolean
}
