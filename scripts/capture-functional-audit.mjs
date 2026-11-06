/** Read-only audit extraction after real desktop actions; never executes a business operation. */
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const evidence = resolve('docs/v2/evidence/2026-11-05-functional-audit')
const { profile } = JSON.parse(readFileSync(join(evidence, 'desktop-ui-checks.json'), 'utf8'))
const db = new DatabaseSync(join(profile, 'data', 'projectos.db'), { readOnly: true })
try {
  const task = db.prepare('SELECT id,project_id,requirement_id,title,status,version FROM tasks WHERE title=?').get('实现 add 函数与三个测试')
  if (!task) throw new Error('Real desktop task is missing')
  const runs = db.prepare('SELECT id,agent_id,status,error,input_tokens,output_tokens FROM agent_runs WHERE task_id=? ORDER BY created_at').all(task.id)
  const tools = db.prepare('SELECT t.id,t.run_id,t.tool_name,t.status,t.args_json,t.result_json,t.error FROM tool_calls t JOIN agent_runs r ON r.id=t.run_id WHERE r.task_id=? ORDER BY t.created_at').all(task.id).map(row => {
    const args = JSON.parse(row.args_json), result = row.result_json ? JSON.parse(row.result_json) : null
    return { id: row.id, runId: row.run_id, name: row.tool_name, status: row.status, path: args.path ?? null, command: args.command ?? null, error: row.error,
      result: ['run_tests', 'run_command'].includes(row.tool_name) ? result : result ? { exitCode: result.exitCode, sourceCommit: result.sourceCommit, resultCommit: result.resultCommit } : null }
  })
  const operations = db.prepare('SELECT id,kind,status,run_id,tool_call_id,approval_id,source_commit,result_commit,error FROM task_integration_operations WHERE task_id=? ORDER BY created_at').all(task.id)
  const workspace = db.prepare('SELECT kind,root_path,branch,base_commit FROM requirement_workspaces WHERE requirement_id=?').all(task.requirement_id)
  const root = join(profile, 'project')
  const mainHead = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim()
  const interrupted = db.prepare("SELECT id,status,error FROM task_workspace_preparations WHERE status='needs_reconciliation'").all()
  writeFileSync(join(evidence, 'real-model-audit.json'), JSON.stringify({ task, runs, tools, operations, workspace, interrupted, mainHead,
    mainFilesPresent: ['add.cjs', 'add.test.cjs'].filter(path => existsSync(join(root, path))), method: 'read-only persisted audit after desktop UI; no business API execution' }, null, 2))
  console.log(JSON.stringify({ taskStatus: task.status, runCount: runs.length, commands: tools.filter(t => t.command).map(t => ({ command: t.command, status: t.status, exitCode: t.result?.exitCode })), operations: operations.map(o => ({ kind: o.kind, status: o.status, resultCommit: o.result_commit })), mainHead }))
} finally { db.close() }
