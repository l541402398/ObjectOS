import { AppError, newId, now, type AgentDefinition, type AgentDefinitionUpsert, type AgentPersona, type RuntimeCapabilities, type RuntimeDetection, type RuntimeProfile, type RuntimeProfileUpsert, type RuntimeRegistryEntry, type Skill } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AcpClient } from './acp-client.js'
import { promisify } from 'node:util'
import crossSpawn from 'cross-spawn'
import { resolveExecutable } from './executable-resolver.js'

const exec = promisify(execFile)

const DEFAULT_PERSONA: AgentPersona = {
  role: '', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '',
}

const CAPABILITIES: Record<string, RuntimeCapabilities> = {
  stream: { stream: true, toolCalls: false, skills: true, systemPrompt: 'native', sessionResume: false, subagents: false, worktree: false, permissions: false, costMetrics: false, modelSwitch: false },
  cli: { stream: true, toolCalls: true, skills: true, systemPrompt: 'prepend', sessionResume: true, subagents: true, worktree: true, permissions: true, costMetrics: false, modelSwitch: false },
  acp: { stream: true, toolCalls: true, skills: false, systemPrompt: 'native', sessionResume: true, subagents: false, worktree: false, permissions: true, costMetrics: false, modelSwitch: false },
  http: { stream: true, toolCalls: false, skills: false, systemPrompt: 'prepend', sessionResume: false, subagents: false, worktree: false, permissions: false, costMetrics: false, modelSwitch: false },
  sdk: { stream: true, toolCalls: true, skills: true, systemPrompt: 'native', sessionResume: true, subagents: false, worktree: false, permissions: true, costMetrics: true, modelSwitch: true },
}

interface AdapterDefinition {
  id: string
  name: string
  command: string | null
  args: string[]
  protocol: RuntimeProfile['protocol']
  capabilities: RuntimeCapabilities
}

const ADAPTERS: AdapterDefinition[] = [
  { id: 'projectos-native', name: 'ProjectOS Native', command: null, args: [], protocol: 'native', capabilities: CAPABILITIES.stream! },
  { id: 'claude-code', name: 'Claude Code', command: 'claude', args: ['--print'], protocol: 'cli', capabilities: CAPABILITIES.cli! },
  { id: 'codex', name: 'Codex CLI', command: 'codex', args: ['exec'], protocol: 'cli', capabilities: CAPABILITIES.cli! },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', args: ['acp'], protocol: 'acp', capabilities: CAPABILITIES.acp! },
  { id: 'qwen-code', name: 'Qwen Code', command: 'qwen', args: [], protocol: 'cli', capabilities: CAPABILITIES.cli! },
  { id: 'gemini-cli', name: 'Gemini CLI', command: 'gemini', args: [], protocol: 'cli', capabilities: CAPABILITIES.cli! },
  { id: 'deepseek-harness', name: 'DeepSeek Harness', command: 'dsh', args: ['headless'], protocol: 'cli', capabilities: CAPABILITIES.cli! },
  { id: 'acp', name: 'ACP Agent', command: null, args: [], protocol: 'acp', capabilities: CAPABILITIES.acp! },
]

function personaOf(input: AgentDefinitionUpsert): AgentPersona {
  return { ...DEFAULT_PERSONA, ...input.persona, role: input.role }
}

function promptSnapshot(agent: AgentDefinition, skills: Skill[]): { prompt: string; sources: string[] } {
  const sources = ['Agent Persona']
  const parts = [`# Agent: ${agent.name}`, `Role: ${agent.role}`]
  if (agent.persona.systemPrompt.trim()) parts.push(agent.persona.systemPrompt.trim())
  for (const key of ['background', 'responsibilities', 'principles', 'style', 'constraints'] as const) {
    if (agent.persona[key]?.trim()) parts.push(`${key}: ${agent.persona[key]}`)
  }
  for (const binding of agent.skills.filter((item) => item.enabled)) {
    const skill = skills.find((item) => item.id === binding.skillId)
    if (skill) {
      parts.push(`# Skill: ${skill.name}`, skill.content)
      sources.push(`Skill: ${skill.name}@${skill.version}`)
    }
  }
  return { prompt: parts.join('\n\n'), sources }
}

export class AgentStudioService {
  constructor(private readonly store: SqliteStore) {}

  listAgents(): AgentDefinition[] {
    return this.store.read.listAgentDefinitions()
  }

  upsertAgent(input: AgentDefinitionUpsert): AgentDefinition {
    const profiles = this.store.read.listRuntimeProfiles()
    const missing = input.runtimeProfileIds.filter((id) => !profiles.some((profile) => profile.id === id))
    if (missing.length) throw new AppError('BAD_REQUEST', `Runtime 不存在：${missing.join(', ')}`)
    if (input.primaryRuntimeProfileId && !input.runtimeProfileIds.includes(input.primaryRuntimeProfileId)) {
      throw new AppError('BAD_REQUEST', '主 Runtime 必须在已绑定列表中')
    }
    const existing = input.id ? this.store.read.getAgentDefinition(input.id) : null
    if (input.id && !existing) throw new AppError('NOT_FOUND', 'Agent 不存在')
    const timestamp = now()
    const agent: AgentDefinition = {
      id: existing?.id ?? newId('agt'),
      name: input.name,
      role: input.role,
      description: input.description,
      category: input.category,
      avatar: input.avatar,
      visibility: input.visibility,
      status: existing?.status ?? 'active',
      persona: personaOf(input),
      skills: input.skillIds.map((skillId) => ({ skillId, version: this.store.read.listSkills().find((skill) => skill.id === skillId)?.version ?? '1.0.0', enabled: true })),
      runtimeProfileIds: input.runtimeProfileIds,
      primaryRuntimeProfileId: input.primaryRuntimeProfileId,
      modelRef: input.modelRef,
      permissions: input.permissions,
      currentVersion: (existing?.currentVersion ?? 0) + 1,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    return this.store.upsertAgentDefinition(agent)
  }

  exportAgent(id: string): { json: string; filename: string } {
    const agent = this.store.read.getAgentDefinition(id)
    if (!agent) throw new AppError('NOT_FOUND', 'Agent 不存在')
    const payload = { schemaVersion: 1, agent: { name: agent.name, role: agent.role, description: agent.description, category: agent.category, avatar: agent.avatar, visibility: agent.visibility, persona: agent.persona, skillIds: agent.skills.filter((item) => item.enabled).map((item) => item.skillId), runtimeProfileIds: agent.runtimeProfileIds, primaryRuntimeProfileId: agent.primaryRuntimeProfileId, modelRef: agent.modelRef, permissions: agent.permissions } }
    return { json: JSON.stringify(payload, null, 2), filename: agent.name.replace(/[^a-zA-Z0-9_-]+/g, '-') + '.agent.json' }
  }

  importAgent(json: string): AgentDefinition {
    let parsed: { schemaVersion?: number; agent?: AgentDefinitionUpsert }
    try { parsed = JSON.parse(json) as typeof parsed } catch { throw new AppError('BAD_REQUEST', 'Agent JSON 无法解析') }
    if (!parsed.agent || typeof parsed.agent.name !== 'string') throw new AppError('BAD_REQUEST', 'Agent JSON 缺少配置')
    const input = parsed.agent
    return this.upsertAgent({ ...input, id: undefined })
  }

  deleteAgent(id: string): void {
    try {
      this.store.deleteAgentDefinition(id)
    } catch {
      throw new AppError('CONFLICT', 'Agent 已被任务或会话引用，不能删除')
    }
  }

  preview(id: string): { prompt: string; sources: string[] } {
    const agent = this.store.read.getAgentDefinition(id)
    if (!agent) throw new AppError('NOT_FOUND', 'Agent 不存在')
    return promptSnapshot(agent, this.store.read.listSkills())
  }

  listSkills(): Skill[] { return this.store.read.listSkills() }

  importSkill(input: { name: string; content: string; description: string; version: string }): Skill {
    const timestamp = now()
    const skill: Skill = {
      id: newId('skl'), name: input.name, description: input.description, version: input.version,
      source: 'import', content: input.content, schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp,
    }
    return this.store.upsertSkill(skill)
  }

  ensureDefaultProfiles(): RuntimeProfile[] {
    const existing = this.store.read.listRuntimeProfiles()
    const timestamp = now()
    const present = new Set(existing.map((profile) => typeof profile.options.adapterId === 'string' ? profile.options.adapterId : profile.name))
    const created = [...existing]
    for (const adapter of ADAPTERS) {
      if (adapter.id === 'acp' || present.has(adapter.id)) continue
      created.push(this.store.upsertRuntimeProfile({
        id: newId('rtp'),
        name: adapter.name,
        protocol: adapter.protocol,
        executable: adapter.command,
        endpoint: null,
        args: adapter.args,
        authRef: null,
        modelRef: null,
        options: { adapterId: adapter.id },
        capabilities: adapter.capabilities,
        status: adapter.protocol === 'native' ? 'available' : 'unknown',
        version: adapter.protocol === 'native' ? 'embedded' : null,
        source: 'builtin',
        createdAt: timestamp,
        updatedAt: timestamp,
      }))
    }
    return created
  }

  listRuntimeProfiles(): RuntimeProfile[] {
    return this.ensureDefaultProfiles()
  }

  upsertRuntime(input: RuntimeProfileUpsert): RuntimeProfile {
    const timestamp = now()
    const existing = input.id ? this.store.read.listRuntimeProfiles().find((profile) => profile.id === input.id) : null
    const profile: RuntimeProfile = {
      id: existing?.id ?? newId('rtp'),
      name: input.name,
      protocol: input.protocol,
      executable: input.executable,
      endpoint: input.endpoint,
      args: input.args,
      authRef: input.authRef,
      modelRef: input.modelRef,
      options: input.options,
      capabilities: { ...(input.protocol === 'native' ? CAPABILITIES.stream! : CAPABILITIES[input.protocol] ?? CAPABILITIES.cli!), ...input.capabilities } as RuntimeCapabilities,
      status: 'unknown',
      version: existing?.version ?? null,
      source: existing?.source ?? 'custom',
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    return this.store.upsertRuntimeProfile(profile)
  }

  deleteRuntime(id: string): void {
    this.store.deleteRuntimeProfile(id)
  }

  async acpHandshake(profileId: string, cwd?: string) {
    const profile = this.store.read.listRuntimeProfiles().find((item) => item.id === profileId)
    if (!profile) throw new AppError('NOT_FOUND', 'Runtime 不存在')
    if (profile.protocol !== 'acp') throw new AppError('BAD_REQUEST', '该 Runtime 不是 ACP 协议')
    if (!profile.executable) throw new AppError('BAD_REQUEST', 'ACP Runtime 未配置可执行路径')
    const client = new AcpClient(profile.executable, profile.args, cwd || process.cwd())
    try {
      return await client.initialize(cwd || process.cwd())
    } finally {
      client.dispose()
    }
  }

  importRegistry(input: { registryId: string; name: string; version: string | null; description: string }): RuntimeProfile {
    const timestamp = now()
    const existing = this.store.read.listRuntimeProfiles().find((profile) => profile.options.registryId === input.registryId)
    if (existing) return existing
    return this.store.upsertRuntimeProfile({
      id: newId('rtp'), name: input.name, protocol: 'acp', executable: null, endpoint: null, args: [], authRef: null, modelRef: null,
      options: { registryId: input.registryId, description: input.description }, status: 'unavailable', version: input.version, source: 'registry',
      createdAt: timestamp, updatedAt: timestamp,
      capabilities: { stream: true, toolCalls: true, skills: false, systemPrompt: 'native', sessionResume: true, subagents: false, worktree: false, permissions: true, costMetrics: false, modelSwitch: false },
    })
  }

  async acpAuthenticate(profileId: string, methodId: string, cwd?: string) {
    const profile = this.store.read.listRuntimeProfiles().find((item) => item.id === profileId)
    if (!profile) throw new AppError('NOT_FOUND', 'Runtime 不存在')
    if (profile.protocol !== 'acp') throw new AppError('BAD_REQUEST', '该 Runtime 不是 ACP 协议')
    if (!profile.executable) throw new AppError('BAD_REQUEST', 'ACP Runtime 未配置可执行路径')
    const client = new AcpClient(profile.executable, profile.args, cwd || process.cwd())
    try {
      const result = await client.authenticate(methodId)
      return { ok: true, result }
    } finally {
      client.dispose()
    }
  }

  async acpPrompt(profileId: string, prompt: string, cwd?: string) {
    const profile = this.store.read.listRuntimeProfiles().find((item) => item.id === profileId)
    if (!profile) throw new AppError('NOT_FOUND', 'Runtime 不存在')
    if (profile.protocol !== 'acp') throw new AppError('BAD_REQUEST', '该 Runtime 不是 ACP 协议')
    if (!profile.executable) throw new AppError('BAD_REQUEST', 'ACP Runtime 未配置可执行路径')
    const client = new AcpClient(profile.executable, profile.args, cwd || process.cwd())
    const events: unknown[] = []
    const off = client.onEvent((message) => events.push(message))
    const startedAt = Date.now()
    try {
      const session = await client.initialize(cwd || process.cwd())
      const result = await client.prompt(session.sessionId, prompt)
      return { sessionId: session.sessionId, result, events, durationMs: Date.now() - startedAt }
    } finally {
      off()
      client.dispose()
    }
  }

  async detect(profileId?: string): Promise<RuntimeDetection[]> {
    const profiles = this.listRuntimeProfiles().filter((profile) => !profileId || profile.id === profileId)
    const results: RuntimeDetection[] = []
    for (const profile of profiles) {
      const adapter = ADAPTERS.find((item) => item.id === (typeof profile.options.adapterId === 'string' ? profile.options.adapterId : profile.id))
      if (profile.protocol === 'native') {
        results.push({ profileId: profile.id, adapterId: profile.id, name: profile.name, installed: true, executable: null, version: 'embedded', protocol: profile.protocol, capabilities: profile.capabilities, status: 'available', message: '内置运行时' })
        continue
      }
      const command = profile.executable || adapter?.command || ''
      if (!command) {
        results.push({ profileId: profile.id, adapterId: profile.id, name: profile.name, installed: false, executable: null, version: null, protocol: profile.protocol, capabilities: profile.capabilities, status: 'unavailable', message: '未配置可执行路径' })
        continue
      }
      try {
        const adapterId = typeof profile.options.adapterId === 'string' ? profile.options.adapterId : profile.id
        const knownOpenCode = adapterId === 'opencode' && process.env.APPDATA
          ? join(process.env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')
          : null
        const resolved = knownOpenCode && existsSync(knownOpenCode)
          ? knownOpenCode
          : await resolveExecutable(command)
        if (!resolved) throw new Error(`未找到可执行文件：${command}`)
        const executable = resolved
        let version: string | null = null
        try {
          const result = await exec(executable, ['--version'], { timeout: 10_000, windowsHide: true })
          version = (result.stdout || result.stderr).trim().split(/\r?\n/)[0]?.slice(0, 120) ?? null
        } catch { /* version flag is not universal */ }
        results.push({ profileId: profile.id, adapterId: profile.id, name: profile.name, installed: true, executable, version, protocol: profile.protocol, capabilities: profile.capabilities, status: 'available', message: version ? `已安装 ${version}` : '已安装' })
      } catch {
        const fallback = (typeof profile.options.adapterId === 'string' ? profile.options.adapterId : profile.id) === 'deepseek-harness' && process.env.LOCALAPPDATA
          ? join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')
          : null
        if (fallback && existsSync(fallback)) {
          let version: string | null = null
          try {
            const result = await exec(fallback, ['--version'], { timeout: 10_000, windowsHide: true })
            version = (result.stdout || result.stderr).trim().split(/\r?\n/)[0]?.slice(0, 120) ?? null
          } catch { /* ignore */ }
          results.push({ profileId: profile.id, adapterId: profile.id, name: profile.name, installed: true, executable: fallback, version, protocol: profile.protocol, capabilities: profile.capabilities, status: 'available', message: version ? `已安装 ${version}` : '已安装' })
          continue
        }
        results.push({ profileId: profile.id, adapterId: profile.id, name: profile.name, installed: false, executable: null, version: null, protocol: profile.protocol, capabilities: profile.capabilities, status: 'unavailable', message: '未找到可执行文件' })
      }
    }
    for (const result of results) {
      const profile = profiles.find((item) => item.id === result.profileId)
      if (!profile) continue
      this.store.upsertRuntimeProfile({
        ...profile,
        executable: result.executable,
        version: result.version,
        status: result.status === 'available' ? 'available' : result.status === 'incompatible' ? 'incompatible' : 'unavailable',
        updatedAt: now(),
      })
    }
    return results
  }

  async install(profileId: string): Promise<{ detection: RuntimeDetection; output: string }> {
    const profile = this.store.read.listRuntimeProfiles().find((item) => item.id === profileId)
    if (!profile) throw new AppError('NOT_FOUND', 'Runtime 不存在')
    if (profile.protocol === 'native') throw new AppError('BAD_REQUEST', '内置 Runtime 无需安装')
    const adapterId = typeof profile.options.adapterId === 'string' ? profile.options.adapterId : profile.id
    const packages: Record<string, string> = {
      'claude-code': '@anthropic-ai/claude-code',
      codex: '@openai/codex',
      opencode: 'opencode-ai',
      'qwen-code': '@qwen-code/qwen-code',
      'gemini-cli': '@google/gemini-cli',
    }
    const packageName = packages[adapterId]
    if (!packageName) throw new AppError('BAD_REQUEST', '该 Runtime 没有自动安装包，请手动安装')
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const command = [npm, 'install', '-g', packageName, '--no-fund', '--no-audit'].join(' ')
    const output = await new Promise<string>((resolve, reject) => {
      const child = crossSpawn(npm, ['install', '-g', packageName, '--no-fund', '--no-audit'], {
        windowsHide: true,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let text = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new AppError('TIMEOUT', `安装超时：${command}`))
      }, 180_000)
      child.stdout?.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
      child.stderr?.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
      child.on('error', (error) => { clearTimeout(timer); reject(new AppError('INTERNAL', `安装失败：${error.message}`)) })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve(text.slice(-8000))
        else reject(new AppError('INTERNAL', `安装失败（exit ${code}）：${text.slice(-4000)}`))
      })
    })
    const detection = (await this.detect(profileId))[0]
    if (!detection) throw new AppError('INTERNAL', '安装后无法检测 Runtime')
    return { detection, output }
  }

  async registry(force = false): Promise<{ source: string; cachedAt: number; entries: RuntimeRegistryEntry[] }> {
    const cachePath = 'projectos-acp-registry-cache'
    const cached = (globalThis as Record<string, unknown>)[cachePath] as { cachedAt: number; entries: RuntimeRegistryEntry[] } | undefined
    if (!force && cached && Date.now() - cached.cachedAt < 6 * 3_600_000) return { source: 'cache', ...cached }
    const response = await fetch('https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json', { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new AppError('PROVIDER_ERROR', `ACP Registry 请求失败：HTTP ${response.status}`)
    const raw = await response.json() as { agents?: unknown[] } | unknown[]
    const list = Array.isArray(raw) ? raw : raw.agents ?? []
    const entries: RuntimeRegistryEntry[] = list.map((item) => {
      const value = item as Record<string, unknown>
      return { id: String(value.id ?? value.name ?? ''), name: String(value.name ?? value.id ?? ''), version: value.version ? String(value.version) : null, description: String(value.description ?? ''), distribution: (value.distribution as Record<string, unknown>) ?? {} }
    }).filter((entry) => entry.id)
    const result = { cachedAt: Date.now(), entries }
    ;(globalThis as Record<string, unknown>)[cachePath] = result
    return { source: 'network', ...result }
  }
}













