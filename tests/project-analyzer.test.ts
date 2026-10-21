import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanProject } from '../packages/project-analyzer/src/index.js'

const dirs: string[] = []
function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'projectos-scan-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('project analyzer', () => {
  it('scans nested frontend/backend projects', async () => {
    const root = tempProject()
    mkdirSync(join(root, 'frontend', 'src'), { recursive: true })
    mkdirSync(join(root, 'backend', 'src', 'main', 'java'), { recursive: true })
    writeFileSync(join(root, 'frontend', 'package.json'), JSON.stringify({
      name: 'frontend', dependencies: { react: '^19', vite: '^8', antd: '^6' }, devDependencies: { typescript: '^5' },
    }))
    writeFileSync(join(root, 'frontend', 'tsconfig.json'), '{}')
    writeFileSync(join(root, 'frontend', 'package-lock.json'), '{}')
    writeFileSync(join(root, 'frontend', 'src', 'App.tsx'), 'export const App = () => null')
    writeFileSync(join(root, 'backend', 'pom.xml'), '<project><dependency>spring-boot-starter</dependency></project>')
    writeFileSync(join(root, 'backend', 'src', 'main', 'java', 'App.java'), 'class App {}')

    const snapshot = await scanProject({ projectId: 'prj_test', rootPath: root, gitHead: null })
    expect(snapshot.languages).toEqual(expect.arrayContaining(['TypeScript', 'Java']))
    expect(snapshot.frameworks.map((item) => item.name)).toEqual(expect.arrayContaining(['React', 'Vite', 'Ant Design', 'Java / Maven', 'Spring']))
    expect(snapshot.packageManager).toBe('npm')
    expect(snapshot.warnings).not.toContain('package.json 解析失败')
    expect(snapshot.modules.map((item) => item.path)).toEqual(expect.arrayContaining(['frontend', 'backend']))
  })

  it('does not report a missing manifest as a parse failure', async () => {
    const root = tempProject()
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'main.py'), 'print("ok")')
    const snapshot = await scanProject({ projectId: 'prj_py', rootPath: root, gitHead: null })
    expect(snapshot.languages).toContain('Python')
    expect(snapshot.warnings.some((warning) => warning.includes('解析失败'))).toBe(false)
  })

  it('reports a genuinely malformed package.json with its path', async () => {
    const root = tempProject()
    writeFileSync(join(root, 'package.json'), '{ invalid json')
    const snapshot = await scanProject({ projectId: 'prj_bad', rootPath: root, gitHead: null })
    expect(snapshot.warnings.some((warning) => warning.includes('package.json 解析失败'))).toBe(true)
  })
})
