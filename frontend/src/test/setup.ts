import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

// jsdom não implementa estas APIs do navegador.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
window.scrollTo = (() => {}) as typeof window.scrollTo

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
}

let counter = 0
const created = new Map<string, Blob>()
URL.createObjectURL = (blob: Blob | MediaSource) => {
  const url = `blob:test/${++counter}`
  created.set(url, blob as Blob)
  return url
}
URL.revokeObjectURL = (url: string) => {
  created.delete(url)
}
export const liveObjectUrls = () => created.size
