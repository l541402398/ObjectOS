// Runs before the first paint, independently of the React bundle. External for the production CSP.
(() => {
  let preferences = {}
  try {
    const raw = JSON.parse(localStorage.getItem('projectos.ui') || '{}')
    if (raw && raw.version === 1 && raw.state && raw.state.reduceMotion === true) {
      raw.state.reduceMotion = false
      raw.version = 2
      localStorage.setItem('projectos.ui', JSON.stringify(raw))
    }
    preferences = (raw && raw.state) || {}
  } catch { /* Defaults remain usable. */ }
  const root = document.documentElement
  const mode = preferences.themeMode || 'system'
  root.dataset.theme = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'
  root.dataset.reduceMotion = String(preferences.reduceMotion === true)
  root.dataset.reduceTransparency = String(preferences.reduceTransparency === true)
})()
