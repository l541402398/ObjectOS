import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { CreateTaskInputSchema } from '@projectos/contracts'
import { MIGRATIONS } from '../packages/persistence/src/migrations.js'
import { RequirementWorkService } from '../apps/runtime/src/requirement-work.js'
import { RequirementIntegrationService } from '../apps/runtime/src/requirement-integration.js'
import { createGitProject, FakeProvider, setup, waitFor } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })
async function fixture(fake?: FakeProvider) {
  const h = setup(fake)
  cleanups.push(() => { h.close(); rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
  const project = await createGitProject(h.services, h.dataDir, 'direct-requirement')
  const work = new RequirementWorkService(h.store, h.dataDir), integration = new RequirementIntegrationService(h.store)
  const requirement = h.services.projects.createRequirement({ projectId: project.id, title: '直接交付笔记恢复', body: '离线正文在重启后恢复', source: 'local', acceptanceCriteria: ['恢复原文'] })
  const task = (title: string, dependsOn: string[] = []) => h.services.tasks.create(CreateTaskInputSchema.parse({ projectId: project.id, requirementId: requirement.id, title, assigneeAgentId: 'agt_engineer', acceptanceCriteria: ['恢复原文'], dependsOn }))
  const prepare = async (taskId: string) => {
    const op = work.request({ taskId, expectedVersion: h.store.read.getTask(taskId)!.version })
    await work.decide(op.approvalId, 'approved', '仅授权准备此任务目录')
    return h.store.read.getTaskWorkspace(taskId)!.rootPath
  }
  return { ...h, project, work, integration, requirement, task, prepare }
}

describe('direct requirement → task → Agent', () => {
  it('integrates a task and prepares its successor without creating a synthetic UC', async () => {
    const f = await fixture(), task = f.task('实现恢复'), successor = f.task('接入编辑器', [task.id])
    const root = await f.prepare(task.id)
    writeFileSync(join(root, 'restore.cjs'), 'module.exports = value => value\n')
    writeFileSync(join(root, 'restore.test.cjs'), "require('node:test')('restore', () => require('node:assert/strict').equal(require('./restore.cjs')('正文'), '正文'))\n")
    f.services.tasks.move({ taskId: task.id, expectedVersion: task.version, to: 'done', note: '已检查任务验收标准，确认恢复结果' })
    const review = f.integration.recordReview({ taskId: task.id, fingerprint: f.integration.preview(task.id).fingerprint, note: '已检查恢复逻辑和测试覆盖，审查通过' })
    expect(review.review.approved).toBe(true)
    const verify = f.integration.request({ taskId: task.id, fingerprint: review.fingerprint, kind: 'verify', command: 'node --test restore.test.cjs' })
    await f.integration.decide(verify.approvalId, 'approved', '运行实际测试')
    await waitFor(() => f.store.read.getRun(verify.runId)?.status === 'completed')
    const op = f.integration.request({ taskId: task.id, fingerprint: f.integration.preview(task.id).fingerprint, kind: 'integrate' })
    await f.integration.decide(op.approvalId, 'approved', '合入需求分支')
    const nextRoot = await f.prepare(successor.id)
    expect(readFileSync(join(nextRoot, 'restore.cjs'), 'utf8')).toContain('value => value')
    expect(f.store.db.prepare("SELECT name FROM sqlite_master WHERE name='requirement_use_cases'").get()).toBeUndefined()
    expect(existsSync(join(f.project.rootPath, 'restore.cjs'))).toBe(false)
  }, 30_000)

  it('runs an assigned Agent with frozen requirement context and independent tool approval', async () => {
    const fake = new FakeProvider(call => call.hasToolResult ? { text: '任务输出已保存' } : { tool: { name: 'write_file', args: { path: 'output.txt', content: '恢复原文' } } })
    const f = await fixture(fake), task = f.task('实现离线恢复'), root = await f.prepare(task.id)
    const session = f.services.sessions.create({ projectId: f.project.id, agentId: 'agt_engineer', title: task.title })
    const { runId } = await f.runner.startRun({ projectId: f.project.id, taskId: task.id, sessionId: session.id, prompt: '执行这个开发任务' })
    await waitFor(() => f.store.read.getRun(runId)?.status === 'waiting_approval')
    const approval = f.store.read.listApprovalViews(f.project.id, runId).find(a => a.status === 'pending')!
    expect(existsSync(join(root, 'output.txt'))).toBe(false)
    expect(fake.calls[0]?.messages[0]?.content).toContain('离线正文在重启后恢复')
    f.work.update({ requirementId: f.requirement.id, expectedVersion: 0, title: '后续版本', body: '不应注入当前执行', technicalDesign: '', acceptanceCriteria: [] })
    await f.runner.decideApproval(approval.id, 'approved', '只批准这次任务文件写入')
    await waitFor(() => f.store.read.getRun(runId)?.status === 'completed')
    expect(readFileSync(join(root, 'output.txt'), 'utf8')).toBe('恢复原文')
    expect(fake.calls.at(-1)?.messages[0]?.content).not.toContain('不应注入当前执行')
    expect(f.store.db.prepare("SELECT name FROM sqlite_master WHERE name='requirement_use_cases'").get()).toBeUndefined()
  }, 30_000)

  it('preserves V39 trusted reviews and admits an absent UC in V40', () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec("PRAGMA foreign_keys=ON; CREATE TABLE artifacts(id TEXT PRIMARY KEY); CREATE TABLE tasks(id TEXT PRIMARY KEY,project_id TEXT,requirement_id TEXT,use_case_id TEXT); CREATE TABLE requirements(id TEXT PRIMARY KEY,project_id TEXT); CREATE TABLE requirement_use_cases(id TEXT PRIMARY KEY,requirement_id TEXT,project_id TEXT); CREATE TRIGGER task_requirement_scope_insert BEFORE INSERT ON tasks BEGIN SELECT 1; END; INSERT INTO artifacts VALUES('old'),('new'); INSERT INTO tasks(id) VALUES('task'); CREATE TABLE task_integration_reviews(artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id),task_id TEXT NOT NULL REFERENCES tasks(id),content_fingerprint TEXT NOT NULL,requirement_version INTEGER NOT NULL,use_case_version INTEGER NOT NULL,task_version INTEGER NOT NULL); INSERT INTO task_integration_reviews VALUES('old','task','hash',3,4,5);")
      db.exec(MIGRATIONS.find(migration => migration.version === 40)!.sql)
      expect(db.prepare('SELECT * FROM task_integration_reviews WHERE artifact_id=?').get('old')).toMatchObject({ content_fingerprint: 'hash', requirement_version: 3, use_case_version: 4, task_version: 5 })
      db.prepare('INSERT INTO task_integration_reviews VALUES(?,?,?,?,?,?)').run('new', 'task', 'new-hash', 3, null, 5)
      expect(db.prepare('SELECT use_case_version FROM task_integration_reviews WHERE artifact_id=?').get('new')?.use_case_version).toBeNull()
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { db.close() }
  })
})
