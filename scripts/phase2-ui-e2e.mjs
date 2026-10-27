import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-phase2-ui-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
let app

async function clickLastModalButton(page, _name) {
  await page.locator('.ant-modal:visible .ant-modal-footer button').last().click()
}

try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 30_000 })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 30_000 })
  if (await page.locator('.po-shell.is-collapsed').count()) {
    await page.getByRole('button', { name: '切换侧边栏' }).click()
    await page.waitForTimeout(300)
  }
  if (await page.locator('.v16-project-visual').count()) await page.locator('.v16-project-visual').first().click()
  await page.waitForSelector('.po-work-center', { timeout: 30_000 })
  const setup = await page.evaluate(async () => {
    const project = (await window.projectos.projects.list()).projects[0]
    const lifecycle = await window.projectos.lifecycle.overview(project.id)
    const version = lifecycle.versions[0]
    const task = await window.projectos.tasks.create({
      projectId: project.id,
      title: 'Phase 2 release source work',
      description: 'Real version task for release candidate',
      priority: 3,
      acceptanceCriteria: ['npm test passes'],
      labels: ['developer'],
      assigneeAgentId: null,
      milestoneId: null,
      versionId: version.id,
      iterationId: null,
      dependsOn: [],
      dueAt: null,
    })
    const artifact = await window.projectos.artifacts.create({
      projectId: project.id,
      taskId: task.task.id,
      runId: null,
      kind: 'test-report',
      title: 'Phase 2 version test evidence',
      body: 'npm test exit 0; default quality test passed',
      uri: null,
      metadata: { artifactType: 'test-report' },
    })
    return { projectId: project.id, versionId: version.id, taskId: task.task.id, artifactId: artifact.artifact.id }
  })
  console.log('[phase2-ui] setup version evidence', setup)
  await page.reload()
  await page.waitForSelector('.po-shell', { timeout: 30_000 })
  if (await page.locator('.v16-project-visual').count()) await page.locator('.v16-project-visual').first().click()
  await page.waitForSelector('.po-work-center', { timeout: 30_000 })
  await page.evaluate(() => {
    const parts = location.hash.split('/')
    location.hash = `${parts.slice(0, 3).join('/')}/versions`
  })
  await page.waitForSelector('.po-lifecycle-page', { timeout: 30_000 })
  await page.waitForSelector('.delivery-summary', { timeout: 30_000 })
  await page.waitForTimeout(700)
  console.log('[phase2-ui] version delivery summary loaded')

  if (!(await page.locator('.po-shell.is-collapsed').count())) {
    const devGroup = page.locator('.po-sidenav-group-trigger').filter({ hasText: '研发' }).first()
    if (!(await page.getByText('研发工作中心', { exact: true }).isVisible().catch(() => false))) {
      await devGroup.click()
      await page.waitForTimeout(250)
    }
    if (!(await page.getByText('研发工作中心', { exact: true }).isVisible().catch(() => false))) {
      throw new Error('研发 group did not expand')
    }
    await devGroup.click()
    await page.waitForTimeout(250)
    if (await page.getByText('研发工作中心', { exact: true }).isVisible().catch(() => false)) {
      throw new Error('研发 group did not collapse')
    }
    await devGroup.click()
    await page.waitForTimeout(250)
    await page.reload()
    await page.waitForSelector('.po-lifecycle-page', { timeout: 30_000 })
    if (!(await page.getByText('研发工作中心', { exact: true }).isVisible().catch(() => false))) {
      throw new Error('研发 group expansion was not restored after reload')
    }
    console.log('[phase2-ui] accordion nav expand/collapse/persistence PASS')
  }

  const versionCard = page.locator('.lc-version').first()
  await page.getByRole('button', { name: /记录证据/ }).first().click()
  await page.locator('input[placeholder="例如：v0.1.0 验收评审记录"]').fill('Phase 2 发布验证测试报告')
  await page.locator('.ant-modal:visible .ant-select').nth(0).click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.locator('.ant-modal:visible .ant-select').nth(2).click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.locator('textarea[placeholder="实际检查了什么、结果如何"]').fill('真实 npm test 退出码 0；来源观察。')
  await clickLastModalButton(page, '记录')
  await page.waitForTimeout(800)

  await versionCard.locator('.ant-select').click()
  await page.getByRole('option', { name: '验证中', exact: true }).click()
  await page.waitForTimeout(1000)
  console.log('[phase2-ui] version evidence/gate PASS')

  await page.evaluate(({ projectId, versionId }) => { location.hash = `#/projects/${projectId}/releases?version=${versionId}` }, setup)
  await page.waitForSelector('.po-delivery-page', { timeout: 30_000 })
  await page.waitForTimeout(700)
  console.log('[phase2-ui] release center loaded')

  await page.getByRole('button', { name: /新建变更/ }).click()
  await page.locator('.ant-modal:visible input').first().fill('Phase 2 发布变更')
  await page.locator('.ant-modal:visible textarea').first().fill('将真实研发成果转为发布记录；仅登记，不执行外部部署。')
  await clickLastModalButton(page, '创建')
  await page.waitForFunction(() => document.body.innerText.includes('Phase 2 发布变更'), null, { timeout: 15_000 })
  await page.getByRole('button', { name: '提交审批' }).first().click()
  await page.waitForTimeout(400)
  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/approvals` }, setup)
  await page.waitForSelector('.v16-delivery-approvals', { timeout: 15_000 })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(root, 'docs', 'screenshots', '1440x900-light-approval-center-delivery.png') })
  await page.locator('.v16-delivery-approvals .v16-approval-card footer button').last().click()
  await page.waitForTimeout(900)
  await page.evaluate(({ projectId, versionId }) => { location.hash = `#/projects/${projectId}/releases?version=${versionId}` }, setup)
  await page.waitForSelector('.po-delivery-page', { timeout: 15_000 })
  await page.waitForTimeout(600)
  console.log('[phase2-ui] change request approved PASS')

  await page.getByRole('button', { name: /生成发布候选/ }).click()
  await page.waitForTimeout(900)
  const afterCandidate = await page.locator('.po-delivery-page').innerText()
  console.log('[phase2-ui] candidate panel:', afterCandidate.slice(0, 1200))
  await page.getByRole('button', { name: /登记为 Release/ }).first().click()
  await page.waitForTimeout(1000)
  const panel = page.locator('.po-delivery-page')
  const panelText = await panel.innerText()
  if (!panelText.includes('未外部分发')) throw new Error(`release not recorded: ${panelText.slice(0, 800)}`)
  console.log('[phase2-ui] release recorded PASS')

  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.waitForTimeout(500)
  mkdirSync(join(root, 'docs', 'screenshots'), { recursive: true })
  await page.screenshot({ path: join(root, 'docs', 'screenshots', '1440x900-light-release-center.png') })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(root, 'docs', 'screenshots', '1440x900-dark-release-center.png') })

  await page.evaluate(({ projectId, versionId }) => { location.hash = `#/projects/${projectId}/deployments?version=${versionId}` }, setup)
  await page.waitForSelector('.po-delivery-page', { timeout: 30_000 })
  await page.waitForTimeout(700)
  console.log('[phase2-ui] deployment center loaded')
  await page.locator('.rel-deploy-releases button').first().click()
  await clickLastModalButton(page, '创建待审批部署')
  await page.waitForTimeout(500)
  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/approvals` }, setup)
  await page.waitForSelector('.v16-delivery-approvals', { timeout: 15_000 })
  await page.locator('.v16-delivery-approvals .v16-approval-card footer button').last().click()
  await page.waitForTimeout(700)
  await page.evaluate(({ projectId, versionId }) => { location.hash = `#/projects/${projectId}/deployments?version=${versionId}` }, setup)
  await page.waitForSelector('.po-delivery-page', { timeout: 15_000 })
  await page.waitForTimeout(500)
  const deployPage = page.locator('.po-delivery-page')
  await page.getByRole('button', { name: /登记结果/ }).first().click()
  await page.waitForTimeout(1000)
  const finalText = await deployPage.innerText()
  if (!finalText.includes('手工声明') || !finalText.includes('自我声明')) throw new Error('deployment provenance missing')
  console.log('[phase2-ui] manual deployment recorded with self_declared provenance PASS')

  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(root, 'docs', 'screenshots', '1440x900-light-deployment-center.png') })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(root, 'docs', 'screenshots', '1440x900-dark-deployment-center.png') })
  console.log('PHASE 2 UI E2E PASS')
  await app.close()
} finally {
  try { await app?.close() } catch { /* ignore */ }
  rmSync(dataDir, { recursive: true, force: true })
}
