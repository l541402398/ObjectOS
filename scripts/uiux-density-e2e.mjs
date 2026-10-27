import { _electron as electron } from 'playwright-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-density-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 30_000 })
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 30_000 })
  if (await page.locator('.v16-project-visual').count()) await page.locator('.v16-project-visual').first().click()
  await page.waitForSelector('.po-work-center', { timeout: 30_000 })
  const setup = await page.evaluate(async () => {
    const project = (await window.projectos.projects.list()).projects[0]
    const lifecycle = await window.projectos.lifecycle.overview(project.id)
    const version = lifecycle.versions[0]
    for (let i = 0; i < 100; i += 1) {
      await window.projectos.release.createChangeRequest({
        projectId: project.id, versionId: version.id, title: `Density change ${String(i + 1).padStart(3, '0')}`,
        description: `Synthetic UI density fixture ${i + 1}`, sourceType: 'manual', sourceId: null,
        riskLevel: 'low', impactScope: '', targetEnvironmentId: null, linkedArtifactIds: [], linkedTaskIds: [],
      })
      await window.projectos.resources.create({
        projectId: project.id, type: 'host', name: `Density host ${String(i + 1).padStart(3, '0')}`,
        endpoint: `10.0.0.${(i % 250) + 1}`, purpose: 'density fixture', labels: [], metadata: {},
      })
    }
    return { projectId: project.id, versionId: version.id }
  })
  console.log('[density] fixture created (100 changes, 100 resources)')

  const started = Date.now()
  await page.evaluate(({ projectId, versionId }) => { location.hash = `#/projects/${projectId}/releases?version=${versionId}` }, setup)
  await page.waitForSelector('.rw-shell', { timeout: 30_000 })
  await page.getByRole('button', { name: /^变更/ }).click()
  await page.waitForSelector('.rw-row', { timeout: 15_000 })
  const rows = await page.locator('.rw-row').count()
  if (rows < 100) throw new Error(`release list only rendered ${rows} rows`)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  if (overflow) throw new Error('release density page has horizontal overflow')
  console.log(`[density] release list ${rows} rows rendered in ${Date.now() - started}ms`)
  await page.screenshot({ path: join(root, 'docs', 'screenshots', '1440x900-light-release-density-100.png') })

  const resourceStarted = Date.now()
  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/connections` }, setup)
  await page.waitForSelector('.rc-shell', { timeout: 30_000 })
  const resourceRows = await page.locator('.rc-row').count()
  if (resourceRows < 100) throw new Error(`resource list only rendered ${resourceRows} rows`)
  const resourceOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  if (resourceOverflow) throw new Error('resource density page has horizontal overflow')
  console.log(`[density] resource list ${resourceRows} rows rendered in ${Date.now() - resourceStarted}ms`)
  await page.screenshot({ path: join(root, 'docs', 'screenshots', '1440x900-light-resources-density-100.png') })
  console.log('UIUX DENSITY E2E PASS')
} finally {
  await app.close()
  rmSync(dataDir, { recursive: true, force: true })
}
