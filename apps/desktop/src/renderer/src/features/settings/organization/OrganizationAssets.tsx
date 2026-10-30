import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, BookOpen, Plug, Wrench, Plus, RefreshCw, Search } from 'lucide-react'
import type {
  OrganizationConnectionView,
  SharedAssetDefinition,
  SharedAssetDetail,
} from '@projectos/contracts'
import { OrganizationEmpty, OrganizationError, OrganizationLoading } from './OrganizationPrimitives'
import { organizationScopeKey } from './useOrganization'
import { AssetEditor, assetKindLabel, assetStatusLabel } from './AssetEditor'
import { AssetDetail } from './AssetDetail'
import './assets.css'

const ICONS = { agent: Bot, skill: BookOpen, mcp: Plug, tool: Wrench }
export function OrganizationAssets({ connection }: { connection: OrganizationConnectionView }) {
  const client = useQueryClient()
  const [selected, setSelected] = useState('')
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('')
  const scope = organizationScopeKey(connection, 'assets')
  const assets = useQuery({
    queryKey: scope,
    queryFn: () => window.projectos.organization.assets(),
    retry: false,
  })
  const projects = useQuery({
    queryKey: organizationScopeKey(connection, 'projects'),
    queryFn: () => window.projectos.organization.projects(),
    retry: false,
  })
  const detail = useQuery({
    queryKey: [...scope, selected],
    queryFn: () => window.projectos.organization.assetDetail({ assetId: selected }),
    enabled: Boolean(selected),
    retry: false,
  })
  const organization = connection.session?.organizations.find(
    (item) => item.id === connection.activeOrganizationId,
  )
  const canCreate = organization?.role === 'owner' || organization?.role === 'admin'
  const skillChoices = (assets.data?.assets ?? [])
    .filter((asset) => asset.kind === 'skill' && asset.publishedVersionId)
    .map((asset) => ({
      id: asset.publishedVersionId!,
      name: `${asset.name} · ${asset.publishedVersion}`,
      projectId: asset.projectId,
    }))
  const onSaved = (value: SharedAssetDetail) => {
    client.setQueryData([...scope, value.asset.id], value)
    setSelected(value.asset.id)
    setCreating(false)
    void client.invalidateQueries({ queryKey: scope, exact: true })
  }
  const rows =
    assets.data?.assets.filter(
      (asset) =>
        (!kind || asset.kind === kind) && asset.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ) ?? []
  const projectNotice = projects.isPending ? (
    <OrganizationLoading />
  ) : projects.isError ? (
    <div>
      <OrganizationError error={projects.error} />
      <button
        type="button"
        className="org-button"
        data-testid="asset-project-retry"
        disabled={projects.isFetching}
        onClick={() => void projects.refetch()}
      >
        重新读取项目
      </button>
    </div>
  ) : null
  return (
    <section className="org-assets" aria-label="组织资产" data-testid="organization-assets">
      {creating ? (
        projectNotice || (
          <AssetEditor
            mode="create"
            projects={projects.data?.projects ?? []}
            skills={skillChoices}
            onSaved={onSaved}
            onCancel={() => setCreating(false)}
          />
        )
      ) : selected ? (
        <>
          <OrganizationError error={detail.error} />
          {detail.isPending ? (
            <OrganizationLoading />
          ) : detail.data ? (
            <AssetDetail
              key={selected}
              detail={detail.data}
              projects={projects.data?.projects ?? []}
              projectNotice={projectNotice}
              skills={skillChoices}
              onSaved={onSaved}
              onBack={() => setSelected('')}
            />
          ) : (
            <button
              type="button"
              className="org-button"
              onClick={() => {
                setSelected('')
                void assets.refetch()
              }}
            >
              返回并刷新
            </button>
          )}
        </>
      ) : (
        <>
          <div className="org-section-heading">
            <h3>组织资产</h3>
            <div className="org-inline-actions">
              <button
                type="button"
                className="org-button"
                aria-label="刷新资产列表"
                onClick={() => void assets.refetch()}
                disabled={assets.isFetching}
              >
                <RefreshCw size={15} aria-hidden />
              </button>
              {canCreate ? (
                <button
                  type="button"
                  className="org-button is-primary"
                  data-testid="asset-create"
                  onClick={() => setCreating(true)}
                >
                  <Plus size={15} aria-hidden />
                  创建资产
                </button>
              ) : null}
            </div>
          </div>
          <div className="org-asset-filters">
            <label className="org-asset-search">
              <Search size={15} aria-hidden />
              <span className="org-sr-only">搜索资产</span>
              <input
                type="search"
                placeholder="搜索资产"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label>
              <span className="org-sr-only">筛选资产类型</span>
              <select value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="">全部类型</option>
                {Object.entries(assetKindLabel).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <OrganizationError error={assets.error} />
          {assets.isPending ? (
            <OrganizationLoading />
          ) : rows.length ? (
            <div className="org-table-wrap">
              <table className="org-table org-asset-table">
                <caption className="org-sr-only">当前组织可访问的共享资产</caption>
                <thead>
                  <tr>
                    <th scope="col">资产</th>
                    <th scope="col">最新版本</th>
                    <th scope="col">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((asset) => {
                    const Icon = ICONS[asset.kind as SharedAssetDefinition['kind']]
                    return (
                      <tr key={asset.id}>
                        <td>
                          <div className="org-item-identity">
                            <span className="org-row-icon">
                              <Icon size={18} aria-hidden />
                            </span>
                            <div>
                              <button
                                type="button"
                                className="org-asset-name"
                                onClick={() => setSelected(asset.id)}
                              >
                                {asset.name}
                              </button>
                              <span className="org-item-sub">
                                {assetKindLabel[asset.kind]} ·{' '}
                                {asset.visibility === 'organization' ? '组织共享' : '项目私有'} ·{' '}
                                {asset.versionCount} 个版本
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <code>{asset.latestVersion}</code>
                        </td>
                        <td>
                          <span className={`org-asset-status is-${asset.latestStatus}`}>
                            {assetStatusLabel[asset.latestStatus]}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : !assets.isError ? (
            <OrganizationEmpty title={search || kind ? '没有匹配的资产' : '还没有共享资产'}>
              {canCreate
                ? '创建 Agent、技能、MCP 或工具定义，再选择版本发布。'
                : '请联系组织管理员发布共享资产。'}
            </OrganizationEmpty>
          ) : null}
          {!canCreate ? (
            <p className="org-boundary-note">
              你可以查看和引用有权访问的版本；发布与撤销需要组织管理员权限。
            </p>
          ) : null}
        </>
      )}
      {!creating && !selected ? projectNotice : null}
    </section>
  )
}
