import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { newId, now, type ProjectSnapshot } from '@projectos/contracts'

const IGNORED = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  'release',
  '.turbo',
  '.next',
  '.cache',
  'coverage',
  'target',
  '.venv',
  '__pycache__',
])

const MAX_FILES = 4000

interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  workspaces?: unknown
  scripts?: Record<string, string>
}

export async function scanProject(input: {
  projectId: string
  rootPath: string
  gitHead: string | null
  signal?: AbortSignal
}): Promise<ProjectSnapshot> {
  const { projectId, rootPath, gitHead, signal } = input
  const warnings: string[] = []
  if (!existsSync(rootPath)) throw new Error(`项目目录不存在：${rootPath}`)
  const frameworks: ProjectSnapshot['frameworks'] = []
  const languages = new Set<string>()
  const modules: ProjectSnapshot['modules'] = []
  const keyDependencies = new Set<string>()
  let packageManager: string | null = null
  let fileCount = 0

  const readJson = (path: string): PackageJson | null => {
    try {
      return JSON.parse(readFileSync(join(rootPath, path), 'utf8')) as PackageJson
    } catch {
      warnings.push(`${path} 解析失败`)
      return null
    }
  }

  const packageJson = readJson('package.json')
  if (packageJson) {
    languages.add('TypeScript/JavaScript')
    if (existsSync(join(rootPath, 'pnpm-lock.yaml'))) packageManager = 'pnpm'
    else if (existsSync(join(rootPath, 'yarn.lock'))) packageManager = 'yarn'
    else if (existsSync(join(rootPath, 'package-lock.json'))) packageManager = 'npm'
    const deps = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) }
    for (const name of Object.keys(deps).slice(0, 40)) keyDependencies.add(name)
    const has = (name: string): boolean => Boolean(deps[name])
    if (has('react')) frameworks.push({ name: 'React', evidence: ['package.json: react'] })
    if (has('vite')) frameworks.push({ name: 'Vite', evidence: ['package.json: vite'] })
    if (has('electron')) frameworks.push({ name: 'Electron', evidence: ['package.json: electron'] })
    if (has('next')) frameworks.push({ name: 'Next.js', evidence: ['package.json: next'] })
    if (has('antd')) frameworks.push({ name: 'Ant Design', evidence: ['package.json: antd'] })
    if (packageJson.workspaces || existsSync(join(rootPath, 'pnpm-workspace.yaml'))) {
      frameworks.push({ name: 'Monorepo', evidence: ['pnpm-workspace.yaml / workspaces'] })
    }
  }
  if (existsSync(join(rootPath, 'tsconfig.json'))) {
    languages.add('TypeScript')
    frameworks.push({ name: 'TypeScript', evidence: ['tsconfig.json'] })
  }
  if (existsSync(join(rootPath, 'pom.xml'))) {
    languages.add('Java')
    packageManager = 'maven'
    frameworks.push({ name: 'Java / Maven', evidence: ['pom.xml'] })
  }
  if (existsSync(join(rootPath, 'build.gradle')) || existsSync(join(rootPath, 'build.gradle.kts'))) {
    languages.add('Java/Kotlin')
    packageManager = 'gradle'
    frameworks.push({ name: 'Gradle', evidence: ['build.gradle'] })
  }
  const springHints = ['src/main/java', 'src/main/resources/application.yml', 'src/main/resources/application.properties']
  if (springHints.some((path) => existsSync(join(rootPath, path)))) {
    frameworks.push({ name: 'Spring', evidence: springHints.filter((path) => existsSync(join(rootPath, path))) })
  }

  const addModules = (base: string, depth: number): void => {
    if (modules.length >= 60 || fileCount >= MAX_FILES) return
    let entries: string[] = []
    try {
      entries = readdirSync(join(rootPath, base))
    } catch {
      return
    }
    for (const entry of entries) {
      if (signal?.aborted || modules.length >= 60) return
      if (IGNORED.has(entry) || entry.startsWith('.')) continue
      const relative = base ? `${base}/${entry}` : entry
      const full = join(rootPath, relative)
      try {
        if (!statSync(full).isDirectory()) continue
      } catch {
        continue
      }
      modules.push({ id: relative.replace(/[^a-z0-9/_-]/gi, '-'), path: relative, kind: 'directory' })
      if (depth > 0) addModules(relative, depth - 1)
    }
  }
  addModules('src', 1)
  addModules('apps', 1)
  addModules('packages', 1)
  addModules('modules', 1)
  if (existsSync(join(rootPath, 'src', 'main', 'java'))) {
    addModules('src/main/java', 2)
  }

  const walk = (base: string): void => {
    if (fileCount >= MAX_FILES || signal?.aborted) return
    let entries: string[]
    try {
      entries = readdirSync(join(rootPath, base))
    } catch {
      return
    }
    for (const entry of entries) {
      if (signal?.aborted || fileCount >= MAX_FILES) return
      if (IGNORED.has(entry) || entry.startsWith('.')) continue
      const relative = base ? `${base}/${entry}` : entry
      const full = join(rootPath, relative)
      let stats
      try {
        stats = statSync(full)
      } catch {
        continue
      }
      if (stats.isDirectory()) {
        if (base.split('/').length < 2) walk(relative)
      } else {
        fileCount += 1
      }
    }
  }
  walk('')
  if (fileCount >= MAX_FILES) warnings.push(`文件数达到扫描上限 ${MAX_FILES}`)

  return {
    id: newId('snp'),
    projectId,
    gitHead,
    scannedAt: now(),
    languages: [...languages],
    frameworks,
    packageManager,
    modules,
    keyDependencies: [...keyDependencies],
    warnings,
    indexVersion: 1,
  }
}
