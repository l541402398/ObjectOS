import { useState, type ReactNode } from 'react'
import { ArrowRight, FolderGit2, GitBranch, Plus, ShieldCheck } from 'lucide-react'
import { PROJECTS, projectsForOrg, requirementsForProject, type ProjectSummary } from '../data'
import { ProjectRow } from '../components'
import type { PrecisionView } from '../navigation'
import { Badge, Button, Callout, EmptyState, PageHeader, Surface } from '../ui'

export function ProjectsScreen({
  orgId,
  onOpenProjectRequirements,
  onNavigate,
  onToast,
}: {
  orgId: string
  onOpenProjectRequirements: (project: ProjectSummary) => void
  onNavigate: (view: PrecisionView) => void
  onToast: (message: string) => void
}): ReactNode {
  const projects = projectsForOrg(orgId)
  const [scope, setScope] = useState<'all' | 'active'>('all')
  const visible = scope === 'active' ? projects.filter((project) => project.status === '进行中') : projects

  return (
    <div className="pw-screen pw-projects">
      <PageHeader
        title="组织项目"
        description="每个项目拥有独立的成员、访问授权、工作空间和需求列表；组织角色不会自动变成项目权限。"
        actions={
          <>
            <Button variant="ghost" onClick={() => setScope(scope === 'all' ? 'active' : 'all')} aria-pressed={scope === 'active'}>
              {scope === 'active' ? '显示全部' : '仅进行中'}
            </Button>
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              onClick={() => onToast('原型说明：项目创建向导与目录预检属于 A1/A3 范围，A0 不创建真实项目')}
            >
              新建项目
            </Button>
          </>
        }
      />

      <div className="pw-projects-grid">
        <div className="pw-projects-main">
          <Surface
            title="项目组合"
            subtitle={`${projects.length} 个项目 · ${requirementsForProject(projects[0]?.id ?? '').length + (projects[1] ? requirementsForProject(projects[1].id).length : 0)} 条需求`}
          >
            <div className="pw-project-list is-roomy">
              {visible.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  requirementCount={requirementsForProject(project.id).length}
                  onOpen={() => onOpenProjectRequirements(project)}
                />
              ))}
              {visible.length === 0 ? (
                <EmptyState
                  icon={<FolderGit2 size={20} />}
                  title="没有进行中的项目"
                  description="切换筛选查看全部项目，或等待下一个项目启动。"
                  action={<Button variant="ghost" onClick={() => setScope('all')}>显示全部</Button>}
                />
              ) : null}
            </div>
          </Surface>

          <Surface title="项目目录约定" subtitle="组织只存元数据与仓库地址，本机路径永远留在本机">
            <pre className="pw-code-block">{`project-root/                     # 原 Git 仓库，原样保留 src/ 等结构
  .projectos/project.json         # 项目局部配置，不存明文密钥
  docs/business/                  # 业务知识（有版本与审核）
  docs/technical/                 # 技术知识（有版本与审核）

projectos-workspaces/{project-id}/requirements/
  REQ-124/
    requirement.md                # 当前已接受需求
    design.md                     # 可选：部分需求不强制设计
    worktree/                     # 指向受管理 feature 分支`}</pre>
            <p className="pw-code-note">
              <ShieldCheck size={12} /> 自动 <span className="pw-mono">git add -A</span> 不会把 Worktree 或密钥带进仓库；目录安全校验与初始化在 A3 实装。
            </p>
          </Surface>
        </div>

        <aside className="pw-projects-rail">
          <Surface title="新建项目预检" subtitle="A1/A3 将按目录类型分别校验">
            <ul className="pw-check-list">
              <li><ShieldCheck size={13} /><span>工作目录类型：空目录 / 已有 Git 仓库 / 非 Git 目录</span></li>
              <li><ShieldCheck size={13} /><span>不移动、不覆盖用户原有源码与文档</span></li>
              <li><ShieldCheck size={13} /><span>符号链接逃逸、磁盘容量与写权限预检</span></li>
              <li><ShieldCheck size={13} /><span>初始 Workflow 与参与成员在真实事务中创建</span></li>
            </ul>
            <Callout tone="neutral" title="A0 边界">
              此处只呈现交互与信息结构。创建项目、绑定仓库与生成需求目录需要 A1/A3 的服务端事务。
            </Callout>
          </Surface>

          <Surface title="项目访问模型" subtitle="身份不等于权限">
            <ul className="pw-role-list">
              <li><Badge tone="accent">Maintainer</Badge><span>审核文档、管理资产、批准交付</span></li>
              <li><Badge tone="neutral">Contributor</Badge><span>编写需求与代码，不自动获得审批权</span></li>
              <li><Badge tone="neutral">Reviewer</Badge><span>独立审查代码与证据</span></li>
              <li><Badge tone="neutral">Viewer</Badge><span>只读访问，不可触发执行</span></li>
            </ul>
            <button type="button" className="pw-link pw-link-inline" onClick={() => onNavigate('members')}>
              查看成员与权限 <ArrowRight size={12} />
            </button>
          </Surface>

          <Surface title="本地工作区" subtitle="当前这台机器">
            <div className="pw-local-card">
              <GitBranch size={14} />
              <div>
                <strong>Local Worker 已连接</strong>
                <small>当前组织 2 个项目已载入；真实项目路径不会上传到组织服务器。</small>
              </div>
            </div>
          </Surface>
        </aside>
      </div>

      <p className="pw-screen-footnote">
        <Badge tone="neutral">DEMO</Badge>
        项目数据仅用于视觉与交互验收；共 {PROJECTS.length} 条演示项目，未连接真实仓库。
      </p>
    </div>
  )
}
