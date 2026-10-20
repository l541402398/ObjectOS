import { useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Form, Input, Modal, Select, Switch, Tag } from 'antd'
import {
  CheckOutlined,
  DeleteOutlined,
  EyeOutlined,
  ExportOutlined,
  ImportOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import type { AgentDefinition } from '@projectos/contracts'
import { useAgentDefinitions, useRuntimeProfiles, useSkills } from '../lib/queries'
import { errorMessage } from '../lib/errors'

interface AgentFormValues {
  name: string
  role: string
  description?: string
  category?: string
  avatar?: string
  visibility?: 'private' | 'project' | 'space' | 'global'
  background?: string
  responsibilities?: string
  principles?: string
  style?: string
  constraints?: string
  systemPrompt?: string
  runtimeProfileIds?: string[]
  primaryRuntimeProfileId?: string | null
  skillIds?: string[]
  files?: boolean
  shell?: boolean
  network?: boolean
}

interface AgentTemplate {
  id: string
  name: string
  icon: string
  role: string
  category: string
  description: string
  background: string
  responsibilities: string
  principles: string
  style: string
  constraints: string
  systemPrompt: string
}

const TEMPLATES: AgentTemplate[] = [
  {
    id: 'general', name: '通用助理', icon: '✦', role: '通用助理', category: 'general',
    description: '处理日常任务、信息整理与跨角色协作。',
    background: '熟悉项目上下文与知识库检索。', responsibilities: '拆解任务、整理信息、给出可执行建议。',
    principles: '先确认事实，再给结论。', style: '简洁、直接。', constraints: '不执行未授权的高风险操作。', systemPrompt: '',
  },
  {
    id: 'backend', name: '后端开发', icon: '⌘', role: '高级后端工程师', category: 'code',
    description: '负责接口、数据访问与服务端工程。',
    background: '熟悉 Java/Spring Boot、数据库与 API 设计。', responsibilities: '设计接口、实现服务、补测试与文档。',
    principles: '契约优先、可回滚、可观测。', style: '工程化、给出来源与验证方式。', constraints: '破坏性变更先说明影响。', systemPrompt: '',
  },
  {
    id: 'frontend', name: '前端开发', icon: '◧', role: '高级前端工程师', category: 'code',
    description: '负责界面、交互与前端工程质量。',
    background: '熟悉 React、TypeScript、可访问性与性能。', responsibilities: '实现界面、联调 API、补交互状态。',
    principles: '真实数据优先，禁止静态假状态。', style: '关注细节与一致性。', constraints: '不引入未批准的 UI 框架。', systemPrompt: '',
  },
  {
    id: 'architect', name: '系统架构师', icon: '◇', role: '系统架构师', category: 'architecture',
    description: '负责边界、方案与关键技术决策。',
    background: '熟悉分布式系统、数据模型与架构演进。', responsibilities: '拆解系统边界、输出 ADR、评估风险。',
    principles: '简单、可验证、可演进。', style: '结构化、给出取舍。', constraints: '重大变更先写 ADR。', systemPrompt: '',
  },
  {
    id: 'qa', name: '测试工程师', icon: '✓', role: '测试工程师', category: 'quality',
    description: '负责验收、回归与质量门禁。',
    background: '熟悉自动化测试与边界条件分析。', responsibilities: '设计用例、执行验证、报告缺陷。',
    principles: '以可复现证据为准。', style: '明确步骤、结果与期望。', constraints: '不修改生产数据。', systemPrompt: '',
  },
  {
    id: 'ops', name: '运维工程师', icon: '◈', role: '运维工程师', category: 'ops',
    description: '负责运行环境、发布与可观测性。',
    background: '熟悉 Linux、进程、日志与网络。', responsibilities: '环境诊断、发布检查、故障定位。',
    principles: '变更可回滚、操作留审计。', style: '命令与证据并列。', constraints: '生产变更必须审批。', systemPrompt: '',
  },
  {
    id: 'product', name: '产品经理', icon: '▣', role: '产品经理', category: 'product',
    description: '负责需求、范围与验收标准。',
    background: '熟悉需求分析与生命周期管理。', responsibilities: '澄清目标、拆解需求、定义验收。',
    principles: '先问题后方案。', style: '短句、结论先行。', constraints: '不虚构用户数据。', systemPrompt: '',
  },
  {
    id: 'design', name: 'UI 设计师', icon: '✎', role: 'UI 设计师', category: 'design',
    description: '负责界面、视觉与交互一致性。',
    background: '熟悉设计系统、排版与可访问性。', responsibilities: '设计页面、维护 Token、检查还原度。',
    principles: '层级清晰、克制装饰。', style: '以视觉差异表说明。', constraints: '不牺牲可读性换效果。', systemPrompt: '',
  },
  {
    id: 'data', name: '数据分析师', icon: '▥', role: '数据分析师', category: 'data',
    description: '负责指标、分析与数据解释。',
    background: '熟悉统计、SQL 与可视化。', responsibilities: '定义指标、分析趋势、给出结论。',
    principles: '区分相关与因果。', style: '数据先行。', constraints: '无证据不下结论。', systemPrompt: '',
  },
]

const AVATARS = ['🤖', '🧠', '🛠️', '🎨', '📊', '🛡️']
const TABS = ['基础信息', '人设与提示词', '技能', '运行环境', '高级设置'] as const

function templateValues(template: AgentTemplate): Partial<AgentFormValues> {
  return {
    name: template.name,
    role: template.role,
    category: template.category,
    description: template.description,
    background: template.background,
    responsibilities: template.responsibilities,
    principles: template.principles,
    style: template.style,
    constraints: template.constraints,
    systemPrompt: template.systemPrompt,
    avatar: template.icon,
    visibility: 'project',
    runtimeProfileIds: [],
    primaryRuntimeProfileId: null,
    skillIds: [],
    files: false,
    shell: false,
    network: false,
  }
}

export function AgentStudioModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const agents = useAgentDefinitions()
  const skills = useSkills()
  const runtimes = useRuntimeProfiles()
  const [form] = Form.useForm<AgentFormValues>()
  const values = Form.useWatch([], form) as AgentFormValues | undefined
  const importRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<AgentDefinition | null>(null)
  const [activeTab, setActiveTab] = useState(0)
  const [templateId, setTemplateId] = useState<string | null>('general')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [runOpen, setRunOpen] = useState(false)
  const [runPrompt, setRunPrompt] = useState('')
  const [runOutput, setRunOutput] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const reset = (template: AgentTemplate | null = TEMPLATES[0]!): void => {
    setEditing(null)
    setActiveTab(0)
    setTemplateId(template?.id ?? null)
    form.resetFields()
    form.setFieldsValue(
      template
        ? templateValues(template)
        : {
            name: '', role: '', description: '', category: 'general', avatar: '🤖', visibility: 'project',
            runtimeProfileIds: [], primaryRuntimeProfileId: null, skillIds: [], files: false, shell: false, network: false,
          },
    )
  }

  useEffect(() => {
    if (!open) return
    setEditing(null)
    setActiveTab(0)
    setTemplateId('general')
    form.resetFields()
    form.setFieldsValue(templateValues(TEMPLATES[0]!))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void window.projectos.runtimeProfiles
      .detect()
      .then(() => (cancelled ? undefined : queryClient.invalidateQueries({ queryKey: ['runtime-profiles'] })))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open, queryClient])

  const edit = (agent: AgentDefinition): void => {
    setEditing(agent)
    setTemplateId(null)
    setActiveTab(0)
    form.setFieldsValue({
      name: agent.name,
      role: agent.role,
      description: agent.description,
      category: agent.category,
      avatar: agent.avatar || '🤖',
      visibility: agent.visibility,
      background: agent.persona.background,
      responsibilities: agent.persona.responsibilities,
      principles: agent.persona.principles,
      style: agent.persona.style,
      constraints: agent.persona.constraints,
      systemPrompt: agent.persona.systemPrompt,
      runtimeProfileIds: agent.runtimeProfileIds,
      primaryRuntimeProfileId: agent.primaryRuntimeProfileId,
      skillIds: agent.skills.map((skill) => skill.skillId),
      files: agent.permissions.files,
      shell: agent.permissions.shell,
      network: agent.permissions.network,
    })
  }

  const filteredTemplates = useMemo(() => {
    const query = search.trim().toLowerCase()
    return query ? TEMPLATES.filter((item) => `${item.name} ${item.role}`.toLowerCase().includes(query)) : TEMPLATES
  }, [search])

  const filteredAgents = useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = agents.data?.agents ?? []
    return query ? list.filter((item) => `${item.name} ${item.role}`.toLowerCase().includes(query)) : list
  }, [agents.data, search])

  const selectedRuntime = runtimes.data?.profiles.find((item) => item.id === values?.primaryRuntimeProfileId)
  const selectedSkills = (skills.data?.skills ?? []).filter((skill) => (values?.skillIds ?? []).includes(skill.id))

  const save = async (): Promise<void> => {
    const formValues = await form.validateFields()
    setSaving(true)
    try {
      await window.projectos.agentDefinitions.upsert({
        id: editing?.id,
        name: formValues.name,
        role: formValues.role,
        description: formValues.description ?? '',
        category: formValues.category ?? 'general',
        avatar: formValues.avatar ?? '🤖',
        visibility: formValues.visibility ?? 'project',
        persona: {
          role: formValues.role,
          background: formValues.background ?? '',
          responsibilities: formValues.responsibilities ?? '',
          principles: formValues.principles ?? '',
          style: formValues.style ?? '',
          constraints: formValues.constraints ?? '',
          systemPrompt: formValues.systemPrompt ?? '',
        },
        skillIds: formValues.skillIds ?? [],
        runtimeProfileIds: formValues.primaryRuntimeProfileId ? [formValues.primaryRuntimeProfileId] : (formValues.runtimeProfileIds ?? []),
        primaryRuntimeProfileId: formValues.primaryRuntimeProfileId ?? null,
        modelRef: editing?.modelRef ?? null,
        permissions: {
          tools: editing?.permissions.tools ?? [],
          files: Boolean(formValues.files),
          shell: Boolean(formValues.shell),
          network: Boolean(formValues.network),
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['agent-definitions'] })
      message.success(editing ? 'Agent 已更新' : 'Agent 已创建')
      onClose()
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const exportAgent = async (): Promise<void> => {
    if (!editing) return
    try {
      const result = await window.projectos.agentDefinitions.export(editing.id)
      const blob = new Blob([result.json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.filename
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const importAgent = async (file: File): Promise<void> => {
    try {
      const json = await file.text()
      await window.projectos.agentDefinitions.import(json)
      await queryClient.invalidateQueries({ queryKey: ['agent-definitions'] })
      message.success('Agent 已导入')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const runAgent = async (): Promise<void> => {
    if (!editing) return
    setRunning(true)
    setRunOutput(null)
    try {
      const result = await window.projectos.agentDefinitions.run({ agentId: editing.id, projectId, prompt: runPrompt })
      setRunOutput(`[${result.status}] ${result.output}`)
    } catch (error) {
      setRunOutput(errorMessage(error))
    } finally {
      setRunning(false)
    }
  }

  const preview = async (id: string): Promise<void> => {
    try {
      const result = await window.projectos.agentDefinitions.preview(id)
      modal.info({ title: '生效提示词预览', width: 720, content: <pre className="po-agent-preview">{result.prompt}</pre> })
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const remove = (agent: AgentDefinition): void => {
    modal.confirm({
      title: `删除 ${agent.name}？`,
      content: '已有任务或会话引用的 Agent 不会被删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await window.projectos.agentDefinitions.delete(agent.id)
          await queryClient.invalidateQueries({ queryKey: ['agent-definitions'] })
          if (editing?.id === agent.id) reset(null)
        } catch (error) {
          message.error(errorMessage(error))
        }
      },
    })
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(1480px, 94vw)"
      className="v16-agent-studio-modal"
      destroyOnHidden
      closable
    >
      <div className="v16-studio">
        <header className="v16-studio-head">
          <div>
            <h2>{editing ? `编辑 ${editing.name}` : '创建 Agent'}</h2>
            <p>Agent Studio</p>
          </div>
          <div className="v16-studio-head-actions">
            <Button icon={<ImportOutlined />} onClick={() => importRef.current?.click()}>导入</Button>
            {editing ? <Button icon={<ExportOutlined />} onClick={() => void exportAgent()}>导出</Button> : null}
            {editing ? <Button icon={<EyeOutlined />} onClick={() => void preview(editing.id)}>提示词</Button> : null}
            {editing && editing.runtimeProfileIds.length ? (
              <Button icon={<ThunderboltOutlined />} onClick={() => { setRunOpen(true); setRunPrompt(''); setRunOutput(null) }}>运行测试</Button>
            ) : null}
          </div>
        </header>

        <div className="v16-studio-body">
          <aside className="v16-studio-left">
            <label className="v16-studio-search">
              <SearchOutlined />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索模板或 Agent" />
            </label>
            <div className="v16-studio-left-scroll">
              <div className="v16-studio-group-title">推荐模板</div>
              {filteredTemplates.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  className={`v16-template-item ${templateId === template.id ? 'is-active' : ''}`}
                  onClick={() => { setTemplateId(template.id); form.setFieldsValue(templateValues(template)); setEditing(null); setActiveTab(0) }}
                >
                  <span className="v16-template-icon">{template.icon}</span>
                  <span><strong>{template.name}</strong><small>{template.description}</small></span>
                </button>
              ))}
              <button type="button" className="v16-template-item is-blank" onClick={() => reset(null)}>
                <span className="v16-template-icon"><PlusOutlined /></span>
                <span><strong>从空白创建</strong><small>不绑定任何预设</small></span>
              </button>
              {(agents.data?.agents ?? []).length > 0 ? (
                <>
                  <div className="v16-studio-group-title">已有 Agent · {filteredAgents.length}</div>
                  {filteredAgents.map((agent) => (
                    <button
                      type="button"
                      key={agent.id}
                      className={`v16-template-item ${editing?.id === agent.id ? 'is-active' : ''}`}
                      onClick={() => edit(agent)}
                    >
                      <span className="v16-template-icon">{agent.avatar || agent.name.slice(0, 1)}</span>
                      <span><strong>{agent.name}</strong><small>{agent.role} · v{agent.currentVersion}</small></span>
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          </aside>

          <section className="v16-studio-center">
            <nav className="v16-studio-tabs">
              {TABS.map((tab, index) => (
                <button
                  type="button"
                  key={tab}
                  className={activeTab === index ? 'is-active' : ''}
                  onClick={() => setActiveTab(index)}
                >
                  {tab}
                </button>
              ))}
            </nav>

            <Form form={form} layout="vertical" className="v16-studio-form" preserve>
              <div className="v16-basic-tab" hidden={activeTab !== 0}>

                  <div className="v16-avatar-name-row">
                    <div className="v16-avatar-picker">
                      <div className="v16-avatar-large">{values?.avatar || '🤖'}</div>
                      <div className="v16-avatar-options">
                        {AVATARS.map((avatar) => (
                          <button type="button" key={avatar} onClick={() => form.setFieldValue('avatar', avatar)}>{avatar}</button>
                        ))}
                      </div>
                    </div>
                    <div className="v16-basic-fields">
                      <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入 Agent 名称' }]}>
                        <Input placeholder="例如：后端开发专家" />
                      </Form.Item>
                      <Form.Item name="role" label="角色" rules={[{ required: true, message: '请输入角色' }]}>
                        <Input placeholder="例如：高级后端工程师" />
                      </Form.Item>
                    </div>
                  </div>
                  <div className="v16-two-columns">
                    <Form.Item name="category" label="分类">
                      <Select options={[
                        { value: 'general', label: '通用' },
                        { value: 'code', label: '代码开发' },
                        { value: 'architecture', label: '架构' },
                        { value: 'quality', label: '测试' },
                        { value: 'product', label: '产品' },
                        { value: 'design', label: '设计' },
                        { value: 'data', label: '数据' },
                        { value: 'ops', label: '运维' },
                      ]} />
                    </Form.Item>
                    <Form.Item name="visibility" label="可见性">
                      <Select options={[
                        { value: 'private', label: '仅自己可见' },
                        { value: 'project', label: '项目内可见' },
                        { value: 'space', label: '空间内可见' },
                        { value: 'global', label: '全局可见' },
                      ]} />
                    </Form.Item>
                  </div>
                  <Form.Item name="description" label="简介">
                    <Input.TextArea rows={3} maxLength={200} showCount placeholder="一句话描述这个 Agent 的用途" />
                  </Form.Item>
                  <div className="v16-readonly-field">
                    <span>所属空间</span>
                    <strong>默认空间</strong>
                  </div>
              </div>

              <div className="v16-persona-tab" hidden={activeTab !== 1}>

                  <div className="v16-two-columns">
                    <Form.Item name="background" label="专业背景"><Input.TextArea rows={3} /></Form.Item>
                    <Form.Item name="responsibilities" label="核心职责"><Input.TextArea rows={3} /></Form.Item>
                  </div>
                  <div className="v16-two-columns">
                    <Form.Item name="principles" label="工作原则"><Input.TextArea rows={3} /></Form.Item>
                    <Form.Item name="style" label="沟通风格"><Input.TextArea rows={3} /></Form.Item>
                  </div>
                  <Form.Item name="constraints" label="行为限制"><Input.TextArea rows={2} /></Form.Item>
                  <Form.Item name="systemPrompt" label="高级 System Prompt">
                    <Input.TextArea rows={8} className="v16-mono-input" placeholder="留空则仅使用结构化人设" />
                  </Form.Item>
                  {values?.systemPrompt ? <div className="v16-inline-note">自定义 Prompt 将与结构化人设一起编译。</div> : null}
              </div>

              <div className="v16-skills-tab" hidden={activeTab !== 2}>

                  <div className="v16-tab-heading">
                    <div><strong>Skills</strong><span>流程知识与工作提示，不等于工具权限。</span></div>
                    <span>{selectedSkills.length} 个已选择</span>
                  </div>
                  <div className="v16-skill-grid">
                    {(skills.data?.skills ?? []).map((skill) => {
                      const selected = (values?.skillIds ?? []).includes(skill.id)
                      return (
                        <button
                          type="button"
                          key={skill.id}
                          className={`v16-skill-card ${selected ? 'is-selected' : ''}`}
                          onClick={() => {
                            const next = selected
                              ? (values?.skillIds ?? []).filter((id) => id !== skill.id)
                              : [...(values?.skillIds ?? []), skill.id]
                            form.setFieldValue('skillIds', next)
                          }}
                        >
                          <span className="v16-skill-check">{selected ? <CheckOutlined /> : null}</span>
                          <strong>{skill.name}</strong>
                          <p>{skill.description || '无描述'}</p>
                          <div><Tag>{`v${skill.version}`}</Tag><span>{skill.source}</span></div>
                        </button>
                      )
                    })}
                  </div>
                  {(skills.data?.skills ?? []).length === 0 ? (
                    <div className="v16-empty-inline">尚未导入 Skill。可在设置或 API 中导入 SKILL.md。</div>
                  ) : null}
              </div>

              <div className="v16-runtime-tab" hidden={activeTab !== 3}>

                  <div className="v16-tab-heading">
                    <div><strong>运行环境</strong><span>Runtime 负责执行；模型 Provider 只提供模型。</span></div>
                    <span>{runtimes.data?.profiles.length ?? 0} 个已注册</span>
                  </div>
                  <div className="v16-runtime-grid">
                    {(runtimes.data?.profiles ?? []).map((profile) => {
                      const selected = values?.primaryRuntimeProfileId === profile.id
                      return (
                        <button
                          type="button"
                          key={profile.id}
                          className={`v16-runtime-card ${selected ? 'is-selected' : ''}`}
                          onClick={() => {
                            form.setFieldValue('primaryRuntimeProfileId', profile.id)
                            form.setFieldValue('runtimeProfileIds', [profile.id])
                          }}
                          disabled={profile.status !== 'available'}
                        >
                          <div className="v16-runtime-top">
                            <span className="v16-runtime-icon"><ThunderboltOutlined /></span>
                            <span className={`po-pill is-${profile.status === 'available' ? 'success' : 'neutral'}`}>
                              {profile.status === 'available' ? '可用' : profile.status}
                            </span>
                          </div>
                          <strong>{profile.name}</strong>
                          <p>{profile.protocol.toUpperCase()} {profile.version ? `· ${profile.version}` : ''}</p>
                          <div className="v16-runtime-tags">
                            {profile.capabilities.skills ? <Tag>skills</Tag> : null}
                            {profile.capabilities.permissions ? <Tag>permissions</Tag> : null}
                            {profile.capabilities.worktree ? <Tag>worktree</Tag> : null}
                          </div>
                          {selected ? <span className="v16-runtime-selected"><CheckOutlined /> 已选择</span> : null}
                        </button>
                      )
                    })}
                  </div>
                  <Form.Item name="primaryRuntimeProfileId" hidden><Input /></Form.Item>
                  <Form.Item name="runtimeProfileIds" hidden><Input /></Form.Item>
                  {selectedRuntime ? (
                    <div className="v16-runtime-detail">
                      <div><span>协议</span><strong>{selectedRuntime.protocol}</strong></div>
                      <div><span>可执行文件</span><strong>{selectedRuntime.executable ?? '未配置'}</strong></div>
                      <div><span>状态</span><strong>{selectedRuntime.status}</strong></div>
                      <div><span>来源</span><strong>{selectedRuntime.source}</strong></div>
                    </div>
                  ) : null}
              </div>

              <div className="v16-advanced-tab" hidden={activeTab !== 4}>

                  <div className="v16-tab-heading"><div><strong>工具与权限</strong><span>权限在真实执行时由后端校验。</span></div></div>
                  <div className="v16-permission-list">
                    <label><span><strong>文件写入</strong><small>允许修改项目工作区文件</small></span><Form.Item name="files" valuePropName="checked" noStyle><Switch /></Form.Item></label>
                    <label><span><strong>Shell 执行</strong><small>允许运行本地命令与测试</small></span><Form.Item name="shell" valuePropName="checked" noStyle><Switch /></Form.Item></label>
                    <label><span><strong>网络访问</strong><small>允许访问外部服务</small></span><Form.Item name="network" valuePropName="checked" noStyle><Switch /></Form.Item></label>
                  </div>
                  <div className="v16-advanced-note">
                    <SafetyCertificateOutlined />
                    <span>未授权的工具调用会被拒绝。高风险操作仍需项目审批。</span>
                  </div>
                  {editing ? (
                    <div className="v16-danger-row">
                      <div><strong>删除 Agent</strong><span>已被引用的 Agent 不会被删除。</span></div>
                      <Button danger icon={<DeleteOutlined />} onClick={() => remove(editing)}>删除</Button>
                    </div>
                  ) : null}
              </div>
            </Form>

            <footer className="v16-studio-footer">
              <div>
                {editing ? <Button onClick={() => void exportAgent()}>导出配置</Button> : null}
              </div>
              <div>
                <Button onClick={onClose}>取消</Button>
                {activeTab > 0 ? <Button icon={<LeftOutlined />} onClick={() => setActiveTab((tab) => tab - 1)}>上一步</Button> : null}
                {activeTab < TABS.length - 1 ? (
                  <Button type="primary" onClick={() => setActiveTab((tab) => Math.min(TABS.length - 1, tab + 1))}>
                    下一步 <RightOutlined />
                  </Button>
                ) : (
                  <Button type="primary" loading={saving} onClick={() => void save()}>
                    {editing ? '保存修改' : '创建 Agent'}
                  </Button>
                )}
              </div>
            </footer>
          </section>

          <aside className="v16-studio-preview">
            <div className="v16-preview-card">
              <div className="v16-preview-avatar">{values?.avatar || '🤖'}</div>
              <h3>{values?.name || '未命名 Agent'}</h3>
              <p className="v16-preview-role">{values?.role || '未配置角色'}</p>
              <p className="v16-preview-desc">{values?.description || '未配置简介'}</p>
              <div className="v16-preview-tags">
                <Tag>{values?.category || 'general'}</Tag>
                <Tag>{values?.visibility === 'private' ? '仅自己可见' : '项目内可见'}</Tag>
              </div>
              <div className="v16-preview-list">
                <div><span>空间</span><strong>默认空间</strong></div>
                <div><span>运行环境</span><strong>{selectedRuntime?.name ?? '未配置'}</strong></div>
                <div><span>Skills</span><strong>{selectedSkills.length} 个已选择</strong></div>
                <div><span>权限</span><strong>{[values?.files && '文件', values?.shell && 'Shell', values?.network && '网络'].filter(Boolean).join(' · ') || '未授权'}</strong></div>
                <div><span>配置状态</span><strong>{editing ? `v${editing.currentVersion}` : '待创建'}</strong></div>
              </div>
            </div>
            <div className="v16-preview-check">
              <strong>配置检查</strong>
              <div className={selectedRuntime ? 'is-ok' : ''}><ThunderboltOutlined /><span><strong>Runtime</strong><small>{selectedRuntime ? '已选择' : '未配置'}</small></span></div>
              <div className={values?.shell || values?.files || values?.network ? 'is-warn' : ''}><SafetyCertificateOutlined /><span><strong>权限策略</strong><small>{values?.shell || values?.files || values?.network ? '已授予部分权限' : '默认受控'}</small></span></div>
              <div className={selectedSkills.length > 0 ? 'is-ok' : ''}><CheckOutlined /><span><strong>Skills</strong><small>{selectedSkills.length > 0 ? `${selectedSkills.length} 个` : '未配置'}</small></span></div>
            </div>
          </aside>
        </div>

        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importAgent(file)
            event.target.value = ''
          }}
        />
      </div>

      <Modal open={runOpen} title={`运行 ${editing?.name ?? ''}`} onCancel={() => setRunOpen(false)} onOk={() => void runAgent()} okText="运行" confirmLoading={running} width={680} destroyOnHidden>
        <Input.TextArea rows={3} value={runPrompt} onChange={(event) => setRunPrompt(event.target.value)} placeholder="输入测试任务" />
        {runOutput ? <pre className="po-agent-preview">{runOutput}</pre> : null}
      </Modal>
    </Modal>
  )
}


