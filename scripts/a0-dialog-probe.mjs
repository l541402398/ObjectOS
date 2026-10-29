import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const dataDir = join(mkdtempSync(join(tmpdir(), 'probe-')), 'data')
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900', PROJECTOS_START_ROUTE: 'precision-lab' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.pw-root')
  await page.evaluate(() => { window.location.hash = '#/precision-lab?screen=requirements&theme=light' })
  await page.reload()
  await page.waitForSelector('.pw-root')
  await page.getByRole('button', { name: '创建需求' }).first().click()
  await page.waitForTimeout(600)
  const info = await page.evaluate(() => {
    const dialog = document.querySelector('.pw-dialog')
    const portal = dialog?.closest('.pw-portal')
    const cs = dialog ? getComputedStyle(dialog) : null
    const ps = portal ? getComputedStyle(portal) : null
    const root = document.querySelector('.pw-root')
    const rules = []
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && (rule.selectorText.includes('pw-dialog') || rule.selectorText.includes('pw-theme') || rule.selectorText.includes('pw-portal'))) rules.push(rule.selectorText.slice(0, 120))
        }
      } catch {}
    }
    return {
      dialogExists: Boolean(dialog),
      portalExists: Boolean(portal),
      dialogParentClass: dialog?.parentElement?.className,
      dialogPosition: cs?.position,
      dialogBackground: cs?.backgroundColor,
      dialogBorder: cs?.borderTopColor,
      dialogVarSurface: cs?.getPropertyValue('--pw-surface'),
      portalVarSurface: ps?.getPropertyValue('--pw-surface'),
      rootVarSurface: root ? getComputedStyle(root).getPropertyValue('--pw-surface') : null,
      portalDisplay: ps?.display,
      bodyChildren: [...document.body.children].map((el) => `${el.tagName}.${el.className}`).slice(-6),
      ruleCount: rules.length,
      rules: rules.slice(0, 10),
    }
  })
  console.log(JSON.stringify(info, null, 2))
} finally { await app.close() }
