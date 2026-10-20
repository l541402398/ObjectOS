import { useEffect, useRef, useState } from 'react'
import { App, Button, Form, Input, Modal, Select, Switch, Tag } from 'antd'
import { DeleteOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import type { AgentDefinition } from '@projectos/contracts'
import { useAgentDefinitions, useRuntimeProfiles, useSkills } from '../lib/queries'
import { errorMessage } from '../lib/errors'

interface AgentFormValues {
  name: string
  role: string
  description?: string
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

export function AgentStudioModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const agents = useAgentDefinitions()
  const skills = useSkills()
  const runtimes = useRuntimeProfiles()
  const [form] = Form.useForm<AgentFormValues>()
  const importRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<AgentDefinition | null>(null)
  const [saving, setSaving] = useState(false)
  const [runOpen, setRunOpen] = useState(false)
  const [runPrompt, setRunPrompt] = useState("")
  const [runOutput, setRunOutput] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const reset = (): void => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ runtimeProfileIds: [], skillIds: [], primaryRuntimeProfileId: null })
  }

  useEffect(() => {
    if (!open) return
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ runtimeProfileIds: [], skillIds: [], primaryRuntimeProfileId: null })
  }, [open, form])

  const edit = (agent: AgentDefinition): void => {
    setEditing(agent)
    form.setFieldsValue({
      name: agent.name,
      role: agent.role,
      description: agent.description,
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

  const save = async (): Promise<void> => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await window.projectos.agentDefinitions.upsert({
        id: editing?.id,
        name: values.name,
        role: values.role,
        description: values.description ?? '',
        category: editing?.category ?? 'general',
        avatar: editing?.avatar ?? '',
        visibility: editing?.visibility ?? 'project',
        persona: {
          role: values.role,
          background: values.background ?? '',
          responsibilities: values.responsibilities ?? '',
          principles: values.principles ?? '',
          style: values.style ?? '',
          constraints: values.constraints ?? '',
          systemPrompt: values.systemPrompt ?? '',
        },
        skillIds: values.skillIds ?? [],
        runtimeProfileIds: values.runtimeProfileIds ?? [],
        primaryRuntimeProfileId: values.primaryRuntimeProfileId ?? null,
        modelRef: editing?.modelRef ?? null,
        permissions: {
          tools: editing?.permissions.tools ?? [],
          files: Boolean(values.files),
          shell: Boolean(values.shell),
          network: Boolean(values.network),
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['agent-definitions'] })
      message.success(editing ? 'Agent 已更新' : 'Agent 已创建')
      reset()
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
      setRunOutput("[" + result.status + "] " + result.output)
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
          if (editing?.id === agent.id) reset()
        } catch (error) {
          message.error(errorMessage(error))
        }
      },
    })
  }

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={1040} title="Agent 管理" destroyOnHidden>
      <div className="po-agent-studio">
        <aside className="po-agent-studio-list">
          <Button icon={<PlusOutlined />} onClick={reset} block>新建 Agent</Button>
          {(agents.data?.agents ?? []).map((agent) => (
            <button className={`po-agent-studio-item ${editing?.id === agent.id ? 'is-active' : ''}`} key={agent.id} onClick={() => edit(agent)}>
              <strong>{agent.name}</strong>
              <span>{agent.role}</span>
              <Tag>{`v${agent.currentVersion}`}</Tag>
            </button>
          ))}
        </aside>
        <Form form={form} layout="vertical" className="po-agent-studio-form" initialValues={{ runtimeProfileIds: [], skillIds: [] }}>
          <div className="po-form-grid">
            <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="role" label="角色" rules={[{ required: true }]}><Input /></Form.Item>
          </div>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="systemPrompt" label="System Prompt"><Input.TextArea rows={4} /></Form.Item>
          <div className="po-form-grid">
            <Form.Item name="background" label="背景"><Input.TextArea rows={2} /></Form.Item>
            <Form.Item name="responsibilities" label="职责"><Input.TextArea rows={2} /></Form.Item>
            <Form.Item name="principles" label="原则"><Input.TextArea rows={2} /></Form.Item>
            <Form.Item name="constraints" label="约束"><Input.TextArea rows={2} /></Form.Item>
          </div>
          <div className="po-form-grid">
            <Form.Item name="runtimeProfileIds" label="Runtime">
              <Select mode="multiple" options={(runtimes.data?.profiles ?? []).map((profile) => ({ value: profile.id, label: `${profile.name} · ${profile.status}` }))} />
            </Form.Item>
            <Form.Item name="primaryRuntimeProfileId" label="主 Runtime">
              <Select allowClear options={(runtimes.data?.profiles ?? []).map((profile) => ({ value: profile.id, label: profile.name }))} />
            </Form.Item>
            <Form.Item name="skillIds" label="Skills">
              <Select mode="multiple" options={(skills.data?.skills ?? []).map((skill) => ({ value: skill.id, label: `${skill.name}@${skill.version}` }))} />
            </Form.Item>
          </div>
          <div className="po-agent-permissions">
            <Form.Item name="files" label="文件写入" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="shell" label="Shell" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="network" label="网络" valuePropName="checked"><Switch /></Form.Item>
          </div>
          <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importAgent(file); event.target.value = '' }} />
          <div className="po-agent-studio-actions">
            {editing ? <Button icon={<EyeOutlined />} onClick={() => void preview(editing.id)}>预览提示词</Button> : null}
            {editing ? <Button onClick={() => void exportAgent()}>导出</Button> : null}
            <Button onClick={() => importRef.current?.click()}>导入</Button>
            {editing && editing.runtimeProfileIds.length ? <Button onClick={() => { setRunOpen(true); setRunPrompt(""); setRunOutput(null) }}>运行测试</Button> : null}
            {editing ? <Button danger icon={<DeleteOutlined />} onClick={() => remove(editing)}>删除</Button> : null}
            <Button type="primary" loading={saving} onClick={() => void save()}>{editing ? '保存版本' : '创建 Agent'}</Button>
          </div>
        </Form>
      </div>
      <Modal open={runOpen} title={"运行 " + (editing?.name ?? "")} onCancel={() => setRunOpen(false)} onOk={() => void runAgent()} okText="运行" confirmLoading={running} width={680} destroyOnHidden>
        <Input.TextArea rows={3} value={runPrompt} onChange={(event) => setRunPrompt(event.target.value)} placeholder="输入测试任务" />
        {runOutput ? <pre className="po-agent-preview">{runOutput}</pre> : null}
      </Modal>
    </Modal>
  )
}

