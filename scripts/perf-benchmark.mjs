/**
 * ProjectOS packaged Electron performance benchmark.
 *
 * Measures the built desktop app (not Vite dev):
 * - cold start to first interactive project center
 * - page transitions, sidebar, board, DAG, plan review, settings, runs, resize, idle
 * - rAF frame cadence / long tasks / React commits / IPC calls / process metrics
 *
 * Usage:
 *   node scripts/perf-benchmark.mjs <packageRoot> [outJson]
 *   packageRoot = ...\release\win-phase5-pages\win-unpacked
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'

const packageRoot = resolve(process.argv[2] ?? 'C:/Users/Administrator/Desktop/workplace/ProjectOS-next-ui-full-migration/release/win-phase5-pages/win-unpacked')
const outPath = resolve(process.argv[3] ?? 'docs/performance/baseline.json')
const exe = join(packageRoot, 'ProjectOS.exe')
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-perf-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-perf-user-'))

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_SEED_DEMO: '1',
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
  PROJECTOS_PERF_PROBE: '1',
}
delete env.ELECTRON_RUN_AS_NODE

const startedAt = Date.now()
const app = await _electron.launch({
  executablePath: exe,
  args: [`--user-data-dir=${userDataDir}`],
  cwd: packageRoot,
  env,
  timeout: 60000,
})
const page = await app.firstWindow()
await page.bringToFront()

// Count main-process IPC channel invocations without changing app code. The
// renderer-side preload object is frozen, so this is the only accurate count.
await app.evaluate(({ ipcMain }) => {
  if (globalThis.__perfIpcPatched) return
  globalThis.__perfIpcPatched = true
  globalThis.__perfIpc = {}
  const originalEmit = ipcMain.emit.bind(ipcMain)
  ipcMain.emit = function (channel, ...args) {
    if (typeof channel === 'string' && channel !== 'newListener' && channel !== 'removeListener') {
      globalThis.__perfIpc[channel] = (globalThis.__perfIpc[channel] ?? 0) + 1
    }
    return originalEmit(channel, ...args)
  }
})
await page.waitForSelector('.v16-project-visual', { timeout: 60000 })
const coldStartMs = Date.now() - startedAt
await page.waitForTimeout(800)

// Install instrumentation before a reload so React sees the DevTools hook from
// its first commit and every scenario uses the same measurement contract.
await page.addInitScript(() => {
  const hook = {
    supportsFiber: true,
    renderers: new Map(),
    inject(renderer) {
      this.renderers.set(1, renderer)
      return 1
    },
    onCommitFiberRoot() {
      window.__perfCommits = (window.__perfCommits ?? 0) + 1
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  }
  Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook, configurable: true })

  window.__perfMonitor = {
    frames: 0,
    longTasks: [],
    startedAt: 0,
    running: false,
    observer: null,
    start() {
      this.frames = 0
      this.longTasks = []
      this.startedAt = performance.now()
      this.running = true
      window.__perfCommits = 0
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) this.longTasks.push({ start: entry.startTime, duration: entry.duration })
      })
      try { this.observer.observe({ type: 'longtask', buffered: false }) } catch { /* unsupported */ }
      const tick = () => {
        if (!this.running) return
        this.frames += 1
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    stop() {
      this.running = false
      this.observer?.disconnect()
      const elapsed = performance.now() - this.startedAt
      const fps = elapsed > 0 ? (this.frames * 1000) / elapsed : 0
      return {
        elapsedMs: Math.round(elapsed * 10) / 10,
        frames: this.frames,
        fps: Math.round(fps * 10) / 10,
        longTasks: this.longTasks.map((task) => Math.round(task.duration * 10) / 10),
        longTaskTotalMs: Math.round(this.longTasks.reduce((total, task) => total + task.duration, 0) * 10) / 10,
        reactCommits: window.__perfCommits ?? 0,
        heapUsedMb: performance.memory ? Math.round((performance.memory.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null,
      }
    },
  }

  // Coarse IPC instrumentation: count calls and total elapsed time for the
  // public preload API. It is installed after the initial data load.
  window.__ipcStats = { calls: 0, totalMs: 0, byMethod: {} }
  const wrap = (target, prefix) => {
    if (!target || typeof target !== 'object') return target
    for (const key of Object.keys(target)) {
      let value
      try { value = target[key] } catch { continue }
      if (typeof value === 'function') {
        target[key] = function (...args) {
          const started = performance.now()
          const method = `${prefix}${key}`
          try {
            return Promise.resolve(value.apply(this, args)).finally(() => {
              const duration = performance.now() - started
              window.__ipcStats.calls += 1
              window.__ipcStats.totalMs += duration
              const bucket = window.__ipcStats.byMethod[method] ?? { calls: 0, totalMs: 0 }
              bucket.calls += 1
              bucket.totalMs += duration
              window.__ipcStats.byMethod[method] = bucket
            })
          } catch (error) {
            throw error
          }
        }
      } else if (value && typeof value === 'object' && key !== 'prototype') {
        try { wrap(value, `${prefix}${key}.`) } catch { /* frozen */ }
      }
    }
    return target
  }
  try { wrap(window.projectos, '') } catch { /* preload API unavailable */ }
})

await page.reload()
await page.waitForSelector('.v16-project-visual', { timeout: 60000 })
await page.bringToFront()
await page.waitForTimeout(600)

// The contextBridge API only exists after preload; wrap it post-load.
await page.evaluate(() => {
  window.__ipcStats = { calls: 0, totalMs: 0, byMethod: {} }
  const wrap = (target, prefix) => {
    if (!target || typeof target !== 'object') return target
    for (const key of Object.keys(target)) {
      let value
      try { value = target[key] } catch { continue }
      if (typeof value === 'function') {
        const original = value
        target[key] = function (...args) {
          const started = performance.now()
          const method = `${prefix}${key}`
          const result = original.apply(this, args)
          if (result && typeof result.then === 'function') {
            return result.finally(() => {
              const duration = performance.now() - started
              window.__ipcStats.calls += 1
              window.__ipcStats.totalMs += duration
              const bucket = window.__ipcStats.byMethod[method] ?? { calls: 0, totalMs: 0 }
              bucket.calls += 1
              bucket.totalMs += duration
              window.__ipcStats.byMethod[method] = bucket
            })
          }
          return result
        }
      } else if (value && typeof value === 'object' && key !== 'prototype') {
        try { wrap(value, `${prefix}${key}.`) } catch { /* frozen */ }
      }
    }
    return target
  }
  try { wrap(window.projectos, '') } catch { /* noop */ }
})

const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)

async function processSnapshot() {
  return app.evaluate(async ({ app }) => {
    const metrics = app.getAppMetrics()
    const total = metrics.reduce((sum, entry) => ({
      cpu: sum.cpu + (entry.cpu?.percentCPUUsage ?? 0),
      workingSetMb: sum.workingSetMb + (entry.memory?.workingSetSize ?? 0) / 1024,
      peakWorkingSetMb: sum.peakWorkingSetMb + (entry.memory?.peakWorkingSetSize ?? 0) / 1024,
    }), { cpu: 0, workingSetMb: 0, peakWorkingSetMb: 0 })
    return {
      processCount: metrics.length,
      totalCpuPercent: Math.round(total.cpu * 10) / 10,
      totalWorkingSetMb: Math.round(total.workingSetMb * 10) / 10,
      totalPeakWorkingSetMb: Math.round(total.peakWorkingSetMb * 10) / 10,
      processes: metrics.map((entry) => ({ type: entry.type, cpu: entry.cpu?.percentCPUUsage ?? 0, workingSetMb: Math.round(((entry.memory?.workingSetSize ?? 0) / 1024) * 10) / 10 })),
    }
  })
}

async function resetMainIpc() {
  await app.evaluate(() => {
    if (globalThis.__ipcPerf) {
      const stats = globalThis.__ipcPerf
      stats.calls = 0
      stats.totalMs = 0
      stats.maxMs = 0
      stats.byChannel = {}
    }
  })
}

async function mainIpcSnapshot() {
  return app.evaluate(() => {
    const stats = globalThis.__ipcPerf ?? { calls: 0, totalMs: 0, maxMs: 0, byChannel: {} }
    return {
      calls: stats.calls,
      totalMs: Math.round(stats.totalMs * 10) / 10,
      maxMs: Math.round(stats.maxMs * 10) / 10,
      channels: Object.entries(stats.byChannel).sort((a, b) => b[1].totalMs - a[1].totalMs).slice(0, 12),
    }
  })
}
async function cdpMetrics() {
  const session = await page.context().newCDPSession(page)
  const { metrics } = await session.send('Performance.getMetrics')
  await session.detach().catch(() => undefined)
  return Object.fromEntries(metrics.map((entry) => [entry.name, entry.value]))
}

async function ipcSnapshot() {
  return page.evaluate(() => {
    const stats = window.__ipcStats ?? { calls: 0, totalMs: 0, byMethod: {} }
    return {
      calls: stats.calls,
      totalMs: Math.round(stats.totalMs * 10) / 10,
      byMethod: Object.fromEntries(Object.entries(stats.byMethod).map(([key, value]) => [key, { calls: value.calls, totalMs: Math.round(value.totalMs * 10) / 10 }])),
    }
  })
}

async function resetIpc() {
  await page.evaluate(() => { window.__ipcStats = { calls: 0, totalMs: 0, byMethod: {} } })
}

async function measure(name, action, durationMs = 2500) {
  await page.bringToFront()
  await resetIpc()
  await resetMainIpc()
  const before = { ...(await cdpMetrics()), process: await processSnapshot() }
  await page.evaluate(() => window.__perfMonitor.start())
  await action()
  await page.waitForTimeout(durationMs)
  const monitor = await page.evaluate(() => window.__perfMonitor.stop())
  const after = { ...(await cdpMetrics()), process: await processSnapshot() }
  const ipc = await ipcSnapshot()
  const mainIpc = await mainIpcSnapshot()
  return {
    name,
    durationMs: monitor.elapsedMs,
    fps: monitor.fps,
    frames: monitor.frames,
    longTasks: monitor.longTasks,
    longTaskTotalMs: monitor.longTaskTotalMs,
    reactCommits: monitor.reactCommits,
    heapUsedMb: monitor.heapUsedMb,
    ipcCalls: mainIpc.calls,
    ipcChannels: mainIpc.channels,
    ipcMaxMs: mainIpc.maxMs,
    ipcTotalMsMain: mainIpc.totalMs,
    ipcTotalMs: ipc.totalMs,
    ipcTop: Object.entries(ipc.byMethod).sort((a, b) => b[1].totalMs - a[1].totalMs).slice(0, 8),
    renderer: {
      layoutCount: Math.max(0, (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0)),
      recalcStyleCount: Math.max(0, (after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0)),
      scriptDurationMs: Math.round(((after.ScriptDuration ?? 0) - (before.ScriptDuration ?? 0)) * 1000 * 10) / 10,
      taskDurationMs: Math.round(((after.TaskDuration ?? 0) - (before.TaskDuration ?? 0)) * 1000 * 10) / 10,
      jsHeapUsedMb: Math.round((after.JSHeapUsedSize ?? 0) / 1024 / 1024 * 10) / 10,
      nodes: after.Nodes ?? null,
    },
    main: {
      cpuPercent: Math.round(after.process.totalCpuPercent * 10) / 10,
      workingSetMb: after.process.totalWorkingSetMb,
      peakWorkingSetMb: after.process.totalPeakWorkingSetMb,
      processCount: after.process.processCount,
    },
  }
}

async function nav(hash) {
  await page.evaluate((value) => { location.hash = value }, hash)
  await page.waitForTimeout(500)
}

const scenarios = []
scenarios.push(await measure('project-center idle', async () => { await nav('#/'); await page.waitForSelector('.po-ux-center') }, 3000))
scenarios.push(await measure('project-center -> overview', async () => {
  await nav(`#/projects/${projectId}`)
  await page.waitForSelector('.po-ux-overview')
}, 2500))
scenarios.push(await measure('task board scroll + detail', async () => {
  await nav(`#/projects/${projectId}/tasks`)
  await page.waitForSelector('.po-ux-board')
  await page.locator('.po-board-scroll').evaluate((el) => { el.scrollLeft = el.scrollWidth })
  await page.waitForTimeout(300)
  await page.locator('.po-board-scroll').evaluate((el) => { el.scrollLeft = 0 })
  await page.locator('.po-task-tile').first().click()
  await page.waitForTimeout(350)
}, 2500))
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
scenarios.push(await measure('sidebar collapse/expand', async () => {
  const toggle = page.getByRole('button', { name: '切换侧边栏' })
  await toggle.click()
  await page.waitForTimeout(220)
  await toggle.click()
}, 1800))
await nav(`#/projects/${projectId}/orchestration`)
await page.waitForSelector('.po-orch-canvas')
scenarios.push(await measure('DAG zoom + node select', async () => {
  const canvas = page.locator('.po-orch-canvas')
  const box = await canvas.boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -180)
    await page.waitForTimeout(300)
    await page.mouse.wheel(0, 160)
  }
  const node = page.locator('.react-flow__node').first()
  if (await node.count()) await node.click()
}, 2500))
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

scenarios.push(await measure('plan review open + interaction', async () => {
  await nav(`#/projects/${projectId}/orchestration`)
  await page.waitForSelector('.po-orch-canvas')
  await page.getByRole('button', { name: '生成计划' }).click()
  await page.waitForSelector('[data-testid="plan-workbench-dialog"] textarea', { timeout: 10000 })
  await page.locator('[data-testid="plan-workbench-dialog"] textarea').fill('游戏内7层地图都更换风格，每层一个不一样的风格')
  await page.getByRole('radio', { name: /本地规则/ }).click()
  await page.waitForTimeout(500)
  await page.locator('[data-testid="plan-generate"]').click()
  await page.waitForSelector('[data-testid="plan-review-workspace"]', { timeout: 25000 })
  await page.getByRole('tab', { name: '任务依赖' }).click()
  await page.waitForTimeout(500)
}, 3000))
await page.getByRole('button', { name: '返回编排' }).first().click().catch(() => undefined)
await page.waitForTimeout(500)

scenarios.push(await measure('settings page switch', async () => {
  await nav(`#/projects/${projectId}/project-settings?section=general`)
  await page.waitForSelector('.po-ux-project-settings')
  await page.getByText('设置', { exact: true }).first().click()
  await page.waitForSelector('[data-testid="settings-dialog"]')
  await page.locator('.po-settings-nav-item').nth(2).click()
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
}, 2500))
await page.waitForTimeout(250)
scenarios.push(await measure('run audit idle/update', async () => {
  await nav(`#/projects/${projectId}/runs`)
  await page.waitForSelector('.po-ux-runs')
  await page.waitForTimeout(1600)
}, 3000))
scenarios.push(await measure('window resize 1440 -> 1100 -> 1440', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 820))
  await page.waitForTimeout(450)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await page.waitForTimeout(450)
}, 2200))
scenarios.push(await measure('idle 5s', async () => { await page.waitForTimeout(500) }, 5000))

// Controlled experiment: same DAG interaction with every backdrop-filter
// disabled. This isolates the cost of optical blur from React/ELK work.
await nav(`#/projects/${projectId}/orchestration`)
await page.waitForSelector('.po-orch-canvas')
const noBlurStyle = await page.addStyleTag({ content: '*, *::before, *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' })
const cssExperiment = await measure('DAG zoom + select (backdrop-filter off)', async () => {
  const box = await page.locator('.po-orch-canvas').boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -180)
    await page.waitForTimeout(300)
    await page.mouse.wheel(0, 160)
  }
  const node = page.locator('.react-flow__node').first()
  if (await node.count()) await node.click()
}, 2500)
await noBlurStyle.evaluate((element) => element.remove())

const finalProcess = await processSnapshot()
const gpu = await app.evaluate(async ({ app }) => ({
  featureStatus: app.getGPUFeatureStatus(),
  gpuInfo: await app.getGPUInfo('basic'),
}))
const result = {
  generatedAt: new Date().toISOString(),
  packageRoot,
  electron: await app.evaluate(({ app }) => app.getVersion()),
  coldStartMs,
  firstInteractiveMs: coldStartMs,
  projectId,
  screen: await page.evaluate(() => ({ width: window.screen.width, height: window.screen.height, dpr: window.devicePixelRatio })),
  gpu,
  finalProcess,
  scenarios,
  cssExperiment,
}
writeFileSync(outPath, JSON.stringify(result, null, 2))
console.log(JSON.stringify({ coldStartMs, scenarios: scenarios.map((s) => ({ name: s.name, fps: s.fps, longTasks: s.longTasks.length, longTaskTotalMs: s.longTaskTotalMs, commits: s.reactCommits, ipcCalls: s.ipcCalls, cpu: s.main.cpuPercent })), finalProcess, gpu: gpu.featureStatus }, null, 2))
await app.close()












