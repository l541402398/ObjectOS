import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  SharedAssetDefinitionSchema,
  type SharedAsset,
  type SharedAssetDefinition,
  type SharedAssetDetail,
  type SharedAssetVersion,
  type SharedProjectView,
} from '@projectos/contracts'
import { OrganizationError, OrganizationField } from './OrganizationPrimitives'

export const assetKindLabel = { agent: 'Agent', skill: '技能', mcp: 'MCP', tool: '工具' } as const
export const assetStatusLabel = {
  draft: '草稿',
  published: '已发布',
  deprecated: '已下线',
  revoked: '已撤销',
} as const
export interface SkillChoice {
  id: string
  name: string
  projectId: string | null
}
const split = (value: string) =>
  value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
function AssetListInput({
  id,
  initial,
  onChange,
}: {
  id: string
  initial: string[]
  onChange: (value: string[]) => void
}) {
  const [text, setText] = useState(initial.join(', '))
  return (
    <input
      id={id}
      value={text}
      onChange={(event) => {
        setText(event.target.value)
        onChange(split(event.target.value))
      }}
    />
  )
}
const emptyDefinition = (kind: SharedAssetDefinition['kind']): SharedAssetDefinition => {
  switch (kind) {
    case 'agent':
      return { kind, role: '', instructions: '', runtime: 'native', skillVersionIds: [], toolIds: [] }
    case 'skill':
      return { kind, instructions: '', toolIds: [] }
    case 'mcp':
      return { kind, transport: 'stdio', target: '', credentialRefs: [] }
    case 'tool':
      return { kind, toolId: '', approval: 'required', description: '' }
  }
}

export function AssetEditor({
  asset,
  initial,
  mode,
  projects,
  skills,
  onSaved,
  onCancel,
}: {
  asset?: SharedAsset
  initial?: SharedAssetVersion
  mode: 'create' | 'version' | 'edit'
  projects: SharedProjectView[]
  skills: SkillChoice[]
  onSaved: (detail: SharedAssetDetail) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(asset?.name ?? '')
  const [definition, setDefinition] = useState<SharedAssetDefinition>(
    initial?.definition ?? emptyDefinition('agent'),
  )
  const [version, setVersion] = useState(
    mode === 'version' && initial
      ? initial.version.replace(/\d+$/, (value) => String(Number(value) + 1))
      : (initial?.version ?? '1.0.0'),
  )
  const [scope, setScope] = useState(asset?.projectId ?? '')
  const [validation, setValidation] = useState('')
  const save = useMutation({
    mutationFn: async () => {
      const parsed = SharedAssetDefinitionSchema.safeParse(definition)
      if (!parsed.success) throw new Error('请检查必填内容、工具名称和密钥引用；共享定义不能包含真实密钥。')
      if (mode === 'edit' && asset && initial)
        return window.projectos.organization.updateAssetDraft({
          assetId: asset.id,
          versionId: initial.id,
          expectedRevision: initial.revision,
          definition: parsed.data,
        })
      if (mode === 'version' && asset)
        return window.projectos.organization.createAssetVersion({
          assetId: asset.id,
          version,
          definition: parsed.data,
        })
      return window.projectos.organization.createAsset({
        name,
        version,
        visibility: scope ? 'project' : 'organization',
        projectId: scope || null,
        definition: parsed.data,
      })
    },
    onSuccess: onSaved,
    gcTime: 0,
  })
  const update = (patch: Record<string, unknown>) => {
    setDefinition((value) => ({ ...value, ...patch }) as SharedAssetDefinition)
    save.reset()
    setValidation('')
  }
  const title = mode === 'create' ? '创建资产' : mode === 'edit' ? '编辑草稿' : '创建新版本'
  return (
    <form
      className="org-inline-form org-asset-editor"
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault()
        if (!/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(version)) {
          setValidation('版本号请使用 1.0.0 格式。')
          return
        }
        save.mutate()
      }}
    >
      <div className="org-form-heading">
        <h4>{title}</h4>
        <button type="button" className="org-link" onClick={onCancel} disabled={save.isPending}>
          取消
        </button>
      </div>
      <fieldset disabled={save.isPending}>
        <div className="org-form-grid">
          {mode === 'create' ? (
            <OrganizationField label="资产名称">
              {(id) => (
                <input
                  id={id}
                  data-testid="asset-name"
                  required
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </OrganizationField>
          ) : null}
          {mode === 'create' ? (
            <OrganizationField label="资产类型">
              {(id) => (
                <select
                  id={id}
                  value={definition.kind}
                  onChange={(event) =>
                    setDefinition(emptyDefinition(event.target.value as SharedAssetDefinition['kind']))
                  }
                >
                  {Object.entries(assetKindLabel).map(([key, label]) => (
                    <option value={key} key={key}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </OrganizationField>
          ) : null}
          <OrganizationField label="版本号">
            {(id) => (
              <input
                id={id}
                required
                value={version}
                readOnly={mode === 'edit'}
                onChange={(event) => setVersion(event.target.value)}
              />
            )}
          </OrganizationField>
          {mode === 'create' ? (
            <OrganizationField label="可见范围">
              {(id) => (
                <select id={id} value={scope} onChange={(event) => setScope(event.target.value)}>
                  <option value="">组织成员</option>
                  {projects
                    .filter((project) => ['owner', 'maintainer'].includes(project.role))
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        仅 {project.name}
                      </option>
                    ))}
                </select>
              )}
            </OrganizationField>
          ) : null}
        </div>
        {definition.kind === 'agent' ? (
          <div className="org-form-grid">
            <OrganizationField label="人物角色">
              {(id) => (
                <input
                  id={id}
                  required
                  maxLength={80}
                  value={definition.role}
                  onChange={(event) => update({ role: event.target.value })}
                />
              )}
            </OrganizationField>
            <OrganizationField label="运行方式">
              {(id) => (
                <select
                  id={id}
                  value={definition.runtime}
                  onChange={(event) => update({ runtime: event.target.value })}
                >
                  <option value="native">内置 Agent</option>
                  <option value="cli">命令行 Agent</option>
                  <option value="acp">ACP Agent</option>
                </select>
              )}
            </OrganizationField>
          </div>
        ) : null}
        {'instructions' in definition ? (
          <OrganizationField label="工作指令">
            {(id) => (
              <textarea
                id={id}
                required
                rows={6}
                maxLength={20_000}
                value={definition.instructions}
                onChange={(event) => update({ instructions: event.target.value })}
              />
            )}
          </OrganizationField>
        ) : null}
        {'toolIds' in definition ? (
          <OrganizationField label="工具名称" hint="使用英文名称，以逗号分隔。实际执行仍需本机授权。">
            {(id) => (
              <AssetListInput
                key={definition.kind}
                id={id}
                initial={definition.toolIds}
                onChange={(toolIds) => update({ toolIds })}
              />
            )}
          </OrganizationField>
        ) : null}
        {definition.kind === 'agent' && skills.length ? (
          <OrganizationField label="技能版本">
            {(id) => (
              <select
                id={id}
                multiple
                value={definition.skillVersionIds}
                onChange={(event) =>
                  update({ skillVersionIds: [...event.target.selectedOptions].map((option) => option.value) })
                }
              >
                {skills
                  .filter((skill) => !skill.projectId || skill.projectId === scope)
                  .map((skill) => (
                    <option value={skill.id} key={skill.id}>
                      {skill.name}
                    </option>
                  ))}
                {definition.skillVersionIds
                  .filter((selected) => !skills.some((skill) => skill.id === selected))
                  .map((selected) => (
                    <option key={selected} value={selected}>
                      已固定版本 · {selected.slice(0, 8)}
                    </option>
                  ))}
              </select>
            )}
          </OrganizationField>
        ) : null}
        {definition.kind === 'mcp' ? (
          <>
            <div className="org-form-grid">
              <OrganizationField label="连接方式">
                {(id) => (
                  <select
                    id={id}
                    value={definition.transport}
                    onChange={(event) => update({ transport: event.target.value, target: '' })}
                  >
                    <option value="stdio">本机命令</option>
                    <option value="https">HTTPS 服务</option>
                  </select>
                )}
              </OrganizationField>
              <OrganizationField label={definition.transport === 'stdio' ? '命令名称' : '服务地址'}>
                {(id) => (
                  <input
                    id={id}
                    required
                    value={definition.target}
                    onChange={(event) => update({ target: event.target.value })}
                  />
                )}
              </OrganizationField>
            </div>
            <OrganizationField
              label="所需密钥名称"
              hint="只填写名称，例如 SERVICE_API_KEY；不要填写密钥内容。"
            >
              {(id) => (
                <AssetListInput
                  id={id}
                  initial={definition.credentialRefs}
                  onChange={(credentialRefs) => update({ credentialRefs })}
                />
              )}
            </OrganizationField>
          </>
        ) : null}
        {definition.kind === 'tool' ? (
          <>
            <OrganizationField label="本机工具名称">
              {(id) => (
                <input
                  id={id}
                  required
                  value={definition.toolId}
                  onChange={(event) => update({ toolId: event.target.value })}
                />
              )}
            </OrganizationField>
            <OrganizationField label="用途与权限范围">
              {(id) => (
                <textarea
                  id={id}
                  required
                  maxLength={2000}
                  rows={4}
                  value={definition.description}
                  onChange={(event) => update({ description: event.target.value })}
                />
              )}
            </OrganizationField>
            <p className="org-boundary-note">执行需要审批；共享定义不能放宽本机权限。</p>
          </>
        ) : null}
      </fieldset>
      {validation ? (
        <p className="org-message is-error" role="alert">
          {validation}
        </p>
      ) : null}
      <OrganizationError error={save.error} />
      <div className="org-form-actions">
        <button type="button" className="org-button" onClick={onCancel} disabled={save.isPending}>
          取消
        </button>
        <button
          type="submit"
          className="org-button is-primary"
          data-testid="asset-save"
          disabled={save.isPending}
        >
          {save.isPending ? '正在保存…' : '保存草稿'}
        </button>
      </div>
    </form>
  )
}
