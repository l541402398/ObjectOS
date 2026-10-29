import { useState, type ReactNode } from 'react'
import { Bot, Download, Play, RefreshCw, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { AGENTS, MEMBERS, RUNS, type Tone } from '../data'
import { Badge, Button, Callout, EmptyState, PageHeader, SearchInput, Segmented, Surface } from '../ui'

export function AgentsScreen({ onToast }: { onToast: (message: string) => void }): ReactNode {
  const [tab, setTab] = useState<'agents' | 'skills' | 'mcp'>('agents')
  const counts = { agents: AGENTS.length, skills: 16, mcp: 5 }

  return (
    <div className="pw-screen pw-agents">
      <PageHeader
        title="组织资产"
        description="Agent、Skills 与 MCP 以不可变版本共享；项目绑定明确版本，Run 启动时冻结快照。"
        actions={
          <>
            <Button variant="ghost" icon={<Download size={14} />} onClick={() => onToast('原型说明：资产导出与版本下载属于 A2 范围')}>导出清单</Button>
            <Button variant="primary" icon={<ShieldCheck size={14} />} onClick={() => onToast('原型说明：组织资产发布审批属于 A2 范围，A0 不创建真实资产')}>
              发布资产
            </Button>
          </>
        }
      />

      <Surface
        title="资产目录"
        subtitle="权限由组织角色与项目绑定共同决定，不把 UI 权限当成后端授权"
        toolbar={
          <Segmented
            label="资产类型"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'agents', label: 'Agent', count: counts.agents },
              { value: 'skills', label: 'Skills', count: counts.skills },
              { value: 'mcp', label: 'MCP', count: counts.mcp },
            ]}
          />
        }
      >
        {tab !== 'agents' ? (
          <EmptyState
            icon={<Bot size={20} />}
            title={tab === 'skills' ? 'Skills 资产中心' : 'MCP / Tools 资产中心'}
            description="该分类在 A2 实装：版本、发布审批、项目绑定与撤销会与 Agent 资产使用同一套版本模型。"
            action={<Button variant="ghost" onClick={() => setTab('agents')}>返回 Agent 资产</Button>}
          />
        ) : (
          <div className="pw-table-wrap">
            <table className="pw-table">
              <thead>
                <tr><th>Agent</th><th>可见范围</th><th>版本</th><th>状态</th><th>最近 7 天 Run</th><th aria-label="操作" /></tr>
              </thead>
              <tbody>
                {AGENTS.map((agent) => (
                  <tr key={agent.id} className="pw-table-row" tabIndex={0} onClick={() => onToast(`原型说明：${agent.name} 的资产详情与授权属于 A2 范围`)}>
                    <td>
                      <div className="pw-agent-cell">
                        <span className="pw-agent-mark">{agent.name.slice(0, 1)}</span>
                        <div><strong>{agent.name}</strong><small>{agent.role}</small></div>
                      </div>
                    </td>
                    <td><Badge tone={agent.visibility === '全组织可用' ? 'ok' : 'accent'} dot>{agent.visibility}</Badge></td>
                    <td><span className="pw-mono">{agent.version}</span></td>
                    <td><Badge tone={agent.status === '运行中' ? 'accent' : 'ok'} dot>{agent.status}</Badge></td>
                    <td><span className="pw-num">{agent.runs}</span></td>
                    <td className="pw-row-arrow"><span className="pw-mono">查看 →</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      <div className="pw-two-col">
        <Surface title="发布与绑定" subtitle="编辑资产和发布资产是两个动作">
          <ul className="pw-check-list">
            <li><ShieldCheck size={13} /><span>草稿可编辑；发布后生成不可变版本与 checksum</span></li>
            <li><ShieldCheck size={13} /><span>项目绑定具体版本，而不是“跟随最新”</span></li>
            <li><ShieldCheck size={13} /><span>Run 启动时冻结 Agent、Skill hash、工具权限与模型绑定</span></li>
            <li><ShieldCheck size={13} /><span>撤销后新 Run 不能绑定，历史 Run 仍可追溯</span></li>
          </ul>
        </Surface>
        <Callout tone="accent" title="A0 边界">
          Agent 资产页面用于验证信息结构与版本语义。真实的组织资产创建、审批与绑定事务在 A2 实装，本页不写入数据库。
        </Callout>
      </div>
    </div>
  )
}

export function MembersScreen({ onToast }: { onToast: (message: string) => void }): ReactNode {
  const [query, setQuery] = useState('')
  const filtered = MEMBERS.filter((member) => [member.name, member.email, member.orgRole, member.projects].some((value) => value.toLowerCase().includes(query.toLowerCase())))

  return (
    <div className="pw-screen pw-members">
      <PageHeader
        title="成员与权限"
        description="账号可以加入多个组织，不同项目角色彼此独立；组织角色不会自动获得项目代码执行权。"
        actions={
          <>
            <Button variant="ghost" onClick={() => onToast('原型说明：权限矩阵导出属于 A1 范围')}>导出矩阵</Button>
            <Button variant="primary" icon={<UserPlus size={14} />} onClick={() => onToast('原型说明：邀请成员属于 A1 范围，A0 不发送真实邀请')}>
              邀请成员
            </Button>
          </>
        }
      />

      <div className="pw-members-grid">
        <Surface
          title="组织成员"
          subtitle={`${MEMBERS.length} 位成员 · 演示数据（demo.invalid）`}
          toolbar={<SearchInput value={query} onChange={setQuery} placeholder="搜索姓名、邮箱或角色" label="搜索成员" />}
        >
          <div className="pw-table-wrap">
            <table className="pw-table">
              <thead>
                <tr><th>成员</th><th>组织角色</th><th>项目访问</th><th>状态</th><th>执行权限</th><th aria-label="操作" /></tr>
              </thead>
              <tbody>
                {filtered.map((member) => (
                  <tr key={member.id} className="pw-table-row">
                    <td>
                      <div className="pw-agent-cell">
                        <span className="pw-person-avatar">{member.initial}</span>
                        <div><strong>{member.name}</strong><small>{member.email}</small></div>
                      </div>
                    </td>
                    <td><Badge tone={member.orgRole === 'Owner' ? 'accent' : 'neutral'} dot>{member.orgRole}</Badge></td>
                    <td><span className="pw-muted-cell">{member.projects}</span></td>
                    <td><Badge tone={member.status === '正常' ? 'ok' : 'warn'} dot>{member.status}</Badge></td>
                    <td><span className="pw-muted-cell">需 Worker 单独授权</span></td>
                    <td className="pw-row-actions">
                      <button type="button" onClick={() => onToast('原型说明：角色调整需要组织成员管理权限，A1 实装')}>管理权限</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 ? <EmptyState icon={<Users size={20} />} title="没有匹配的成员" description="调整搜索词后重试。" /> : null}
        </Surface>

        <aside className="pw-members-rail">
          <Surface title="权限来源" subtitle="为什么同一个按钮对两个人不同">
            <ul className="pw-role-list">
              <li><Badge tone="accent">组织角色</Badge><span>成员、设置、资产发布与组织级审计</span></li>
              <li><Badge tone="neutral">项目角色</Badge><span>需求、审批、审查与交付，按项目分别授予</span></li>
              <li><Badge tone="warn">执行授权</Badge><span>本机文件与命令必须由 Worker 持有专用授权</span></li>
            </ul>
          </Surface>
          <Callout tone="warn" title="人与机器分开">
            组织管理员不等于可以操作用户电脑。即使拥有全部组织权限，仍需项目成员在 Local Worker 上显式授权目录与工具范围。
          </Callout>
          <Surface title="成员状态" subtitle="演示数据">
            <div className="pw-asset-lines">
              <div><span>已激活</span><b className="pw-num">4</b></div>
              <div><span>受限</span><b className="pw-num">1</b></div>
              <div><span>邀请待接受</span><b className="pw-num">0</b></div>
            </div>
          </Surface>
        </aside>
      </div>
    </div>
  )
}

export function RunsScreen({ onToast }: { onToast: (message: string) => void }): ReactNode {
  const [filter, setFilter] = useState<'all' | 'running' | 'blocked'>('all')
  const [refreshedAt, setRefreshedAt] = useState('10:30')
  const visible = RUNS.filter((run) => {
    if (filter === 'running') return run.status === '运行中'
    if (filter === 'blocked') return run.status === '已阻塞'
    return true
  })

  return (
    <div className="pw-screen pw-runs">
      <PageHeader
        title="运行与审计"
        description="每项 Agent 执行、审批、Review 与交付都有可以核对的真实证据；状态来自事件，不来自进度条。"
        actions={
          <>
            <Button variant="ghost" icon={<RefreshCw size={13} />} onClick={() => { setRefreshedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })); onToast('已刷新演示事件（未请求真实运行时）') }}>
              刷新
            </Button>
            <Button variant="primary" icon={<Play size={13} />} onClick={() => onToast('原型说明：A0 不启动真实 Agent Run')}>打开实时视图</Button>
          </>
        }
      />

      <div className="pw-runs-stats">
        <div><span>运行中的任务</span><strong className="pw-num">03</strong><small>2 台 Local Worker 在线</small></div>
        <div><span>等待授权</span><strong className="pw-num">02</strong><small>命令与文件范围确认</small></div>
        <div><span>今日测试</span><strong className="pw-num">18</strong><small>16 PASS · 2 FAIL</small></div>
        <div><span>已验证交付</span><strong className="pw-num">09</strong><small>含合并后真实验证</small></div>
      </div>

      <Surface
        title="最近执行事件"
        subtitle={`演示事件 · 最后刷新 ${refreshedAt}`}
        toolbar={
          <Segmented
            label="筛选运行状态"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: '全部', count: RUNS.length },
              { value: 'running', label: '运行中', count: RUNS.filter((run) => run.status === '运行中').length },
              { value: 'blocked', label: '已阻塞', count: RUNS.filter((run) => run.status === '已阻塞').length },
            ]}
          />
        }
      >
        <ul className="pw-run-list">
          {visible.map((run) => (
            <li key={run.id} className="pw-run-item">
              <span className={`pw-run-icon is-${run.tone}`}><Play size={13} /></span>
              <span className="pw-run-id pw-mono">{run.id}</span>
              <div className="pw-run-copy">
                <strong>{run.action}</strong>
                <small>{run.requirementId} · {run.agent}</small>
              </div>
              <span className="pw-run-time pw-mono">{run.time}</span>
              <Badge tone={run.tone as Tone} dot>{run.status}</Badge>
            </li>
          ))}
        </ul>
        {visible.length === 0 ? <EmptyState icon={<Play size={20} />} title="没有匹配的运行" description="切换筛选查看全部运行事件。" /> : null}
      </Surface>

      <div className="pw-two-col">
        <Surface title="审计原则" subtitle="可复现，而不是看起来完成">
          <ul className="pw-check-list">
            <li><ShieldCheck size={13} /><span>状态来自真实事件：Run、ToolCall、Approval、GateEvaluation</span></li>
            <li><ShieldCheck size={13} /><span>测试证据绑定命令、退出码与当前内容快照</span></li>
            <li><ShieldCheck size={13} /><span>未知外部副作用不盲目重试，标记 needs_reconciliation</span></li>
          </ul>
        </Surface>
        <Callout tone="neutral" title="演示数据边界">
          运行列表是静态演示事件，不代表当前机器上真实执行过的 Run。真实证据页在 A1+ 接入 Runtime IPC。
        </Callout>
      </div>
    </div>
  )
}
