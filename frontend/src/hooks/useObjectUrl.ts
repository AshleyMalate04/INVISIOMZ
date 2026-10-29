import { useEffect, useState } from 'react'

/** Cria um URL de objecto para um Blob/File e liberta-o (`revokeObjectURL`) ao mudar ou ao sair. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      // Sincroniza com um recurso externo (URL de objecto do navegador): é o caso legítimo de setState em efeito.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrl(null)
      return
    }
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}
