import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-contrast-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-contrast-user-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900', PROJECTOS_START_ROUTE: 'design-lab' }
delete env.ELECTRON_RUN_AS_NODE
let app = null

try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${userDataDir}`], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid="design-lab"]', { timeout: 20_000 })
  await page.waitForTimeout(1500)
  await page.locator('[data-testid="design-lab-task-t3"]').click()
  await page.waitForSelector('[data-testid="design-lab-inspector"]', { timeout: 10_000 })
  await page.waitForTimeout(500)

  const measure = () => page.evaluate(() => {
    const parse = (value) => {
      const match = value.match(/rgba?\(([^)]+)\)/)
      if (!match) return null
      const parts = match[1].split(',').map((part) => Number(part.trim()))
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 }
    }
    const composite = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    })
    const background = (element) => {
      let current = element
      const root = element.closest('.pdl-root')
      const dark = root?.getAttribute('data-theme') === 'dark'
      let result = dark ? { r: 11, g: 18, b: 34, a: 1 } : { r: 251, g: 253, b: 255, a: 1 }
      const stack = []
      while (current) {
        const color = parse(getComputedStyle(current).backgroundColor)
        if (color && color.a > 0) stack.push(color)
        if (current === root) break
        current = current.parentElement
      }
      for (const layer of stack.reverse()) result = composite(layer, result)
      return result
    }
    const luminance = ({ r, g, b }) => {
      const channel = (value) => { const c = value / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 }
      return .2126 * channel(r) + .7152 * channel(g) + .0722 * channel(b)
    }
    const ratio = (fg, bg) => {
      const a = luminance(fg); const b = luminance(bg)
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
    }
    const samples = [
      ['task-title', '.pdl-task-copy strong'],
      ['task-secondary', '.pdl-task-copy span'],
      ['plan-meta', '.pdl-plan-meta'],
      ['inspector-body', '.pdl-inspector-description'],
      ['inspector-label', '.pdl-field-label'],
    ].map(([name, selector]) => {
      const element = document.querySelector(selector)
      if (!element) return { name, ratio: null }
      const style = getComputedStyle(element)
      const fg = parse(style.color)
      const bg = background(element)
      return { name, ratio: Number(ratio(composite(fg, bg), bg).toFixed(2)), color: style.color, background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`, fontSize: style.fontSize }
    })
    const surfaces = ['.pdl-ledger-panel', '.pdl-review-panel', '.pdl-inspector'].map((selector) => {
      const element = document.querySelector(selector)
      if (!element) return { selector, opacity: null, filter: null, backdropFilter: null }
      const style = getComputedStyle(element)
      return { selector, opacity: style.opacity, filter: style.filter, backdropFilter: style.backdropFilter }
    })
    return { samples, surfaces }
  })
  const light = await measure()
  await page.getByRole('button', { name: '关闭任务检查器' }).click()
  await page.waitForTimeout(250)
  await page.getByRole('button', { name: '切换到暗色' }).click()
  await page.waitForTimeout(500)
  await page.locator('[data-testid="design-lab-task-t3"]').click()
  await page.waitForSelector('[data-testid="design-lab-inspector"]', { timeout: 10_000 })
  await page.waitForTimeout(400)
  const dark = await measure()
  console.log('LIGHT', JSON.stringify(light, null, 2))
  console.log('DARK', JSON.stringify(dark, null, 2))
  const failed = [...light.samples, ...dark.samples].filter((sample) => sample.ratio === null || sample.ratio < 4.5)
  if (failed.length) { console.error('CONTRAST FAIL', failed); process.exitCode = 1 }
  else console.log('CONTRAST PASS — light and dark sampled text ≥4.5:1 on composited surfaces')
} catch (error) {
  console.error('CONTRAST PROBE FAIL', error)
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
}
