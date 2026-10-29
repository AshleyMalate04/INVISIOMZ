// Aplica o tema guardado antes da primeira pintura (evita «flash» de tema errado). Ficheiro externo: compatível com CSP.
try {
  var t = localStorage.getItem('invisiomz-theme') || 'system'
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
} catch (e) {}
