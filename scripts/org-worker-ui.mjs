import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Real UI and typed IPC, with a controlled response to the actual Main-owned native consent port. */
export async function exerciseWorkers({ page, app, dataDir, matrix, capture, check, waitFor, evidence, setUnavailable }) {
  const audit = [], require = createRequire(import.meta.url)
  const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
  const runAxe = async (state) => {
    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode })
      await page.waitForFunction((mode) => document.documentElement.dataset.theme === mode, mode)
      await page.waitForTimeout(200)
      await page.evaluate(axeSource)
      const result = await page.evaluate(async () => {
        const result = await window.axe.run({ include: ['[data-testid="organization-panel"]'] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } })
        return { violations: result.violations.map(({ id, impact, description, nodes }) => ({ id, impact, description, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), incomplete: result.incomplete.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })), passes: result.passes.length }
      })
      audit.push({ state, theme: mode, ...result })
      writeFileSync(join(evidence, 'axe-audit.json'), JSON.stringify({ tool: 'axe-core 4.14.0', scope: 'actual organization panel; not a screen-reader certification', states: audit }, null, 2))
      check(`axe ${state} ${mode} has no violations`, result.violations.length === 0, result.violations.map((v) => v.id).join(', '))
    }
    await page.emulateMedia({ colorScheme: 'light' })
  }
  const settled = async () => waitFor(async () => await page.getByTestId('organization-workers').getAttribute('aria-busy') === 'false', 'device query settled')
  const view = async () => page.evaluate(() => window.projectos.organization.workers())
  const root = join(dataDir, 'workspaces', 'ClarityStudio')
  mkdirSync(join(root, 'src'), { recursive: true })
  const created = await page.evaluate((rootPath) => window.projectos.projects.create({ name: '澄光研发工作区', rootPath, createDirectory: false, initGit: false }), root)
  await app.evaluate(({ dialog }) => {
    globalThis.__workerOriginalDialog = dialog.showMessageBox
    globalThis.__workerAccept = false
    globalThis.__workerDialog = null
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__workerDialog = options
      return { response: globalThis.__workerAccept ? 1 : 0, checkboxChecked: false }
    }
  })
  try {
    await page.getByRole('button', { name: '执行端', exact: true }).click()
    await page.getByTestId('worker-enroll').waitFor()
    await capture('workers-empty-1440-light')
    await runAxe('empty')
    await page.getByTestId('worker-enroll').focus(); await page.keyboard.press('Enter')
    check('Enrollment moves keyboard focus to device name', await page.getByTestId('worker-name').evaluate((el) => el === document.activeElement))
    await page.getByTestId('worker-name').fill('澄光设计工作站')
    await page.getByTestId('worker-enroll-submit').click()
    await page.getByTestId('worker-link').waitFor()
    let data = await view()
    const workerId = data.currentWorkerId
    check('Real device enrolled and heartbeat is online', data.workers.find((w) => w.id === workerId)?.status === 'online')
    check('Execution capability is not falsely advertised', data.workers.every((w) => w.executionReady === false))
    check('Typed IPC contains no worker credential', !JSON.stringify(data).includes('secret') && !JSON.stringify(data).includes('desktop_session_hash'))
    check('Worker identity is encrypted with the existing Main vault', !readFileSync(join(dataDir, 'organization-session.vault')).includes(Buffer.from(workerId)))
    await matrix('workers-registered'); await runAxe('registered')
    await page.getByTestId('worker-link').click()
    await page.getByTestId('worker-shared-project').selectOption((await page.evaluate(() => window.projectos.organization.projects())).projects[0].id)
    await page.getByTestId('worker-local-project').selectOption(created.project.id)
    await page.getByTestId('worker-directories').fill('src')
    await matrix('worker-consent-form'); await runAxe('consent-form')
    await page.getByTestId('worker-grant-submit').click()
    await page.getByText('已取消本机项目授权。', { exact: true }).waitFor()
    data = await view()
    check('Declined native consent creates no active grant', data.grants.length === 0 && data.local.grants.every((g) => g.status === 'revoked'))
    const native = await app.evaluate(() => globalThis.__workerDialog)
    check('Main consent uses the real local root and conservative default', native.defaultId === 0 && native.cancelId === 0 && native.detail.includes(realpathSync.native(root)) && native.detail.includes('只读') && native.detail.includes('src'))
    await capture('worker-consent-declined')
    await app.evaluate(() => { globalThis.__workerAccept = true })
    await page.getByTestId('worker-grant-submit').click()
    await page.getByText('项目已关联，授权范围已保存。', { exact: true }).waitFor()
    data = await view()
    let grant = data.local.grants.find((g) => g.status === 'active')
    check('Grant commits to both actual PostgreSQL and local SQLite', !!grant && data.grants.some((g) => g.id === grant.id && g.status === 'active'))
    check('Consent freezes the exact path/tool/budget scope', grant.scope.directories.join(',') === 'src' && grant.scope.tools.join(',') === 'list_directory,read_file' && grant.scope.maxToolCalls === 20 && grant.consentAt > 0)
    await matrix('worker-project-grant'); await runAxe('authorized')
    await page.getByTestId(`worker-open-${workerId}`).click()
    check('Device detail receives keyboard focus', await page.locator('.ow-device-heading h4').evaluate((el) => el === document.activeElement))
    await matrix('worker-device-detail'); await runAxe('detail')
    await page.getByTestId('worker-pause').click(); await page.getByTestId('worker-state-confirm').click()
    await page.getByRole('button', { name: '恢复连接', exact: true }).waitFor()
    data = await view()
    check('Pausing revokes persisted local and server grants', data.local.grants.every((g) => g.status === 'revoked') && data.grants.every((g) => g.status === 'revoked'))
    await capture('worker-paused')
    await page.getByTestId('worker-pause').click(); await page.getByTestId('worker-state-confirm').click()
    await page.getByRole('button', { name: '暂停设备', exact: true }).waitFor()
    await page.getByRole('button', { name: '所有设备', exact: true }).click()
    const grantAgain = async () => {
      await page.getByTestId('worker-link').click()
      await page.getByTestId('worker-shared-project').selectOption((await page.evaluate(() => window.projectos.organization.projects())).projects[0].id)
      await page.getByTestId('worker-local-project').selectOption(created.project.id)
      await page.getByTestId('worker-directories').fill('src')
      await page.getByTestId('worker-grant-submit').click()
      await page.getByText('项目已关联，授权范围已保存。', { exact: true }).waitFor()
      return (await view()).local.grants.find((g) => g.status === 'active')
    }
    grant = await grantAgain()
    setUnavailable(true)
    await page.getByTestId(`worker-revoke-${grant.id}`).click(); await page.getByTestId('worker-revoke-confirm').click()
    await page.getByText('本机授权已撤销；联网后同步撤销记录。', { exact: true }).waitFor()
    await capture('worker-offline-local-revoke')
    check('Offline revocation is shown as locally effective, pending sync', await page.getByText('本机已撤销 · 待同步', { exact: true }).count() > 0)
    setUnavailable(false)
    await settled()
    await page.getByRole('button', { name: '刷新设备', exact: true }).click()
    await settled()
    data = await view()
    check('Recovery synchronizes the durable revocation', data.local.grants.find((g) => g.id === grant.id).remoteSynced && data.grants.find((g) => g.id === grant.id).status === 'revoked')
    grant = await grantAgain()
    const overflow = await page.getByTestId('organization-workers').evaluate((el) => ({ horizontal: el.scrollWidth > el.clientWidth + 2, inputs: [...el.querySelectorAll('input,select,textarea')].every((el) => el.labels?.length) }))
    check('All device form controls have explicit labels', overflow.inputs)
    check('Worker content stays within its scroll owner', !overflow.horizontal)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByTestId(`worker-open-${workerId}`).click()
    check('Reduced motion reaches a settled readable detail', await page.locator('.ow-device-detail').evaluate((el) => getComputedStyle(el).transform === 'none' || getComputedStyle(el).transform === 'matrix(1, 0, 0, 1, 0, 0)'))
    await capture('worker-reduced-motion'); await page.emulateMedia({ reducedMotion: 'no-preference' })
    return { workerId, grantId: grant.id, localProjectId: created.project.id }
  } finally {
    setUnavailable(false)
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = globalThis.__workerOriginalDialog })
    writeFileSync(join(evidence, 'native-consent-test.json'), JSON.stringify({ response: 'injected at Main-owned Electron dialog port; actual Runtime/PG persist and authority checks', limitation: 'OS-drawn dialog pixels and physical native-button input are not covered by this harness.' }, null, 2))
  }
}
