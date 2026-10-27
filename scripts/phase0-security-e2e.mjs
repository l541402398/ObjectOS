import { _electron as electron } from 'playwright-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-phase0-security-'))
const electronPath = resolve(root, 'node_modules/electron/dist/electron.exe')
const desktopDir = resolve(root, 'apps/desktop')
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir }
delete env.ELECTRON_RUN_AS_NODE

let app
try {
  app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: desktopDir, env, timeout: 30_000 })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-empty-title, .v16-project-visual', { timeout: 30_000 })

  const result = await page.evaluate(async () => {
    const api = window.projectos
    const out = {
      executeExposed: typeof api.runtimeProfiles.execute,
      acpPromptExposed: typeof api.runtimeProfiles.acpPrompt,
      handshakeExposed: typeof api.runtimeProfiles.acpHandshake,
      agentStudioRunError: null,
      repairError: null,
      externalExecuteError: null,
    }
    try {
      await api.agentDefinitions.run({ agentId: 'agt_missing', projectId: 'prj_missing', prompt: 'phase0' })
    } catch (error) {
      out.agentStudioRunError = String(error?.message ?? error)
    }
    try {
      await api.operations.startRepair('prp_missing')
    } catch (error) {
      out.repairError = String(error?.message ?? error)
    }
    try {
      await api.externalAgents.execute({
        projectId: 'prj_missing',
        adapterId: 'claude-code',
        prompt: 'phase0',
        allowWrite: true,
      })
    } catch (error) {
      out.externalExecuteError = String(error?.message ?? error)
    }
    return out
  })

  const pass =
    result.executeExposed === 'undefined' &&
    result.acpPromptExposed === 'undefined' &&
    result.handshakeExposed === 'function' &&
    /POLICY_DENIED|Phase 0|禁用/.test(result.agentStudioRunError ?? '') &&
    /POLICY_DENIED|Phase 0|禁用/.test(result.repairError ?? '') &&
    /POLICY_DENIED|Phase 0|禁用/.test(result.externalExecuteError ?? '')
  console.log(JSON.stringify({ pass, result }, null, 2))
  if (!pass) process.exitCode = 1
} finally {
  try { await app?.close() } catch { /* ignore */ }
  rmSync(dataDir, { recursive: true, force: true })
}
