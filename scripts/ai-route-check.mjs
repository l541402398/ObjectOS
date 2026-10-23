#!/usr/bin/env node
/**
 * ProjectOS AI routing preflight.
 *
 * This is a deliberately offline check: it verifies that the project-level
 * routing contract, skills and approved evidence files exist and that the
 * dependency claims in docs/AI_TOOL_ROUTING.md match package.json.
 *
 * It does NOT call OpenViking and does NOT prove that a model remembered the
 * route. The enforced step is AGENTS.md + this check + explicit skill loading.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())
const failures = []
const warnings = []
const checks = []

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function check(condition, message) {
  checks.push({ ok: Boolean(condition), message })
  if (!condition) failures.push(message)
}

function exists(path) {
  return existsSync(join(root, path))
}

const requiredDocs = [
  'docs/AI_TOOL_ROUTING.md',
  'docs/AI_EXPERIENCE_LOG.md',
  'docs/next-ui/VISUAL_BASELINE.md',
  'docs/performance/PERFORMANCE_AUDIT.md',
  'docs/next-ui/PLAN_INSPECTOR_FIX.md',
  'AGENTS.md',
]
for (const path of requiredDocs) check(exists(path), `missing required file: ${path}`)

const agents = read('AGENTS.md')
check(agents.includes('Mandatory AI task routing'), 'AGENTS.md lacks the mandatory routing section')
check(agents.includes('docs/AI_TOOL_ROUTING.md'), 'AGENTS.md does not point to docs/AI_TOOL_ROUTING.md')
check(agents.includes('OpenViking'), 'AGENTS.md does not require OpenViking retrieval')

const routing = read('docs/AI_TOOL_ROUTING.md')
for (const id of ['R-01', 'R-02', 'R-03', 'R-04', 'R-05', 'R-06', 'R-07', 'R-08', 'R-09']) {
  check(routing.includes(id), `routing registry lacks ${id}`)
}

const skills = [
  'projectos-glass-ui',
  'projectos-workflow-design',
  'projectos-ux-audit',
  'projectos-performance',
  'projectos-visual-regression',
]
for (const name of skills) {
  const path = `.agents/skills/${name}/SKILL.md`
  check(exists(path), `missing skill: ${path}`)
  if (exists(path)) {
    const text = read(path)
    check(/^---\r?\nname:\s*\S+/m.test(text), `${path} lacks frontmatter name`)
    check(/^description:\s*\S+/m.test(text), `${path} lacks frontmatter description`)
    check(text.includes('## 触发') || text.includes('## 何时使用'), `${path} lacks trigger section`)
    check(text.includes('## 验收标准'), `${path} lacks acceptance section`)
  }
}

const desktop = JSON.parse(read('apps/desktop/package.json'))
const rootPkg = JSON.parse(read('package.json'))
const deps = { ...rootPkg.devDependencies, ...desktop.dependencies, ...desktop.devDependencies }
const expectedInstalled = {
  '@xyflow/react': '12.',
  elkjs: '0.12.',
  motion: '14.',
  antd: '6.',
  '@radix-ui/react-dialog': '1.',
  'playwright-core': '1.',
}
for (const [name, prefix] of Object.entries(expectedInstalled)) {
  const value = deps[name]
  check(value && String(value).includes(prefix), `expected ${name}@${prefix}x, found ${value ?? 'missing'}`)
}
check(!deps['@dnd-kit/core'], '@dnd-kit/core appeared without a routing update')
check(!deps['shadcn'], 'shadcn package appeared without a routing update')

for (const path of [
  'docs/next-ui/visual-regression/APPROVED-design-lab-dag.png',
  'docs/next-ui/visual-regression/plan-inspector-fixed.png',
]) {
  check(exists(path), `missing visual evidence: ${path}`)
}

// Static regression detectors for defects that were already fixed once.
// Real interaction proof remains the Playwright E2E.
const planReviewNext = read('apps/desktop/src/renderer/src/features/orchestration/components/PlanReviewNext.tsx')
check(
  planReviewNext.includes('PLAN_STATUS_LABEL[draft.status]'),
  'PlanReviewNext must render the real plan status, not a hard-coded pending label',
)
check(
  !planReviewNext.includes('<span className="po-plan-status-pill">待批准</span>'),
  'PlanReviewNext reintroduced the hard-coded 待批准 status pill',
)
const inspector = read('apps/desktop/src/renderer/src/features/design-lab/TaskInspector.tsx')
check(inspector.includes('data-testid="inspector-approve"'), 'TaskInspector lost the inspector approve action')
check(inspector.includes('onWheel={onWheel}'), 'TaskInspector lost the wheel forwarding guard')
const overlayCss = read('apps/desktop/src/renderer/src/styles/next-ui-app.css')
check(
  overlayCss.includes('.ant-message') && overlayCss.includes('pointer-events: none !important'),
  'Ant message click-through guard is missing',
)
const planE2e = read('scripts/plan-review-workspace-e2e.mjs')
check(planE2e.includes('inspector wheel scroll'), 'Plan E2E lost the wheel-scroll gate')
check(planE2e.includes('close button hit target'), 'Plan E2E lost the close hit-target gate')

const report = {
  ok: failures.length === 0,
  checks: checks.length,
  failures,
  warnings,
  skills,
  note: 'Offline preflight only. It does not prove OpenViking retrieval or model behavior.',
}
console.log(JSON.stringify(report, null, 2))
if (failures.length > 0) process.exitCode = 1

