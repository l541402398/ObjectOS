import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const repoRoot = process.cwd()

const PACKAGE_RULES = {
  contracts: [],
  domain: ['contracts'],
  application: ['contracts', 'domain', 'session-manager', 'collaboration'],
  persistence: ['contracts', 'domain', 'application'],
  kernel: ['contracts'],
  policy: ['contracts', 'workspace'],
  workspace: ['contracts', 'domain'],
  tools: ['contracts', 'domain', 'policy', 'provider-interfaces', 'workspace'],
  'session-manager': ['contracts', 'domain'],
  collaboration: ['contracts', 'domain', 'session-manager'],
  'context-engine': ['contracts', 'domain', 'workspace'],
  skills: ['contracts', 'domain'],
  'agent-runtime': ['contracts', 'domain', 'context-engine', 'provider-interfaces', 'tools', 'session-manager'],
  'provider-interfaces': ['contracts'],
  'connection-diagnostics': ['contracts'],
  'provider-openai-compatible': ['contracts', 'provider-interfaces', 'policy'],
  'provider-anthropic': ['contracts', 'provider-interfaces', 'policy'],
  'provider-openai-responses': ['contracts', 'provider-interfaces', 'policy'],
  'design-tokens': [],
  ui: ['contracts', 'design-tokens'],
  'ai-ui': ['contracts', 'design-tokens', 'ui'],
  // Organization control-plane contracts are platform-neutral; the server is the only consumer.
  'organization-contracts': [],
}

const RENDERER_ALLOWED = new Set(['contracts', 'design-tokens', 'ui', 'ai-ui'])
const NO_NODE_PACKAGES = new Set([
  'contracts',
  'domain',
  'skills',
  'design-tokens',
  'ui',
  'ai-ui',
  'session-manager',
  'organization-contracts',
])

const errors = []

function walk(dir) {
  const result = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'out') continue
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) result.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry)) result.push(full)
  }
  return result
}

function checkFile(file, rules) {
  const source = readFileSync(file, 'utf8')
  const relativeFile = relative(repoRoot, file)
  const specifiers = [
    ...source.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((match) => match[1])

  for (const specifier of specifiers) {
    if (!specifier) continue
    if (specifier.startsWith('@projectos/') && specifier.includes('/src/')) {
      errors.push(`${relativeFile}: 禁止跨包导入内部路径 ${specifier}`)
      continue
    }
    if (specifier.startsWith('@projectos/')) {
      const dep = specifier.split('/')[1]
      if (rules.allowed && !rules.allowed.has(dep)) {
        errors.push(`${relativeFile}: 包 ${rules.package} 不允许依赖 @projectos/${dep}`)
      }
      if (rules.renderer && !RENDERER_ALLOWED.has(dep)) {
        errors.push(`${relativeFile}: Renderer 不允许依赖 @projectos/${dep}`)
      }
    }
    if (rules.noNode && (specifier.startsWith('node:') || specifier === 'electron')) {
      errors.push(`${relativeFile}: 平台无关包不允许导入 ${specifier}`)
    }
    if (rules.renderer && (specifier.startsWith('node:') || specifier === 'electron')) {
      errors.push(`${relativeFile}: Renderer 不允许导入 ${specifier}`)
    }
    if (rules.renderer && specifier.startsWith('@projectos/persistence')) {
      errors.push(`${relativeFile}: Renderer 不得访问持久化层`)
    }
  }
}

for (const [pkg, deps] of Object.entries(PACKAGE_RULES)) {
  const srcDir = join(repoRoot, 'packages', pkg, 'src')
  for (const file of walk(srcDir)) {
    checkFile(file, {
      package: pkg,
      allowed: new Set(deps),
      noNode: NO_NODE_PACKAGES.has(pkg),
    })
  }
}

const rendererDir = join(repoRoot, 'apps', 'desktop', 'src', 'renderer')
for (const file of walk(rendererDir)) {
  checkFile(file, { package: 'desktop-renderer', renderer: true })
}

const runtimeDir = join(repoRoot, 'apps', 'runtime', 'src')
for (const file of walk(runtimeDir)) {
  checkFile(file, { package: 'runtime' })
}

// A0: the organization control plane must not reach into local execution packages.
const serverDir = join(repoRoot, 'apps', 'server', 'src')
for (const file of walk(serverDir)) {
  checkFile(file, {
    package: 'server',
    allowed: new Set(['organization-contracts', 'contracts']),
  })
}

if (errors.length > 0) {
  console.error('Dependency boundary check failed:')
  for (const error of errors) console.error(` - ${error}`)
  process.exit(1)
}

console.log('Dependency boundaries OK (packages, runtime, renderer, server).')





