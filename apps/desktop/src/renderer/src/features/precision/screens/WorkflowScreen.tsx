import { useMemo, useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  BookOpen,
  Check,
  CircleAlert,
  FileText,
  GitMerge,
  GitPullRequest,
  LayoutList,
  Lock,
  Rocket,
  Save,
  ShieldCheck,
  TestTube2,
  UserRound,
  X,
} from 'lucide-react'
import type { XYPosition } from '@xyflow/react'
import {
  DEFAULT_WORKFLOW_EDGES,
  DEFAULT_WORKFLOW_NODES,
  WORKFLOW_KINDS,
  validateWorkflow,
  type WorkflowEdgeDef,
  type WorkflowKind,
  type WorkflowNodeDef,
} from '../data'
import { Badge, Button, Field, PageHeader, TextArea } from '../ui'
import { WorkflowCanvas } from '../workflow/WorkflowCanvas'
import { WorkflowInspector } from '../workflow/WorkflowInspector'

const PALETTE: { group: string; kind: WorkflowKind; title: string; role: string; icon: ReactNode }[] = [
  { group: '需求与设计', kind: 'agent_task', title: '需求文档', role: 'Product Agent', icon: <FileText size={15} /> },
  { group: '需求与设计', kind: 'agent_task', title: '技术设计', role: 'Architect', icon: <FileText size={15} /> },
  { group: '需求与设计', kind: 'document_gate', title: '文档审核', role: '项目 Maintainer', icon: <ShieldCheck size={15} /> },
  { group: '执行', kind: 'agent_task', title: 'Agent 任务', role: 'Developer', icon: <FileText size={15} /> },
  { group: '执行', kind: 'human_input', title: '人工确认', role: '项目 Maintainer', icon: <UserRound size={15} /> },
  { group: '质量门禁', kind: 'test_gate', title: '测试门禁', role: 'QA', icon: <TestTube2 size={15} /> },
  { group: '质量门禁', kind: 'review_gate', title: '代码审查', role: 'Reviewer', icon: <GitPullRequest size={15} /> },
  { group: '交付与知识', kind: 'knowledge_publish', title: '知识沉淀', role: 'Knowledge Agent', icon: <BookOpen size={15} /> },
  { group: '交付与知识', kind: 'delivery', title: '合并交付', role: '项目 Maintainer', icon: <GitMerge size={15} /> },
]

const VERSIONS = [
  { version: '2.3', status: '已发布', by: '周言', at: '10月28日 16:20', note: '增加代码审查强制门禁' },
  { version: '2.2', status: '已归档', by: '林可', at: '10月24日 11:05', note: '测试门禁绑定真实退出码' },
  { version: '2.1', status: '已归档', by: 'Sage', at: '10月20日 09:41', note: '初始标准研发流程' },
]

export function WorkflowScreen({ onToast }: { onToast: (message: string) => void }): ReactNode {
  const [nodes, setNodes] = useState<WorkflowNodeDef[]>(DEFAULT_WORKFLOW_NODES)
  const [edges, setEdges] = useState<WorkflowEdgeDef[]>(DEFAULT_WORKFLOW_EDGES)
  const [positions, setPositions] = useState<Record<string, XYPosition>>({})
  const [selectedId, setSelectedId] = useState<string | null>('n-design-review')
  const [layoutNonce, setLayoutNonce] = useState(0)
  const [fitNonce, setFitNonce] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [publishedVersion, setPublishedVersion] = useState('2.3')
  const [validationOpen, setValidationOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [publishNote, setPublishNote] = useState('')
  const nodeSeq = useRef(0)
  const edgeSeq = useRef(0)

  const issues = useMemo(() => validateWorkflow(nodes, edges), [nodes, edges])
  const errors = issues.filter((issue) => issue.severity === 'error')
  const selected = nodes.find((node) => node.id === selectedId) ?? null
  const gateCount = nodes.filter((node) => WORKFLOW_KINDS[node.kind].mandatory).length
  const nextVersion = (Number.parseFloat(publishedVersion) + 0.1).toFixed(1)

  const patchNode = (id: string, patch: Partial<WorkflowNodeDef>): void => {
    setNodes((current) => current.map((node) => (node.id === id ? { ...node, ...patch } : node)))
    setDirty(true)
  }

  const addNode = (kind: WorkflowKind, template: { title: string; role: string }, position?: XYPosition): void => {
    const meta = WORKFLOW_KINDS[kind]
    nodeSeq.current += 1
    const id = `n-${kind}-${nodeSeq.current}`
    const anchor = selectedId ? positions[selectedId] : undefined
    const next: WorkflowNodeDef = {
      id,
      kind,
      title: template.title,
      role: template.role,
      mandatory: meta.mandatory,
      outputs: template.title === '知识沉淀' ? [] : ['产物'],
      optional: !meta.mandatory,
      failurePolicy: 'block',
    }
    setNodes((current) => [...current, next])
    setPositions((current) => ({
      ...current,
      [id]: position ?? (anchor ? { x: anchor.x, y: anchor.y + 128 } : { x: 40, y: 40 + nodes.length * 14 }),
    }))
    setSelectedId(id)
    setDirty(true)
    if (!position) setLayoutNonce((value) => value + 1)
  }

  const deleteNode = (id: string): void => {
    setNodes((current) => current.filter((node) => node.id !== id))
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id))
    setSelectedId(null)
    setDirty(true)
    onToast('已从草稿移除节点；发布前校验会重新检查门禁完整性')
  }

  const connect = (source: string, target: string): void => {
    if (source === target) {
      onToast('不能把节点连接到自身')
      return
    }
    if (edges.some((edge) => edge.source === source && edge.target === target)) {
      onToast('这两个节点已经存在连线')
      return
    }
    edgeSeq.current += 1
    setEdges((current) => [...current, { id: `e-${edgeSeq.current}`, source, target }])
    setDirty(true)
  }

  const saveDraft = (): void => {
    if (!dirty) {
      onToast('没有未保存的修改')
      return
    }
    setDirty(false)
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    onToast('草稿已保存到原型会话（不写入组织服务器）')
  }

  const publish = (): void => {
    setPublishedVersion(nextVersion)
    setDirty(false)
    setSavedAt(null)
    setPublishOpen(false)
    setPublishNote('')
    onToast(`原型交互：已模拟发布 v${nextVersion}，未写入服务器`)
  }

  return (
    <div className="pw-screen pw-workflow">
      <PageHeader
        title="流程模板"
        description="组织强制门禁、条件步骤与 Agent 调度统一在一张真实 DAG 上。"
        actions={
          <>
            <Button variant="ghost" icon={<LayoutList size={14} />} onClick={() => setVersionsOpen(true)}>版本记录</Button>
            <Button variant="ghost" onClick={() => { setValidationOpen(true); onToast(errors.length ? `校验发现 ${errors.length} 个阻断问题` : '校验通过：门禁完整、无循环依赖') }}>
              校验
            </Button>
            <Button variant="ghost" icon={<Save size={14} />} onClick={saveDraft}>保存草稿</Button>
            <Button variant="primary" icon={<Rocket size={14} />} onClick={() => setPublishOpen(true)} disabled={errors.length > 0}>
              发布模板
            </Button>
          </>
        }
      />

      <div className="pw-flow-meta">
        <Badge tone="accent">标准研发流程 · v{publishedVersion}</Badge>
        {dirty ? <Badge tone="warn" dot>草稿 · 未保存</Badge> : savedAt ? <Badge tone="ok" dot>已保存 {savedAt}</Badge> : <Badge tone="neutral" dot>与已发布版本一致</Badge>}
        <span className="pw-flow-meta-count">{nodes.length} 个节点 · {edges.length} 条连线 · {gateCount} 个强制门禁</span>
        <span className="pw-flow-meta-note">更新不会影响已启动的流程实例</span>
      </div>

      <div className="pw-flow-layout" data-inspector={selected ? 'open' : 'closed'}>
        <aside className="pw-flow-palette" aria-label="节点库">
          <div className="pw-flow-palette-head">
            <h2>节点库</h2>
            <span>拖拽或点击添加</span>
          </div>
          <div className="pw-flow-palette-scroll">
            {['需求与设计', '执行', '质量门禁', '交付与知识'].map((group) => (
              <div className="pw-palette-group" key={group}>
                <div className="pw-palette-label">{group}</div>
                {PALETTE.filter((item) => item.group === group).map((item) => (
                  <button
                    key={`${group}-${item.title}`}
                    type="button"
                    className="pw-palette-item"
                    title={`${item.title} · ${WORKFLOW_KINDS[item.kind].label}（拖拽或点击添加）`}
                    draggable
                    onClick={() => addNode(item.kind, item)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('application/x-projectos-node', item.kind)
                      event.dataTransfer.effectAllowed = 'copy'
                    }}
                  >
                    <span className="pw-palette-icon" data-tone={WORKFLOW_KINDS[item.kind].tone}>{item.icon}</span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.role}</small>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="pw-flow-palette-foot">
            <Lock size={12} />
            <span>组织强制门禁已锁定：只能配置角色，不能移除。</span>
          </div>
        </aside>

        <div className="pw-flow-main">
          <div className={`pw-validation-bar${errors.length ? ' is-error' : ' is-ok'}`}>
            <span className="pw-validation-icon">
              {errors.length ? <CircleAlert size={14} /> : <Check size={14} />}
            </span>
            <strong>{errors.length ? `${errors.length} 个阻断问题` : '校验通过'}</strong>
            <span className="pw-validation-detail">
              {errors.length ? errors[0]?.message : '门禁完整 · 无循环依赖 · 交付节点存在'}
            </span>
            <button type="button" className="pw-validation-toggle" aria-expanded={validationOpen} onClick={() => setValidationOpen((open) => !open)}>
              {validationOpen ? '收起详情' : '校验详情'}
            </button>
          </div>

          {validationOpen ? (
            <div className="pw-validation-panel">
              {issues.length === 0 ? (
                <p className="pw-validation-pass"><Check size={13} /> 所有节点都有执行角色与输出契约，交付前存在测试与审查门禁。</p>
              ) : (
                <ul>
                  {issues.map((issue) => (
                    <li key={issue.id} data-severity={issue.severity}>
                      <span>{issue.severity === 'error' ? '阻断' : '提醒'}</span>
                      <p>{issue.message}</p>
                      {issue.nodeId ? <button type="button" onClick={() => setSelectedId(issue.nodeId ?? null)}>定位节点</button> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          <div className="pw-flow-stage">
            <span className="pw-flow-hint">点击节点打开配置</span>
            <div className="pw-canvas-tools" role="toolbar" aria-label="画布工具">
              <button type="button" title="按 ELK 分层算法重新整理节点布局" onClick={() => { setLayoutNonce((value) => value + 1); onToast('已按 ELK 分层算法重新整理布局') }}>
                <LayoutList size={12} /> 整理布局
              </button>
              <button type="button" title="缩放到完整流程" onClick={() => setFitNonce((value) => value + 1)}>
                适配画布
              </button>
            </div>
            <WorkflowCanvas
              nodes={nodes}
              edges={edges}
              positions={positions}
              selectedId={selectedId}
              layoutNonce={layoutNonce}
              fitNonce={fitNonce}
              onSelect={setSelectedId}
              onNodeMoved={(id, position) => setPositions((current) => ({ ...current, [id]: position }))}
              onLayout={setPositions}
              onDropNode={(kind, position) => {
                const template = PALETTE.find((item) => item.kind === kind)
                addNode(kind, { title: template?.title ?? WORKFLOW_KINDS[kind].label, role: template?.role ?? WORKFLOW_KINDS[kind].role }, position)
              }}
              onConnect={connect}
            />
          </div>
        </div>

        <WorkflowInspector
          node={selected}
          nodes={nodes}
          edges={edges}
          issues={issues}
          onUpdate={patchNode}
          onDelete={deleteNode}
          onRemoveEdge={(id) => { setEdges((current) => current.filter((edge) => edge.id !== id)); setDirty(true) }}
          onClose={() => setSelectedId(null)}
        />
      </div>

      <p className="pw-screen-footnote">
        <Badge tone="neutral">DEMO</Badge>
        流程设计为 A0 交互母版：节点编辑、连线、校验与发布版本状态都是真实交互，但不写入组织服务器，也不影响运行中的实例。
      </p>

      <Dialog.Root open={publishOpen} onOpenChange={setPublishOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="pw-dialog-overlay" />
          <Dialog.Content className="pw-dialog pw-publish-dialog" aria-describedby={undefined}>
            <div className="pw-dialog-head">
              <div>
                <span className="pw-dialog-kicker">发布流程模板</span>
                <Dialog.Title>标准研发流程 · v{nextVersion}</Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="pw-icon-btn" aria-label="关闭发布对话框"><X size={16} /></button>
              </Dialog.Close>
            </div>

            <div className="pw-publish-summary">
              <div><span>节点</span><strong className="pw-num">{nodes.length}</strong></div>
              <div><span>强制门禁</span><strong className="pw-num">{gateCount}</strong></div>
              <div><span>运行中实例</span><strong className="pw-num">0</strong></div>
              <div><span>阻断问题</span><strong className={`pw-num${errors.length ? ' is-danger' : ''}`}>{errors.length}</strong></div>
            </div>

            <ul className="pw-publish-checklist">
              <li className={errors.length ? 'is-bad' : 'is-good'}>
                {errors.length ? <CircleAlert size={14} /> : <Check size={14} />}
                流程校验：{errors.length ? `${errors.length} 个阻断问题必须先修复` : '通过（门禁完整、无循环依赖）'}
              </li>
              <li className="is-good"><Check size={14} />组织强制门禁：{gateCount} 个必需门禁全部保留</li>
              <li className="is-good"><Check size={14} />版本冻结：发布后已启动实例继续使用 v{publishedVersion}</li>
            </ul>

            <Field label="版本说明" hint="写入版本记录，便于审查人理解本次变更。">
              <TextArea
                value={publishNote}
                onChange={(event) => setPublishNote(event.target.value)}
                placeholder="例如：设计审核增加回滚证据要求"
                rows={3}
              />
            </Field>

            <p className="pw-dialog-note">
              原型交互：发布只更新当前原型会话的版本徽标，不写入组织服务器，不触发任何运行实例。
            </p>

            <div className="pw-dialog-actions">
              <Dialog.Close asChild><Button variant="ghost">取消</Button></Dialog.Close>
              <Button variant="primary" icon={<Rocket size={14} />} disabled={errors.length > 0} onClick={publish}>
                发布 v{nextVersion}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={versionsOpen} onOpenChange={setVersionsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="pw-dialog-overlay" />
          <Dialog.Content className="pw-dialog pw-versions-dialog" aria-describedby={undefined}>
            <div className="pw-dialog-head">
              <div>
                <span className="pw-dialog-kicker">版本记录</span>
                <Dialog.Title>标准研发流程</Dialog.Title>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="pw-icon-btn" aria-label="关闭版本记录"><X size={16} /></button>
              </Dialog.Close>
            </div>
            <ul className="pw-version-list">
              {VERSIONS.map((version) => (
                <li key={version.version}>
                  <span className="pw-version-tag pw-mono">v{version.version}</span>
                  <div>
                    <strong>{version.note}</strong>
                    <small>{version.by} · {version.at}</small>
                  </div>
                  <Badge tone={version.status === '已发布' ? 'ok' : 'neutral'} dot>{version.status}</Badge>
                </li>
              ))}
            </ul>
            <p className="pw-dialog-note">当前草稿基于 v{publishedVersion}。版本对比与回滚属于 A4 范围，此处只呈现版本信息结构。</p>
            <div className="pw-dialog-actions">
              <Dialog.Close asChild><Button variant="primary">关闭</Button></Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
