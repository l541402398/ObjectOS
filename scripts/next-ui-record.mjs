import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'projectos-next-record-')),
  PROJECTOS_SEED_DEMO: '1',
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'projectos-next-record-user-'))],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60_000,
})
const page = await app.firstWindow()

try {
  await page.waitForSelector('.po-nav-item', { timeout: 30_000 })
  await page.waitForTimeout(1_200)
  const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)

  await app.evaluate(({ session, desktopCapturer }) => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(true))
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      console.log('display media requested')
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
      const source = sources.find((item) => item.name.includes('ProjectOS')) ?? sources[0]
      callback({ video: source })
    })
  })

  const started = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 12 }, audio: false })
    const chunks = []
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
    window.__nextUiRecording = { stream, recorder, chunks }
    recorder.start(500)
    return { label: stream.getVideoTracks()[0]?.label, mimeType: recorder.mimeType }
  })
  console.log('recording started', started)

  async function navigate(hash) {
    await page.evaluate((value) => { location.hash = value }, hash)
    await page.waitForTimeout(1_600)
  }

  await navigate(`#/projects/${projectId}/tasks`)
  await page.locator('.po-task-tile').first().click()
  await page.waitForTimeout(1_500)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  await navigate(`#/projects/${projectId}/orchestration`)
  await page.waitForSelector('.react-flow__node', { timeout: 20_000 })
  await page.waitForTimeout(1_000)
  await page.locator('.react-flow__node').nth(1).click()
  await page.waitForTimeout(1_600)
  await navigate(`#/projects/${projectId}/agents`)
  await page.waitForTimeout(1_600)
  await navigate(`#/projects/${projectId}/orchestration`)
  await page.getByRole('button', { name: '生成计划' }).click()
  await page.waitForSelector('[data-testid="plan-workbench-dialog"] textarea', { timeout: 10_000 })
  await page.locator('[data-testid="plan-workbench-dialog"] textarea').fill('演示计划路线与任务依赖')
  await page.getByRole('radio', { name: /本地规则/ }).click()
  await page.waitForTimeout(500)
  await page.locator('[data-testid="plan-generate"]').click()
  await page.waitForSelector('[data-testid="plan-review-workbench"]', { timeout: 20_000 })
  await page.waitForTimeout(2_200)

  const base64 = await page.evaluate(async () => {
    const state = window.__nextUiRecording
    if (!state) throw new Error('recording not started')
    const stopped = new Promise((resolve) => { state.recorder.onstop = resolve })
    state.recorder.stop()
    await stopped
    state.stream.getTracks().forEach((track) => track.stop())
    const blob = new Blob(state.chunks, { type: state.recorder.mimeType })
    const buffer = await blob.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return { type: blob.type, size: blob.size, data: btoa(binary) }
  })

  const out = join(root, 'docs', 'next-ui', 'screens', 'projectos-next-ui-walkthrough.webm')
  writeFileSync(out, Buffer.from(base64.data, 'base64'))
  console.log('RECORDING', out, base64.type, base64.size)
} finally {
  await app.close().catch(() => undefined)
}

