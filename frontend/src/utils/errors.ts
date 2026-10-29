import { ApiError } from '../services/api'

export interface FriendlyError {
  title: string
  message: string
  hint?: string
}

const HINTS: Record<string, string> = {
  WRONG_PASSWORD_OR_TAMPERED:
    'Confirme a senha (maiúsculas e minúsculas contam). Se a imagem foi reenviada por uma aplicação que a recomprime, os dados perdem-se.',
  NO_HIDDEN_DATA: 'Use o PNG descarregado do InvisioMZ, sem o editar, redimensionar ou converter para outro formato.',
  CORRUPTED_IMAGE: 'Tente de novo com o ficheiro original descarregado.',
  TRUNCATED_PAYLOAD: 'A imagem foi cortada ou está incompleta. Use o ficheiro original.',
  UNSUPPORTED_VERSION: 'Actualize o InvisioMZ ou use a versão que criou a imagem.',
  ATTACHMENT_RECOVERY_FAILED: 'A senha estava certa, mas o conteúdo está danificado.',
  CAPACITY_EXCEEDED: 'Escolha uma imagem maior, reduza o conteúdo ou use o modo de 2 bits por canal.',
  UNSUPPORTED_IMAGE_FORMAT: 'Formatos aceites: PNG, JPG, WEBP, BMP, GIF, TIFF e ICO.',
  FILE_TOO_LARGE: 'Reduza o tamanho da imagem ou dos anexos.',
  RATE_LIMITED: 'Aguarde antes de tentar de novo.',
  UNAUTHORIZED: 'Entre novamente na sua conta.',
  NETWORK_ERROR: 'Verifique a ligação à internet e se o backend está a correr.',
}

const TITLES: Record<string, string> = {
  WRONG_PASSWORD_OR_TAMPERED: 'Senha errada ou imagem alterada',
  NO_HIDDEN_DATA: 'Sem dados escondidos',
  CORRUPTED_IMAGE: 'Imagem corrompida',
  TRUNCATED_PAYLOAD: 'Dados incompletos',
  UNSUPPORTED_VERSION: 'Versão não suportada',
  ATTACHMENT_RECOVERY_FAILED: 'Falha ao recuperar anexos',
  CAPACITY_EXCEEDED: 'O conteúdo não cabe na imagem',
  UNSUPPORTED_IMAGE_FORMAT: 'Formato não suportado',
  FILE_TOO_LARGE: 'Ficheiro demasiado grande',
  RATE_LIMITED: 'Demasiados pedidos',
  UNAUTHORIZED: 'Sessão inválida',
  NETWORK_ERROR: 'Sem ligação ao servidor',
  WEAK_PASSWORD: 'Senha demasiado curta',
  EMPTY_PAYLOAD: 'Nada para esconder',
  VALIDATION_ERROR: 'Dados inválidos',
  SERVICE_UNAVAILABLE: 'Serviço indisponível',
  STORAGE_ERROR: 'Falha no armazenamento',
  NOT_FOUND: 'Não encontrado',
  INTERNAL_ERROR: 'Erro interno',
}

export function describeError(err: unknown): FriendlyError {
  if (err instanceof ApiError) {
    let message = err.message
    if (err.code === 'RATE_LIMITED' && err.retryAfter) message += ` Tente de novo dentro de ${err.retryAfter} s.`
    if (err.correlationId && err.code === 'INTERNAL_ERROR') message += ` (ref. ${err.correlationId})`
    return { title: TITLES[err.code] ?? 'Erro', message, hint: HINTS[err.code] }
  }
  return { title: 'Erro inesperado', message: err instanceof Error ? err.message : 'Ocorreu um erro inesperado.' }
}
