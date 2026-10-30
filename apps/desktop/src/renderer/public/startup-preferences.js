// Runs before the first paint, independently of the React bundle. External for the production CSP.
(() => {
  let preferences = {}
  try { preferences = JSON.parse(localStorage.getItem('projectos.ui') || '{}').state || {} } catch { /* Defaults remain usable. */ }
  const root = document.documentElement
  const mode = preferences.themeMode || 'system'
  root.dataset.theme = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
  root.dataset.reduceMotion = String(preferences.reduceMotion === true)
  root.dataset.reduceTransparency = String(preferences.reduceTransparency === true)
})()
