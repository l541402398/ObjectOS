import { useId, type CSSProperties } from 'react'
import {
  AGENT_BLINK_POSE_DATA_URLS,
  AGENT_CODING_BLINK_DATA_URLS,
  AGENT_CODING_POSE_DATA_URLS,
  AGENT_CODING_TYPE_DATA_URLS,
  AGENT_COFFEE_POSE_DATA_URLS,
  AGENT_COFFEE_SIP_DATA_URLS,
  AGENT_LOOK_LEFT_DATA_URLS,
  AGENT_LOOK_RIGHT_DATA_URLS,
  AGENT_PORTRAIT_DATA_URLS,
  AGENT_WRITING_BLINK_DATA_URLS,
  AGENT_WRITING_GLIDE_DATA_URLS,
  AGENT_WRITING_POSE_DATA_URLS,
  AGENT_YAWN_POSE_DATA_URLS,
  AGENT_YAWN_RUB_DATA_URLS,
} from './agent-portraits-data.js'

export type AgentWorkActivity = 'idle' | 'coding' | 'writing'

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
  skin: string
  skinShadow: string
  sleeve: string
  cuff: string
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
    skin: '#F7CBB2',
    skinShadow: '#D99578',
    sleeve: '#243B67',
    cuff: '#F8FAFC',
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
    skin: '#F5C6A8',
    skinShadow: '#D49070',
    sleeve: '#13795B',
    cuff: '#A7F3D0',
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
    skin: '#F6C8AA',
    skinShadow: '#D69272',
    sleeve: '#48A8E8',
    cuff: '#E0F2FE',
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
    skin: '#F9D2BC',
    skinShadow: '#DBA084',
    sleeve: '#9B82C7',
    cuff: '#F3E8FF',
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
    skin: '#F8CEB6',
    skinShadow: '#DA9B7E',
    sleeve: '#E8687C',
    cuff: '#FFE4E6',
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
    skin: '#F3C1A0',
    skinShadow: '#D08B66',
    sleeve: '#53729A',
    cuff: '#E2E8F0',
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
    skin: '#F8CEB4',
    skinShadow: '#D9987A',
    sleeve: '#D99B38',
    cuff: '#FEF3C7',
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
    skin: '#F6C9AE',
    skinShadow: '#D69474',
    sleeve: '#D6CBB8',
    cuff: '#F8FAFC',
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
    skin: '#F9D2BC',
    skinShadow: '#DBA084',
    sleeve: '#9B82C7',
    cuff: '#F3E8FF',
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
    skin: '#F6C8AA',
    skinShadow: '#D69272',
    sleeve: '#48A8E8',
    cuff: '#E0F2FE',
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
    skin: '#F7CBB2',
    skinShadow: '#D99578',
    sleeve: '#243B67',
    cuff: '#F8FAFC',
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
    skin: '#F5C6A8',
    skinShadow: '#D49070',
    sleeve: '#13795B',
    cuff: '#A7F3D0',
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

/**
 * Resolves the task-specific working animation mode when an agent is working:
 * - 'coding': using a laptop to write code (编码 / 开发 / 调试 / 测试 / 构建 / 修复)
 * - 'writing': holding a pen to write requirements or design documents (需求 / 设计 / 文档 / 规划 / 产品 / 方案)
 */
export function resolveAgentWorkActivity(input: {
  status?: 'working' | 'idle' | 'offline'
  activity?: AgentWorkActivity
  role?: string
  name?: string
  taskTitle?: string
  taskDescription?: string
  taskLabels?: readonly string[]
  persona?: AgentPersona3D
}): AgentWorkActivity {
  if (input.status !== 'working') return 'idle'
  if (input.activity && input.activity !== 'idle') return input.activity

  const taskText = [
    input.taskTitle ?? '',
    input.taskDescription ?? '',
    ...(input.taskLabels ?? []),
  ]
    .join(' ')
    .toLowerCase()

  const roleText = `${input.role ?? ''} ${input.name ?? ''} ${input.persona?.badge ?? ''}`.toLowerCase()

  const writingPattern =
    /需求|设计|文档|产品|规划|方案|prd|spec|doc|design|plan|原型|梳理|撰写|报告|调研|分析|审查报告|大纲|手册/i
  const codingPattern =
    /编码|代码|开发|实现|修复|调试|重构|接口|前端|后端|全栈|脚本|构建|部署|测试|用例|组件|数据库|迁移|code|dev|implement|fix|bug|api|build|test|ui|fe|be/i

  if (taskText.trim().length > 0) {
    if (writingPattern.test(taskText) && !/代码实现|编码实现/.test(taskText)) {
      return 'writing'
    }
    if (codingPattern.test(taskText)) {
      return 'coding'
    }
  }

  if (/产品|需求|设计|体验|文档|策划|pm|product|designer/i.test(roleText)) {
    return 'writing'
  }
  return 'coding'
}

export function AgentAvatar3DSvg({
  persona,
  size = 44,
  status,
  workActivity = 'idle',
}: {
  persona: AgentPersona3D
  size?: number
  status?: 'working' | 'idle' | 'offline'
  workActivity?: AgentWorkActivity
}) {
  const uid = useId().replace(/:/g, '')
  const clipId = `av-clip-${uid}`
  const bgGradId = `av-bg-${uid}`

  const portraitUrl = AGENT_PORTRAIT_DATA_URLS[persona.portraitKey] ?? AGENT_PORTRAIT_DATA_URLS.avery!
  const blinkPoseUrl = AGENT_BLINK_POSE_DATA_URLS[persona.portraitKey] ?? AGENT_BLINK_POSE_DATA_URLS.avery!
  const lookLeftUrl = AGENT_LOOK_LEFT_DATA_URLS[persona.portraitKey] ?? AGENT_LOOK_LEFT_DATA_URLS.avery!
  const lookRightUrl = AGENT_LOOK_RIGHT_DATA_URLS[persona.portraitKey] ?? AGENT_LOOK_RIGHT_DATA_URLS.avery!
  const coffeePoseUrl = AGENT_COFFEE_POSE_DATA_URLS[persona.portraitKey] ?? AGENT_COFFEE_POSE_DATA_URLS.avery!
  const coffeeSipUrl = AGENT_COFFEE_SIP_DATA_URLS[persona.portraitKey] ?? AGENT_COFFEE_SIP_DATA_URLS.avery!
  const yawnPoseUrl = AGENT_YAWN_POSE_DATA_URLS[persona.portraitKey] ?? AGENT_YAWN_POSE_DATA_URLS.avery!
  const yawnRubUrl = AGENT_YAWN_RUB_DATA_URLS[persona.portraitKey] ?? AGENT_YAWN_RUB_DATA_URLS.avery!
  const codingPoseUrl = AGENT_CODING_POSE_DATA_URLS[persona.portraitKey] ?? AGENT_CODING_POSE_DATA_URLS.avery!
  const codingTypeUrl = AGENT_CODING_TYPE_DATA_URLS[persona.portraitKey] ?? AGENT_CODING_TYPE_DATA_URLS.avery!
  const codingBlinkUrl = AGENT_CODING_BLINK_DATA_URLS[persona.portraitKey] ?? AGENT_CODING_BLINK_DATA_URLS.avery!
  const writingPoseUrl = AGENT_WRITING_POSE_DATA_URLS[persona.portraitKey] ?? AGENT_WRITING_POSE_DATA_URLS.avery!
  const writingGlideUrl = AGENT_WRITING_GLIDE_DATA_URLS[persona.portraitKey] ?? AGENT_WRITING_GLIDE_DATA_URLS.avery!
  const writingBlinkUrl = AGENT_WRITING_BLINK_DATA_URLS[persona.portraitKey] ?? AGENT_WRITING_BLINK_DATA_URLS.avery!

  const isWorking = status === 'working'
  const effectiveActivity: AgentWorkActivity = isWorking
    ? workActivity === 'idle'
      ? 'coding'
      : workActivity
    : 'idle'

  // 1. Physiological Reflexes (continuous blinking every ~3.6s-4.5s + calm breathing)
  const blinkDuration = `${(3.65 + (persona.index % 5) * 0.22).toFixed(2)}s`
  const blinkDelay = `${-(persona.index * 0.77 + 0.25).toFixed(2)}s`
  const breathDuration = `${(5.2 + (persona.index % 4) * 0.35).toFixed(2)}s`
  const gazeDuration = `${(16.0 + (persona.index % 4) * 1.4).toFixed(2)}s`
  const gazeDelay = `${-(persona.index * 2.3 + 0.6).toFixed(2)}s`

  // 2. Voluntary Periodic Actions (drinking coffee / yawning only once in a while on a long 42s-49s cycle,
  //    staggered by 5.6s per agent so most of the team is calmly blinking while 1 agent occasionally acts)
  const voluntaryDuration = `${(42.0 + (persona.index % 4) * 2.4).toFixed(2)}s`
  const voluntaryDelay = `${-(persona.index * 5.6 + 1.2).toFixed(2)}s`

  const customVars = {
    '--av-blink-dur': blinkDuration,
    '--av-blink-delay': blinkDelay,
    '--av-breath-dur': breathDuration,
    '--av-gaze-dur': gazeDuration,
    '--av-gaze-delay': gazeDelay,
    '--av-voluntary-dur': voluntaryDuration,
    '--av-voluntary-delay': voluntaryDelay,
  } as CSSProperties

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 440 440"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`po-avatar-3d-svg ${status ? `is-${status}` : 'is-idle'} is-activity-${effectiveActivity}`.trim()}
      style={customVars}
      aria-hidden="true"
    >
      <defs>
        {/* Full-bust rounded squircle frame: preserves full shoulders, arms & 3D props */}
        <clipPath id={clipId}>
          <rect x="8" y="8" width="424" height="424" rx="122" />
        </clipPath>
        <radialGradient id={bgGradId} cx="35%" cy="22%" r="78%">
          <stop offset="0%" stopColor={persona.bgStart} />
          <stop offset="100%" stopColor={persona.bgEnd} />
        </radialGradient>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        <rect x="8" y="8" width="424" height="424" rx="122" fill={`url(#${bgGradId})`} />

        {/* Mirror wrapper separated from CSS animation wrapper so mirrored personas stay accurate */}
        <g
          transform={persona.mirror ? 'translate(440, 0) scale(-1, 1)' : undefined}
          className="po-avatar-bust-core"
        >
          {/* Unified 440x440 coordinate space scaled slightly to fill squircle */}
          <g transform="translate(-12, -10) scale(1.054545)">
            {/* Calm vertical breathing torso (ZERO left-right swaying or tilting) */}
            <g className="po-avatar-live-body">
              {!isWorking ? (
                <>
                  {/* A. Continuous Physiological State: Base 3D Portrait + Micro-Gaze + Continuous Physiological Blinking */}
                  <g className="po-avatar-pose-base">
                    <image
                      href={portraitUrl}
                      x="0"
                      y="0"
                      width="440"
                      height="440"
                      preserveAspectRatio="xMidYMid slice"
                    />
                    <image
                      href={lookLeftUrl}
                      x="0"
                      y="0"
                      width="440"
                      height="440"
                      preserveAspectRatio="xMidYMid slice"
                      className="po-avatar-look-left"
                    />
                    <image
                      href={lookRightUrl}
                      x="0"
                      y="0"
                      width="440"
                      height="440"
                      preserveAspectRatio="xMidYMid slice"
                      className="po-avatar-look-right"
                    />
                    <image
                      href={blinkPoseUrl}
                      x="0"
                      y="0"
                      width="440"
                      height="440"
                      preserveAspectRatio="xMidYMid slice"
                      className="po-avatar-physio-blink"
                    />
                  </g>

                  {/* B. Occasional Voluntary Action 1: Full-Frame Native 3D Coffee Hold & Smooth Sip */}
                  <g className="po-avatar-voluntary-coffee">
                    <image
                      href={coffeePoseUrl}
                      x="0"
                      y="0"
                      width="440"
                      height="440"
                      preserveAspectRatio="xMidYMid slice"
                    />
                    <image
                      href={coffeeSipUrl}
                      x="0"
                      y="0"
                      width="440"
                      height="440"
                      preserveAspectRatio="xMidYMid slice"
                      className="po-avatar-coffee-sip"
                    />
                  </g>

                  {/* C. Occasional Voluntary Action 2: Full-Frame Native 3D Yawn & Eye-Rub */}
                  <g className="po-avatar-voluntary-yawn">
                    <image
                      href={yawnPoseUrl}
                      x="0"
                      y="0"
                      width="440"
                      height="440"
                      preserveAspectRatio="xMidYMid slice"
                    />
                    <image
                      href={yawnRubUrl}
                      x="0"
                      y="0"
                      width="440"
                      height="440"
                      preserveAspectRatio="xMidYMid slice"
                      className="po-avatar-yawn-rub"
                    />
                  </g>
                </>
              ) : effectiveActivity === 'writing' ? (
                /* WORKING MODE — WRITING DOCUMENT WITH PEN:
                   Full-frame 440x440 native 3D pose + continuous elastic pen glide + continuous physiological blinking */
                <g className="po-avatar-pose-writing">
                  <image
                    href={writingPoseUrl}
                    x="0"
                    y="0"
                    width="440"
                    height="440"
                    preserveAspectRatio="xMidYMid slice"
                  />
                  <image
                    href={writingGlideUrl}
                    x="0"
                    y="0"
                    width="440"
                    height="440"
                    preserveAspectRatio="xMidYMid slice"
                    className="po-avatar-writing-glide"
                  />
                  <image
                    href={writingBlinkUrl}
                    x="0"
                    y="0"
                    width="440"
                    height="440"
                    preserveAspectRatio="xMidYMid slice"
                    className="po-avatar-physio-blink"
                  />
                </g>
              ) : (
                /* WORKING MODE — CODING ON LAPTOP:
                   Full-frame 440x440 native 3D pose + continuous elastic keyboard typing + continuous physiological blinking */
                <g className="po-avatar-pose-coding">
                  <image
                    href={codingPoseUrl}
                    x="0"
                    y="0"
                    width="440"
                    height="440"
                    preserveAspectRatio="xMidYMid slice"
                  />
                  <image
                    href={codingTypeUrl}
                    x="0"
                    y="0"
                    width="440"
                    height="440"
                    preserveAspectRatio="xMidYMid slice"
                    className="po-avatar-coding-type"
                  />
                  <image
                    href={codingBlinkUrl}
                    x="0"
                    y="0"
                    width="440"
                    height="440"
                    preserveAspectRatio="xMidYMid slice"
                    className="po-avatar-physio-blink"
                  />
                </g>
              )}
            </g>
          </g>
        </g>

        {/* Clean Inner Glass Rim matching squircle */}
        <rect
          x="9.5"
          y="9.5"
          width="421"
          height="421"
          rx="120"
          stroke="rgba(255, 255, 255, 0.88)"
          strokeWidth="5"
          fill="none"
        />
      </g>

      {/* Subtle static outer border */}
      <rect
        x="7"
        y="7"
        width="426"
        height="426"
        rx="123"
        stroke={isWorking ? '#10B981' : 'rgba(148, 163, 184, 0.36)'}
        strokeWidth={isWorking ? '5' : '2.5'}
        fill="none"
      />
    </svg>
  )
}
