import { useState, type ReactElement } from 'react'
import { Bot, Check, ChevronDown, Cpu, Pencil, ShieldCheck, Sparkles } from 'lucide-react'
import {
  InspectorShell,
  InspectorSection,
  OverlayFooter,
  OverlayHeader,
  OverlayScrollArea,
  PopoverShell,
} from '../../next-ui/overlay/overlay-shell'

export type LabAgent = {
  id: string
  name: string
  role: string
  description: string
  model: string
  runtime: string
  status: 'active' | 'disabled' | 'archived'
  capabilities: string[]
  permissions: { files: boolean; shell: boolean; network: boolean }
  skills: string[]
}

export const defaultAgent: LabAgent = {
  id: 'agent-nova',
  name: 'Nova',
  role: '代码审查员',
  description: '审查计划依赖与实现风险，给出可验证的修改建议。',
  model: 'Claude Sonnet · 默认连接',
  runtime: 'Native Runtime',
  status: 'active',
  capabilities: ['代码审查', '依赖分析', '可访问性', '计划校验'],
  permissions: { files: true, shell: false, network: false },
  skills: ['react-best-practices', 'plan-review'],
}

const MODELS = ['Claude Sonnet · 默认连接', 'GPT-5 · 备用连接', '本地模型 · 离线']
const RUNTIMES = ['Native Runtime', 'Claude Code CLI', 'ACP Runtime']

export function AgentInspector({
  agent,
  theme,
  source,
  onSave,
  onClose,
}: {
  agent: LabAgent
  theme: 'light' | 'dark'
  source: 'demo' | 'runtime'
  onSave: (agent: LabAgent) => void
  onClose: () => void
}): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(agent)
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(agent)
  const patch = (value: Partial<LabAgent>): void => setDraft((current) => ({ ...current, ...value }))
  const start = (): void => { setDraft(agent); setEditing(true) }
  const cancel = (): void => { setDraft(agent); setEditing(false) }
  const save = (): void => { if (!draft.name.trim()) return; onSave(draft); setEditing(false) }

  return (
    <InspectorShell
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      dirty={dirty}
      onDiscard={() => { setDraft(agent); setEditing(false) }}
      ariaLabel="Agent 配置"
      width={500}
      theme={theme}
      skin="projectos"
      testId="design-lab-agent-inspector"
    >
      <OverlayHeader
        eyebrow={source === 'runtime' ? 'AGENT CONFIG · RUNTIME' : 'AGENT CONFIG · LOCAL SAMPLE'}
        title={editing ? draft.name : agent.name}
        closeLabel="关闭 Agent 配置"
        meta={<><span className="pdl-inspector-status is-ready"><Bot size={11} />{agent.role}</span><span>{agent.runtime}</span><span>{agent.model}</span></>}
      />
      <OverlayScrollArea className="pdl-inspector-scroll">
        {!editing ? (
          <div className="pdl-inspector-view">
            <InspectorSection title="身份">
              <p className="pdl-inspector-description">{agent.description}</p>
            </InspectorSection>
            <InspectorSection title="模型与 Runtime" actions={<span>{agent.status === 'active' ? '启用' : agent.status}</span>}>
              <div className="pdl-agent-facts">
                <span><Cpu size={13} />{agent.runtime}</span>
                <span><Sparkles size={13} />{agent.model}</span>
              </div>
            </InspectorSection>
            <InspectorSection title="能力" actions={<span>{agent.capabilities.length} 项</span>}>
              <div className="pdl-chip-row">{agent.capabilities.map((capability) => <span key={capability} className="pdl-chip is-static">{capability}</span>)}</div>
            </InspectorSection>
            <InspectorSection title="权限" actions={<span><ShieldCheck size={12} />受控</span>}>
              <div className="pdl-agent-permissions">
                <span className={agent.permissions.files ? 'is-on' : ''}>文件 {agent.permissions.files ? '允许' : '禁止'}</span>
                <span className={agent.permissions.shell ? 'is-on' : ''}>Shell {agent.permissions.shell ? '允许' : '禁止'}</span>
                <span className={agent.permissions.network ? 'is-on' : ''}>网络 {agent.permissions.network ? '允许' : '禁止'}</span>
              </div>
            </InspectorSection>
            <InspectorSection title="Skills"><div className="pdl-chip-row">{agent.skills.map((skill) => <span className="pdl-chip is-static" key={skill}>{skill}</span>)}</div></InspectorSection>
          </div>
        ) : (
          <div className="pdl-inspector-edit">
            <InspectorSection title="身份">
              <input className="pdl-title-input" aria-label="Agent 名称" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
              <input className="pdl-detail-input" aria-label="Agent 角色" value={draft.role} onChange={(event) => patch({ role: event.target.value })} />
              <textarea className="pdl-desc-input" aria-label="Agent 描述" value={draft.description} rows={3} onChange={(event) => patch({ description: event.target.value })} />
            </InspectorSection>
            <InspectorSection title="模型与 Runtime">
              <div className="pdl-agent-selects">
                <PopoverShell
                  side="bottom"
                  align="start"
                  trigger={<button type="button" className="pdl-select-like" aria-label="选择模型"><span><Sparkles size={13} />{draft.model}</span><ChevronDown size={14} /></button>}
                >
                  <div className="pdl-popover-list">
                    {MODELS.map((model) => <button type="button" key={model} className={draft.model === model ? 'is-active' : ''} onClick={() => patch({ model })}>{model}{draft.model === model ? <Check size={13} /> : null}</button>)}
                  </div>
                </PopoverShell>
                <label className="pdl-field-label">Runtime<select className="pdl-select-like" value={draft.runtime} onChange={(event) => patch({ runtime: event.target.value })}>{RUNTIMES.map((runtime) => <option key={runtime}>{runtime}</option>)}</select></label>
              </div>
            </InspectorSection>
            <InspectorSection title="能力">
              <div className="pdl-chip-row">
                {agent.capabilities.map((capability) => {
                  const active = draft.capabilities.includes(capability)
                  return <button type="button" key={capability} className={`pdl-chip${active ? ' is-active' : ''}`} onClick={() => patch({ capabilities: active ? draft.capabilities.filter((item) => item !== capability) : [...draft.capabilities, capability] })}>{capability}</button>
                })}
              </div>
            </InspectorSection>
            <InspectorSection title="权限">
              <div className="pdl-agent-permissions">
                {(['files', 'shell', 'network'] as const).map((key) => (
                  <button type="button" key={key} className={draft.permissions[key] ? 'is-on' : ''} onClick={() => patch({ permissions: { ...draft.permissions, [key]: !draft.permissions[key] } })}>
                    {key === 'files' ? '文件' : key === 'shell' ? 'Shell' : '网络'} {draft.permissions[key] ? '允许' : '禁止'}
                  </button>
                ))}
              </div>
            </InspectorSection>
            <InspectorSection title="Skills"><div className="pdl-chip-row">{agent.skills.map((skill) => <span className="pdl-chip is-static" key={skill}>{skill}</span>)}</div></InspectorSection>
          </div>
        )}
      </OverlayScrollArea>
      <OverlayFooter meta={source === 'runtime' ? 'Runtime 只读数据 · 保存不写入业务库' : '本地样板 · 不写入业务库'}>
        {editing ? (
          <>
            <button type="button" className="pui-overlay-button pui-overlay-button-quiet" onClick={cancel}>取消</button>
            <button type="button" className="pui-overlay-button pui-overlay-button-primary" disabled={!draft.name.trim()} onClick={save}><Check size={13} />保存</button>
          </>
        ) : (
          <button type="button" className="pui-overlay-button pui-overlay-button-primary" onClick={start}><Pencil size={13} />编辑配置</button>
        )}
      </OverlayFooter>
    </InspectorShell>
  )
}


