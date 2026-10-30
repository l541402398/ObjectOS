import { useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, GitCompareArrows, Plus } from 'lucide-react'
import { type SharedAssetDetail, type SharedAssetVersion, type SharedProjectView } from '@projectos/contracts'
import { AssetEditor, assetKindLabel, assetStatusLabel, type SkillChoice } from './AssetEditor'
import { OrganizationError, OrganizationField } from './OrganizationPrimitives'

const FIELDS: Record<string, string> = {
  kind: '类型',
  role: '人物角色',
  instructions: '工作指令',
  runtime: '运行方式',
  skillVersionIds: '技能版本',
  toolIds: '工具名称',
  transport: '连接方式',
  target: '连接目标',
  credentialRefs: '密钥引用',
  toolId: '本机工具',
  approval: '审批要求',
  description: '用途与权限范围',
}
const format = (value: unknown): string =>
  Array.isArray(value) ? value.join('、') || '无' : value === undefined ? '无' : String(value)
export function AssetDefinitionDiff({
  current,
  previous,
}: {
  current: SharedAssetVersion
  previous: SharedAssetVersion
}) {
  const before = previous.definition as unknown as Record<string, unknown>,
    after = current.definition as unknown as Record<string, unknown>
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  )
  return (
    <div className="org-asset-diff" data-testid="asset-diff">
      {keys.length ? (
        <table className="org-table">
          <caption className="org-sr-only">
            {previous.version} 与 {current.version} 的字段差异
          </caption>
          <thead>
            <tr>
              <th>字段</th>
              <th>{previous.version}</th>
              <th>{current.version}</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key}>
                <th scope="row">{FIELDS[key] ?? key}</th>
                <td>
                  <del>{format(before[key])}</del>
                </td>
                <td>
                  <ins>{format(after[key])}</ins>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="org-boundary-note">配置内容相同。</p>
      )}
    </div>
  )
}

export function AssetDetail({
  detail,
  projects,
  projectNotice,
  skills,
  onSaved,
  onBack,
}: {
  detail: SharedAssetDetail
  projects: SharedProjectView[]
  projectNotice?: ReactNode
  skills: SkillChoice[]
  onSaved: (value: SharedAssetDetail) => void
  onBack: () => void
}) {
  const [versionId, setVersionId] = useState(detail.versions[0]?.id ?? '')
  const [compareId, setCompareId] = useState(detail.versions[1]?.id ?? '')
  const [editor, setEditor] = useState<'edit' | 'version' | null>(null)
  const [action, setAction] = useState<'publish' | 'deprecate' | 'revoke' | null>(null)
  const [projectId, setProjectId] = useState('')
  const [confirmUnbind, setConfirmUnbind] = useState(false)
  const current = detail.versions.find((version) => version.id === versionId) ?? detail.versions[0]
  const previous = detail.versions.find((version) => version.id === compareId)
  const binding = detail.bindings.find((item) => item.projectId === projectId)
  const saved = (value: SharedAssetDetail) => {
    onSaved(value)
    setEditor(null)
    setAction(null)
    setConfirmUnbind(false)
  }
  const transition = useMutation({
    mutationFn: () =>
      window.projectos.organization.transitionAsset({
        assetId: detail.asset.id,
        versionId: current!.id,
        expectedRevision: current!.revision,
        action: action!,
      }),
    onSuccess: saved,
  })
  const bind = useMutation({
    mutationFn: () =>
      confirmUnbind
        ? window.projectos.organization.unbindAsset({
            assetId: detail.asset.id,
            projectId,
            expectedVersionId: binding!.versionId,
          })
        : window.projectos.organization.bindAsset({
            assetId: detail.asset.id,
            projectId,
            versionId: current!.id,
            expectedVersionId: binding?.versionId ?? null,
          }),
    onSuccess: saved,
  })
  if (!current) return null
  const availableProjects = projects.filter(
    (project) =>
      ['owner', 'maintainer'].includes(project.role) &&
      (!detail.asset.projectId || project.id === detail.asset.projectId),
  )
  return (
    <section className="org-asset-detail" aria-label="资产详情" data-testid="asset-detail">
      <button type="button" className="org-link" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden />
        返回资产列表
      </button>
      <div className="org-section-heading">
        <div>
          <h3>{detail.asset.name}</h3>
          <p>
            {assetKindLabel[detail.asset.kind]} ·{' '}
            {detail.asset.visibility === 'organization' ? '组织共享' : '项目私有'}
          </p>
        </div>
        {detail.asset.canManage ? (
          <button
            type="button"
            className="org-button"
            onClick={() => {
              setEditor('version')
              setAction(null)
            }}
          >
            <Plus size={15} aria-hidden />
            新建版本
          </button>
        ) : (
          <span className="org-role">只读</span>
        )}
      </div>
      {editor ? (
        <AssetEditor
          key={`${editor}:${current.id}`}
          asset={detail.asset}
          initial={current}
          mode={editor}
          projects={projects}
          skills={skills}
          onCancel={() => setEditor(null)}
          onSaved={(value) => {
            if (editor === 'version') setVersionId(value.versions[0]!.id)
            saved(value)
          }}
        />
      ) : (
        <>
          <div className="org-asset-version-bar">
            <OrganizationField label="当前版本">
              {(id) => (
                <select
                  id={id}
                  value={current.id}
                  onChange={(event) => {
                    setVersionId(event.target.value)
                    setAction(null)
                    transition.reset()
                    bind.reset()
                  }}
                >
                  {detail.versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.version} · {assetStatusLabel[version.status]}
                    </option>
                  ))}
                </select>
              )}
            </OrganizationField>
            <span className={`org-asset-status is-${current.status}`} data-testid="asset-status">
              {assetStatusLabel[current.status]}
            </span>
            {detail.asset.canManage ? (
              <div className="org-inline-actions">
                {current.status === 'draft' ? (
                  <>
                    <button type="button" className="org-button" onClick={() => setEditor('edit')}>
                      编辑草稿
                    </button>
                    <button
                      type="button"
                      className="org-button is-primary"
                      onClick={() => setAction('publish')}
                    >
                      发布版本
                    </button>
                  </>
                ) : current.status !== 'revoked' ? (
                  <>
                    {current.status === 'published' ? (
                      <button type="button" className="org-button" onClick={() => setAction('deprecate')}>
                        下线版本
                      </button>
                    ) : null}
                    <button type="button" className="org-link is-danger" onClick={() => setAction('revoke')}>
                      撤销版本
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          {action ? (
            <div className="org-inline-confirm" role="group" aria-label="确认版本操作">
              <p>
                {action === 'publish'
                  ? `发布 ${current.version} 后，配置内容将固定。项目需单独选择绑定版本。`
                  : action === 'deprecate'
                    ? '下线后不能再建立新绑定，已有绑定记录保留。'
                    : `撤销不可恢复，将阻止新绑定。你可查看的 ${detail.bindings.filter((item) => item.versionId === current.id).length} 个现有项目绑定记录保留，需由项目负责人更换版本。`}
              </p>
              <div className="org-inline-actions">
                <button
                  type="button"
                  className="org-button"
                  disabled={transition.isPending}
                  onClick={() => setAction(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={`org-button ${action === 'revoke' ? 'is-danger' : 'is-primary'}`}
                  disabled={transition.isPending}
                  data-testid="asset-confirm-transition"
                  onClick={() => transition.mutate()}
                >
                  {transition.isPending
                    ? '正在处理…'
                    : action === 'publish'
                      ? '确认发布'
                      : action === 'deprecate'
                        ? '确认下线'
                        : '确认撤销'}
                </button>
              </div>
            </div>
          ) : null}
          <OrganizationError error={transition.error} />
          <dl className="org-asset-facts">
            <div>
              <dt>校验摘要</dt>
              <dd>
                <code title={current.checksum}>{current.checksum.slice(0, 23)}…</code>
              </dd>
            </div>
            <div>
              <dt>发布时间</dt>
              <dd>{current.publishedAt ? new Date(current.publishedAt).toLocaleString() : '尚未发布'}</dd>
            </div>
          </dl>
          <details className="org-asset-definition" open>
            <summary>配置与权限</summary>
            <dl>
              {Object.entries(current.definition)
                .filter(([key]) => key !== 'kind')
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{FIELDS[key] ?? key}</dt>
                    <dd>{format(value)}</dd>
                  </div>
                ))}
            </dl>
            {current.definition.kind === 'mcp' ? (
              <p className="org-boundary-note">配置已登记；本机安装、密钥授权和连接可用性尚未验证。</p>
            ) : null}
          </details>
          {detail.versions.length > 1 ? (
            <section className="org-asset-comparison" aria-label="版本差异">
              <div className="org-section-heading">
                <h4>
                  <GitCompareArrows size={16} aria-hidden />
                  版本差异
                </h4>
                <OrganizationField label="对比版本">
                  {(id) => (
                    <select id={id} value={compareId} onChange={(event) => setCompareId(event.target.value)}>
                      <option value="">选择版本</option>
                      {detail.versions
                        .filter((version) => version.id !== current.id)
                        .map((version) => (
                          <option value={version.id} key={version.id}>
                            {version.version}
                          </option>
                        ))}
                    </select>
                  )}
                </OrganizationField>
              </div>
              {previous && previous.id !== current.id ? (
                <AssetDefinitionDiff current={current} previous={previous} />
              ) : null}
            </section>
          ) : null}
          <section className="org-asset-bindings" aria-label="项目版本绑定">
            <div className="org-section-heading">
              <h4>项目版本绑定</h4>
            </div>
            {projectNotice}
            {detail.bindings.length ? (
              <div className="org-table-wrap">
                <table className="org-table">
                  <caption className="org-sr-only">你有权查看的项目资产绑定</caption>
                  <thead>
                    <tr>
                      <th>项目</th>
                      <th>固定版本</th>
                      <th>版本状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.bindings.map((item) => (
                      <tr key={item.projectId}>
                        <td>{item.projectName}</td>
                        <td>
                          <code>{item.version}</code>
                        </td>
                        <td>
                          <span className={`org-asset-status is-${item.status}`}>
                            {assetStatusLabel[item.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="org-boundary-note">尚无你可查看的项目绑定。</p>
            )}
            {projectNotice ? null : availableProjects.length ? (
              <>
                <div className="org-asset-binding-form">
                  <OrganizationField label="绑定到项目">
                    {(id) => (
                      <select
                        id={id}
                        value={projectId}
                        onChange={(event) => {
                          setProjectId(event.target.value)
                          setConfirmUnbind(false)
                          bind.reset()
                        }}
                      >
                        <option value="">选择项目</option>
                        {availableProjects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </OrganizationField>
                  <button
                    type="button"
                    className="org-button"
                    disabled={
                      !projectId ||
                      current.status !== 'published' ||
                      bind.isPending ||
                      binding?.versionId === current.id
                    }
                    data-testid="asset-bind"
                    onClick={() => {
                      setConfirmUnbind(false)
                      bind.mutate()
                    }}
                  >
                    {bind.isPending ? '正在保存…' : `固定到 ${current.version}`}
                  </button>
                  {binding ? (
                    <button
                      type="button"
                      className="org-link is-danger"
                      onClick={() => setConfirmUnbind(true)}
                    >
                      解除绑定
                    </button>
                  ) : null}
                </div>
                {confirmUnbind && binding ? (
                  <div className="org-inline-confirm" role="group" aria-label="确认解除资产绑定">
                    <p>
                      解除 {binding.projectName} 的 {binding.version} 版本绑定？
                    </p>
                    <div className="org-inline-actions">
                      <button type="button" className="org-button" onClick={() => setConfirmUnbind(false)}>
                        取消
                      </button>
                      <button
                        type="button"
                        className="org-button is-danger"
                        disabled={bind.isPending}
                        onClick={() => bind.mutate()}
                      >
                        确认解除
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="org-boundary-note">绑定版本需要项目所有者或维护者权限。</p>
            )}
            <OrganizationError error={bind.error} />
          </section>
          <p className="org-boundary-note">此处保存共享定义与版本绑定，暂不安装工具或启动本机执行。</p>
        </>
      )}
    </section>
  )
}
