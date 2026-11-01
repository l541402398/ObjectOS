/** Composited contrast probe for translucent glass: hides the text, samples the real pixels behind it, restores. */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const out = resolve(process.argv[2] ?? 'docs/v2/evidence/glass-shell/after')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-contrast-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_SEED_DEMO: '0', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const samples = [
  ['page title', '.po-page-title'], ['requirement title', '.rq-heading h2'], ['journey stage', '.rq-flow-journey button strong'],
  ['journey state (13px)', '.rq-flow-journey button > span:last-child'], ['facts', '.rq-next-facts span'], ['task title', '.rq-task-title'],
  ['task meta (13px)', '.rq-task-meta span'], ['list label (13px)', '.rq-list-label'], ['requirement item meta', '.rq-requirement span'],
  ['sidebar status bar (12px)', '.po-statusbar'], ['default button', '.rq-next-action .ant-btn:not(.ant-btn-primary) span:last-child'], ['primary button', '.ant-btn-primary span:last-child'],
]
const results = []
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], cwd: resolve('apps/desktop'), env, timeout: 60000 })
try {
  const page = await app.firstWindow(); const win = await app.browserWindow(page)
  await page.locator('.po-shell').waitFor({ timeout: 60000 })
  const rootPath = join(profile, 'project')
  const project = (await page.evaluate(rootPath => window.projectos.projects.create({ name: 'Aurora Notes', rootPath, createDirectory: true, initGit: true }), rootPath)).project
  const req = (await page.evaluate(projectId => window.projectos.requirements.create({ projectId, title: '跨设备编辑的一致性与恢复体验', body: '', source: 'local', acceptanceCriteria: [], workflow: { templateVersionId: 'wfv_standard1', assignmentMode: 'manual', assignments: { 'stage-1': 'agt_product', 'stage-2': 'agt_reviewer', 'stage-3': 'agt_architect', 'stage-4': 'agt_reviewer', 'stage-5': 'agt_engineer', 'stage-6': 'agt_qa' } } }), project.id)).requirement
  await page.evaluate(input => window.projectos.tasks.create(input), { projectId: project.id, requirementId: req.id, title: '保存草稿并在重启后恢复', acceptanceCriteria: ['恢复'] })
  await page.evaluate(h => { location.hash = h }, `#/projects/${project.id}/requirements?requirement=${req.id}`)
  await page.locator('.rq-next-action').waitFor()
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme }); await page.waitForTimeout(800)
    for (const [name, selector] of samples) {
      const box = await page.evaluate(sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const c = getComputedStyle(el).color.match(/[\d.]+/g).map(Number); el.dataset.probeColor = el.style.color; el.style.color = 'transparent'; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), color: c.slice(0, 3), size: getComputedStyle(el).fontSize } }, selector)
      if (!box) { results.push({ theme, name, status: 'SKIP' }); continue }
      await page.waitForTimeout(80)
      const bg = await win.evaluate(async (w, p) => { const img = await w.webContents.capturePage({ x: p.x, y: p.y, width: 1, height: 1 }); const b = img.toBitmap(); return [b[2], b[1], b[0]] }, box)
      await page.evaluate(sel => { const el = document.querySelector(sel); el.style.color = el.dataset.probeColor ?? '' }, selector)
      const value = Math.round(ratio(box.color, bg) * 100) / 100
      results.push({ theme, name, size: box.size, text: box.color, background: bg, ratio: value, status: value >= 4.5 ? 'PASS' : 'FAIL' })
      console.log(`${value >= 4.5 ? 'PASS' : 'FAIL'} ${theme} ${name} ${box.size} ${value}:1`)
    }
  }
} finally {
  await app.close()
  writeFileSync(join(out, 'contrast.json'), JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), method: 'Text hidden, 1px composited pixel at the text box centre captured with webContents.capturePage; compared with computed text colour (WCAG 2.x).', results }, null, 2))
}
