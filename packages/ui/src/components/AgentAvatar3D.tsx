import { useId, type CSSProperties } from 'react'
import {
  AGENT_BLINK_STRIP_DATA_URLS,
  AGENT_LOOK_LEFT_DATA_URLS,
  AGENT_LOOK_RIGHT_DATA_URLS,
  AGENT_PORTRAIT_DATA_URLS,
} from './agent-portraits-data.js'

export interface AgentPersona3D {
  id: string
  portraitKey: 'avery' | 'sage' | 'kai' | 'nova' | 'iris' | 'leo' | 'mia' | 'eli'
  index: number
  label: string
  gender: 'female' | 'male'
  badge: string
  bgStart: string
  bgEnd: string
  ring: string
  auraSecondary: string
  auraTertiary: string
  mirror?: boolean
}

export const AGENT_3D_PERSONAS: readonly AgentPersona3D[] = [
  {
    id: 'avery-f',
    portraitKey: 'avery',
    index: 0,
    label: '产品负责人 · 女',
    gender: 'female',
    badge: '产品 / 需求',
    bgStart: '#E0EAFF',
    bgEnd: '#93B4FF',
    ring: '#4F64D9',
    auraSecondary: '#38BDF8',
    auraTertiary: '#818CF8',
  },
  {
    id: 'sage-m',
    portraitKey: 'sage',
    index: 1,
    label: '系统架构师 · 男',
    gender: 'male',
    badge: '系统架构',
    bgStart: '#DCFCE7',
    bgEnd: '#6EE7B7',
    ring: '#10B981',
    auraSecondary: '#06B6D4',
    auraTertiary: '#34D399',
  },
  {
    id: 'kai-m',
    portraitKey: 'kai',
    index: 2,
    label: '全栈工程师 · 男',
    gender: 'male',
    badge: '全栈研发',
    bgStart: '#D8F5FF',
    bgEnd: '#7AD7F0',
    ring: '#0EA5E9',
    auraSecondary: '#6366F1',
    auraTertiary: '#38BDF8',
  },
  {
    id: 'nova-f',
    portraitKey: 'nova',
    index: 3,
    label: '代码审查员 · 女',
    gender: 'female',
    badge: '代码审查',
    bgStart: '#F1E4FF',
    bgEnd: '#C09BFF',
    ring: '#8B5CF6',
    auraSecondary: '#EC4899',
    auraTertiary: '#A78BFA',
  },
  {
    id: 'iris-f',
    portraitKey: 'iris',
    index: 4,
    label: '测试工程师 · 女',
    gender: 'female',
    badge: '测试验证',
    bgStart: '#FFE4E6',
    bgEnd: '#FDA4AF',
    ring: '#F43F5E',
    auraSecondary: '#FB923C',
    auraTertiary: '#F472B6',
  },
  {
    id: 'leo-m',
    portraitKey: 'leo',
    index: 5,
    label: '研发与运维专家 · 男',
    gender: 'male',
    badge: '核心研发',
    bgStart: '#E0F2FE',
    bgEnd: '#7DD3FC',
    ring: '#2563EB',
    auraSecondary: '#06B6D4',
    auraTertiary: '#60A5FA',
  },
  {
    id: 'mia-f',
    portraitKey: 'mia',
    index: 6,
    label: '体验与创意助理 · 女',
    gender: 'female',
    badge: '体验 / 助理',
    bgStart: '#FEF3C7',
    bgEnd: '#FCD34D',
    ring: '#F59E0B',
    auraSecondary: '#EC4899',
    auraTertiary: '#FBBF24',
  },
  {
    id: 'eli-m',
    portraitKey: 'eli',
    index: 7,
    label: '通用智能助理 · 男',
    gender: 'male',
    badge: '通用助理',
    bgStart: '#E0E7FF',
    bgEnd: '#818CF8',
    ring: '#6366F1',
    auraSecondary: '#38BDF8',
    auraTertiary: '#A5B4FC',
  },
  {
    id: 'chloe-f',
    portraitKey: 'nova',
    index: 8,
    label: '数据与模型专家 · 女',
    gender: 'female',
    badge: 'AI / 数据',
    bgStart: '#CCFBF1',
    bgEnd: '#5EEAD4',
    ring: '#14B8A6',
    auraSecondary: '#3B82F6',
    auraTertiary: '#2DD4BF',
    mirror: true,
  },
  {
    id: 'liam-m',
    portraitKey: 'kai',
    index: 9,
    label: '平台工程师 · 男',
    gender: 'male',
    badge: '构建 / 部署',
    bgStart: '#E0F2FE',
    bgEnd: '#7DD3FC',
    ring: '#0284C7',
    auraSecondary: '#10B981',
    auraTertiary: '#38BDF8',
    mirror: true,
  },
  {
    id: 'quinn-f',
    portraitKey: 'avery',
    index: 10,
    label: '前端架构师 · 女',
    gender: 'female',
    badge: '前端工程',
    bgStart: '#EDE9FE',
    bgEnd: '#A78BFA',
    ring: '#7C3AED',
    auraSecondary: '#EC4899',
    auraTertiary: '#C084FC',
    mirror: true,
  },
  {
    id: 'noah-m',
    portraitKey: 'sage',
    index: 11,
    label: '性能与可靠性专家 · 男',
    gender: 'male',
    badge: '性能调优',
    bgStart: '#D1FAE5',
    bgEnd: '#6EE7B7',
    ring: '#059669',
    auraSecondary: '#3B82F6',
    auraTertiary: '#34D399',
    mirror: true,
  },
]

export const AGENT_PERSONAS_3D = AGENT_3D_PERSONAS

const teamPersonaRegistry = new Map<string, AgentPersona3D>()

function preferredIndicesForText(text: string): number[] {
  const n = text.trim().toLowerCase()
  if (n.includes('avery')) return [0, 6, 4, 3]
  if (n.includes('sage') || n.includes('atlas')) return [1, 5, 2, 7]
  if (n.includes('kai')) return [2, 5, 7, 1]
  if (n.includes('nova')) return [3, 4, 6, 0]
  if (n.includes('iris') || n.includes('quinn')) return [4, 6, 3, 0]
  if (n.includes('leo') || n.includes('echo')) return [5, 2, 7, 1]
  if (n.includes('mia') || n.includes('maya')) return [6, 4, 3, 0]
  if (n.includes('eli') || n.includes('ethan')) return [7, 5, 2, 1]
  if (n.includes('产品') || n.includes('需求')) return [0, 6, 3]
  if (n.includes('架构')) return [1, 5, 2]
  if (n.includes('审查') || n.includes('审核')) return [3, 4, 6]
  if (n.includes('测试') || n.includes('质量') || n.includes('qa')) return [4, 6, 3]
  if (n.includes('开发') || n.includes('研发') || n.includes('工程')) return [5, 2, 7, 1]
  if (n.includes('设计') || n.includes('体验')) return [6, 0, 4]
  if (n.includes('通用') || n.includes('助理') || n.includes('助手')) return [6, 7, 5, 4]
  return []
}

export function assignTeamPersonas3D<T extends { id?: string; name: string; role?: string }>(
  agents: readonly T[],
): Map<string, AgentPersona3D> {
  const result = new Map<string, AgentPersona3D>()
  const usedIndices = new Set<number>()
  const pending: { agent: T; key: string }[] = []

  const canonicalMap: Record<string, number> = {
    avery: 0,
    sage: 1,
    kai: 2,
    nova: 3,
    iris: 4,
    leo: 5,
    mia: 6,
    eli: 7,
  }

  for (const agent of agents) {
    const key = agent.id || agent.name
    const lowerName = agent.name.trim().toLowerCase()
    const exactIdx = canonicalMap[lowerName]
    if (exactIdx !== undefined && !usedIndices.has(exactIdx)) {
      const persona = AGENT_3D_PERSONAS[exactIdx]!
      usedIndices.add(exactIdx)
      result.set(key, persona)
      teamPersonaRegistry.set(lowerName, persona)
      if (agent.id) teamPersonaRegistry.set(agent.id.toLowerCase(), persona)
      if (agent.role) teamPersonaRegistry.set(`${lowerName} ${agent.role.trim().toLowerCase()}`, persona)
    } else {
      pending.push({ agent, key })
    }
  }

  for (const { agent, key } of pending) {
    const lowerName = agent.name.trim().toLowerCase()
    const combined = `${lowerName} ${(agent.role ?? '').trim().toLowerCase()}`
    const candidates = preferredIndicesForText(combined)
    let chosenIdx: number | undefined = candidates.find((idx) => !usedIndices.has(idx))

    if (chosenIdx === undefined) {
      for (let i = 0; i < AGENT_3D_PERSONAS.length; i++) {
        if (!usedIndices.has(i)) {
          chosenIdx = i
          break
        }
      }
    }
    if (chosenIdx === undefined) {
      let hash = 0
      for (let i = 0; i < combined.length; i++) {
        hash = (hash * 31 + combined.charCodeAt(i)) >>> 0
      }
      chosenIdx = hash % AGENT_3D_PERSONAS.length
    }

    usedIndices.add(chosenIdx)
    const persona = AGENT_3D_PERSONAS[chosenIdx]!
    result.set(key, persona)
    teamPersonaRegistry.set(lowerName, persona)
    if (agent.id) teamPersonaRegistry.set(agent.id.toLowerCase(), persona)
    if (agent.role) teamPersonaRegistry.set(combined, persona)
  }

  return result
}

export function resolveAgentPersona3D(name: string, personaId?: string): AgentPersona3D {
  if (personaId) {
    const byId = AGENT_3D_PERSONAS.find((p) => p.id === personaId || p.portraitKey === personaId)
    if (byId) return byId
  }
  const normalized = name.trim().toLowerCase()
  const cached = teamPersonaRegistry.get(normalized)
  if (cached) return cached

  const firstToken = normalized.split(/\s+/)[0]
  if (firstToken && teamPersonaRegistry.has(firstToken)) {
    return teamPersonaRegistry.get(firstToken)!
  }

  const canonicalMap: Record<string, number> = {
    avery: 0,
    sage: 1,
    kai: 2,
    nova: 3,
    iris: 4,
    leo: 5,
    mia: 6,
    eli: 7,
    chloe: 8,
    liam: 9,
    quinn: 10,
    noah: 11,
  }
  if (firstToken && firstToken in canonicalMap) {
    return AGENT_3D_PERSONAS[canonicalMap[firstToken]!]!
  }

  const preferred = preferredIndicesForText(normalized)
  if (preferred.length > 0) {
    let hash = 0
    for (let i = 0; i < normalized.length; i++) {
      hash = (hash * 33 + normalized.charCodeAt(i)) >>> 0
    }
    return AGENT_3D_PERSONAS[preferred[hash % preferred.length]!]!
  }

  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0
  }
  return AGENT_3D_PERSONAS[hash % 8]!
}

export function AgentAvatar3DSvg({
  persona,
  size = 36,
  status,
}: {
  persona: AgentPersona3D
  size?: number
  status?: 'working' | 'idle' | 'offline'
}) {
  const uid = useId().replace(/:/g, '')
  const clipId = `av-clip-${uid}`
  const bgGradId = `av-bg-${uid}`

  const portraitUrl = AGENT_PORTRAIT_DATA_URLS[persona.portraitKey] ?? AGENT_PORTRAIT_DATA_URLS.avery!
  const blinkStripUrl = AGENT_BLINK_STRIP_DATA_URLS[persona.portraitKey] ?? AGENT_BLINK_STRIP_DATA_URLS.avery!
  const lookLeftUrl = AGENT_LOOK_LEFT_DATA_URLS[persona.portraitKey] ?? AGENT_LOOK_LEFT_DATA_URLS.avery!
  const lookRightUrl = AGENT_LOOK_RIGHT_DATA_URLS[persona.portraitKey] ?? AGENT_LOOK_RIGHT_DATA_URLS.avery!

  // Calm, realistic human behavior cycle (9.5s - 13.5s) with staggered phase per persona:
  // Mostly looking forward calmly + natural blinking, and occasionally turning head/eyes slightly left or right to observe.
  const cycleDelay = `${-(persona.index * 1.85 + 0.4).toFixed(2)}s`
  const cycleDuration = `${(9.6 + (persona.index % 5) * 0.95).toFixed(2)}s`
  const customVars = {
    '--av-cycle-delay': cycleDelay,
    '--av-cycle-dur': cycleDuration,
  } as CSSProperties

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 320 320"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`po-avatar-3d-svg ${status ? `is-${status}` : ''}`.trim()}
      style={customVars}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="160" cy="160" r="150" />
        </clipPath>
        <radialGradient id={bgGradId} cx="35%" cy="25%" r="75%">
          <stop offset="0%" stopColor={persona.bgStart} />
          <stop offset="100%" stopColor={persona.bgEnd} />
        </radialGradient>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        <circle cx="160" cy="160" r="151" fill={`url(#${bgGradId})`} />

        <g transform={persona.mirror ? 'translate(320, 0) scale(-1, 1)' : undefined}>
          {/* Base 320x320 HD 3D Portrait (shoulders & body remain anchored and calm) */}
          <image
            href={portraitUrl}
            x="-12"
            y="-8"
            width="344"
            height="344"
            preserveAspectRatio="xMidYMid slice"
          />

          {/* 2.5D Side-Glance Left (face turns & eyes look left while shoulders stay still) */}
          <image
            href={lookLeftUrl}
            x="48.18"
            y="52.2"
            width="223.6"
            height="210.7"
            preserveAspectRatio="none"
            className="po-avatar-look-left"
          />

          {/* 2.5D Side-Glance Right (face turns & eyes look right while shoulders stay still) */}
          <image
            href={lookRightUrl}
            x="48.18"
            y="52.2"
            width="223.6"
            height="210.7"
            preserveAspectRatio="none"
            className="po-avatar-look-right"
          />

          {/* Natural 3D Eyelid & Eyelash Blink Strip */}
          <image
            href={blinkStripUrl}
            x="73.98"
            y="125.3"
            width="172"
            height="81.7"
            preserveAspectRatio="none"
            className="po-avatar-blink-strip"
          />
        </g>

        {/* Clean Static Inner Glass Rim (no spinning halo ring) */}
        <circle
          cx="160"
          cy="160"
          r="149.5"
          stroke="rgba(255, 255, 255, 0.86)"
          strokeWidth="5"
          fill="none"
        />
      </g>

      {/* Subtle static outer hairline border */}
      <circle
        cx="160"
        cy="160"
        r="152"
        stroke={status === 'working' ? '#10B981' : 'rgba(148, 163, 184, 0.35)'}
        strokeWidth={status === 'working' ? '4.5' : '2.5'}
        fill="none"
      />
    </svg>
  )
}
