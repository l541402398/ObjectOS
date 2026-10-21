import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { newId, now, type ProjectSnapshot } from '@projectos/contracts'

const IGNORED = new Set([
  '.git', 'node_modules', 'dist', 'out', 'build', 'release', '.turbo', '.next', '.cache',
  'coverage', 'target', '.venv', '__pycache__', '.gradle', '.idea', '.vscode', 'vendor',
])

const MAX_FILES = 4000
const MAX_DEPTH = 4

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.vue': 'Vue', '.svelte': 'Svelte',
  '.java': 'Java', '.kt': 'Kotlin', '.scala': 'Scala',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.cs': 'C#', '.php': 'PHP', '.rb': 'Ruby',
  '.swift': 'Swift', '.c': 'C', '.h': 'C', '.cpp': 'C++', '.cc': 'C++', '.hpp': 'C++',
}

interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  workspaces?: unknown
  scripts?: Record<string, string>
}

interface Manifest {
  path: string
  kind: 'package.json' | 'maven' | 'gradle' | 'python' | 'go' | 'cargo' | 'composer' | 'ruby' | 'dotnet'
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}

function manifestKind(name: string): Manifest['kind'] | null {
  if (name === 'package.json') return 'package.json'
  if (name === 'pom.xml') return 'maven'
  if (name === 'build.gradle' || name === 'build.gradle.kts') return 'gradle'
  if (name === 'pyproject.toml' || name === 'requirements.txt') return 'python'
  if (name === 'go.mod') return 'go'
  if (name === 'Cargo.toml') return 'cargo'
  if (name === 'composer.json') return 'composer'
  if (name === 'Gemfile') return 'ruby'
  if (name.endsWith('.csproj')) return 'dotnet'
  return null
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

  const languages = new Map<string, number>()
  const frameworks = new Map<string, string[]>()
  const modules: ProjectSnapshot['modules'] = []
  const keyDependencies = new Set<string>()
  const manifests: Manifest[] = []
  const lockfiles: string[] = []
  const packageFiles: Array<{ path: string; json: PackageJson }> = []
  let packageManager: string | null = null
  let fileCount = 0

  const addFramework = (name: string, evidence: string): void => {
    const current = frameworks.get(name) ?? []
    if (!current.includes(evidence) && current.length < 8) current.push(evidence)
    frameworks.set(name, current)
  }

  const addModule = (path: string): void => {
    if (!path || modules.length >= 60) return
    if (modules.some((module) => module.path === path)) return
    modules.push({ id: path.replace(/[^a-z0-9/_-]/gi, '-'), path, kind: 'directory' })
  }

  const readPackageJson = (relative: string): void => {
    const absolute = join(rootPath, relative)
    if (!existsSync(absolute)) return
    try {
      const parsed = JSON.parse(stripBom(readFileSync(absolute, 'utf8'))) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('不是 JSON 对象')
      const json = parsed as PackageJson
      packageFiles.push({ path: relative, json })
      const dependencies = {
        ...(json.dependencies ?? {}),
        ...(json.devDependencies ?? {}),
        ...(json.peerDependencies ?? {}),
      }
      for (const name of Object.keys(dependencies).slice(0, 80)) keyDependencies.add(name)
      const has = (name: string): boolean => Boolean(dependencies[name])
      if (has('react') || has('react-dom')) addFramework('React', `${relative}: react`)
      if (has('vue')) addFramework('Vue', `${relative}: vue`)
      if (has('@angular/core')) addFramework('Angular', `${relative}: @angular/core`)
      if (has('svelte')) addFramework('Svelte', `${relative}: svelte`)
      if (has('next')) addFramework('Next.js', `${relative}: next`)
      if (has('nuxt')) addFramework('Nuxt', `${relative}: nuxt`)
      if (has('vite')) addFramework('Vite', `${relative}: vite`)
      if (has('electron')) addFramework('Electron', `${relative}: electron`)
      if (has('antd')) addFramework('Ant Design', `${relative}: antd`)
      if (has('express')) addFramework('Express', `${relative}: express`)
      if (has('@nestjs/core')) addFramework('NestJS', `${relative}: @nestjs/core`)
      if (json.workspaces || existsSync(join(rootPath, 'pnpm-workspace.yaml'))) addFramework('Monorepo', 'workspaces')
    } catch (error) {
      warnings.push(`${relative} 解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const visit = (base: string, depth: number): void => {
    if (fileCount >= MAX_FILES || signal?.aborted) return
    let entries: string[]
    try {
      entries = readdirSync(join(rootPath, base))
    } catch {
      if (base) warnings.push(`${base} 无法读取`)
      return
    }
    for (const entry of entries) {
      if (signal?.aborted || fileCount >= MAX_FILES) return
      if (IGNORED.has(entry) || entry.startsWith('.')) continue
      const relative = base ? `${base}/${entry}` : entry
      const absolute = join(rootPath, relative)
      let stats
      try {
        stats = statSync(absolute)
      } catch {
        continue
      }
      if (stats.isDirectory()) {
        if (depth <= 1) addModule(relative)
        if (depth < MAX_DEPTH) visit(relative, depth + 1)
        continue
      }
      fileCount += 1
      if (entry === 'pnpm-lock.yaml' || entry === 'yarn.lock' || entry === 'package-lock.json' || entry === 'bun.lockb' || entry === 'bun.lock') {
        lockfiles.push(relative)
      }
      const extension = extname(entry).toLowerCase()
      const language = LANGUAGE_BY_EXTENSION[extension]
      if (language) languages.set(language, (languages.get(language) ?? 0) + 1)
      if (entry === 'tsconfig.json') addFramework('TypeScript', relative)
      const kind = manifestKind(entry)
      if (kind) {
        manifests.push({ path: relative, kind })
        if (depth > 0) addModule(relative.slice(0, Math.max(0, relative.lastIndexOf('/'))))
        if (kind === 'package.json') readPackageJson(relative)
        else if (kind === 'maven') {
          languages.set('Java', (languages.get('Java') ?? 0) + 1)
          addFramework('Java / Maven', relative)
          try {
            if (readFileSync(absolute, 'utf8').includes('spring-boot')) addFramework('Spring', relative)
          } catch { /* unreadable manifest is already covered by scan */ }
        } else if (kind === 'gradle') {
          languages.set('Java/Kotlin', (languages.get('Java/Kotlin') ?? 0) + 1)
          addFramework('Gradle', relative)
        } else if (kind === 'python') {
          languages.set('Python', (languages.get('Python') ?? 0) + 1)
          addFramework('Python', relative)
        } else if (kind === 'go') {
          languages.set('Go', (languages.get('Go') ?? 0) + 1)
          addFramework('Go Modules', relative)
        } else if (kind === 'cargo') {
          languages.set('Rust', (languages.get('Rust') ?? 0) + 1)
          addFramework('Cargo', relative)
        } else if (kind === 'composer') {
          languages.set('PHP', (languages.get('PHP') ?? 0) + 1)
          addFramework('Composer', relative)
        } else if (kind === 'ruby') {
          languages.set('Ruby', (languages.get('Ruby') ?? 0) + 1)
          addFramework('Ruby', relative)
        } else if (kind === 'dotnet') {
          languages.set('C#', (languages.get('C#') ?? 0) + 1)
          addFramework('.NET', relative)
        }
      }
    }
  }
  visit('', 0)

  const springHints = ['src/main/java', 'src/main/resources/application.yml', 'src/main/resources/application.properties']
  if (springHints.some((path) => existsSync(join(rootPath, path)))) addFramework('Spring', springHints.filter((path) => existsSync(join(rootPath, path))).join(', '))

  if (packageFiles.length > 0) {
    languages.set('JavaScript', (languages.get('JavaScript') ?? 0) + 1)
    if (existsSync(join(rootPath, 'tsconfig.json')) || [...languages.keys()].includes('TypeScript')) languages.set('TypeScript', (languages.get('TypeScript') ?? 0) + 1)
  }
  if (fileCount >= MAX_FILES) warnings.push(`文件数达到扫描上限 ${MAX_FILES}`)

  if (lockfiles.some((path) => path.endsWith('pnpm-lock.yaml'))) packageManager = 'pnpm'
  else if (lockfiles.some((path) => path.endsWith('yarn.lock'))) packageManager = 'yarn'
  else if (lockfiles.some((path) => path.endsWith('bun.lockb') || path.endsWith('bun.lock'))) packageManager = 'bun'
  else if (lockfiles.some((path) => path.endsWith('package-lock.json'))) packageManager = 'npm'
  else if (manifests.some((manifest) => manifest.kind === 'maven')) packageManager = 'maven'
  else if (manifests.some((manifest) => manifest.kind === 'gradle')) packageManager = 'gradle'
  else if (manifests.some((manifest) => manifest.kind === 'go')) packageManager = 'go modules'
  else if (manifests.some((manifest) => manifest.kind === 'cargo')) packageManager = 'cargo'
  else if (manifests.some((manifest) => manifest.kind === 'python')) packageManager = 'pip / poetry'
  else if (manifests.some((manifest) => manifest.kind === 'composer')) packageManager = 'composer'
  else if (manifests.some((manifest) => manifest.kind === 'ruby')) packageManager = 'bundler'
  else if (manifests.some((manifest) => manifest.kind === 'dotnet')) packageManager = 'nuget'

  if (manifests.length === 0) warnings.push('未发现 package.json / pom.xml / go.mod 等可识别清单')
  if (languages.size === 0) warnings.push('未发现可识别的源代码文件')

  return {
    id: newId('snp'),
    projectId,
    gitHead,
    scannedAt: now(),
    languages: [...languages.keys()],
    frameworks: [...frameworks.entries()].map(([name, evidence]) => ({ name, evidence })),
    packageManager,
    modules,
    keyDependencies: [...keyDependencies].slice(0, 40),
    warnings,
    indexVersion: 2,
  }
}
