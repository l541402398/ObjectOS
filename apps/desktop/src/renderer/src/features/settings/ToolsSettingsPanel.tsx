import { useState } from 'react'
import { Button, Tag } from 'antd'
import { ApiOutlined } from '@ant-design/icons'
import { useRuntimeProfiles, useSkills } from '../../lib/queries'
import { useUiStore } from '../../stores/ui'
import { InspectorShell, OverlayHeader, OverlayScrollArea } from '../../next-ui/overlay/overlay-shell'

export function ToolsSettingsPanel() {
  const runtimes = useRuntimeProfiles()
  const skills = useSkills()
  const profiles = runtimes.data?.profiles ?? []
  const [detail, setDetail] = useState<(typeof profiles)[number] | null>(null)
  const openSettings = useUiStore((state) => state.openSettings)
  const settingsOpen = useUiStore((state) => state.settingsOpen)

  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head">
        <div><h2>工具与插件</h2><p>Runtime 能力与已注册 Skills</p></div>
      </div>

      <div className="po-settings-section-title">Runtime 能力</div>
      {profiles.length === 0 ? (
        <div className="v16-empty-inline">尚未检测到 Runtime。</div>
      ) : (
        <div className="v16-tool-grid">
          {profiles.map((profile) => (
            <button type="button" className="v16-tool-card" key={profile.id} onClick={() => setDetail(profile)}>
              <div><ApiOutlined /><strong>{profile.name}</strong><Tag>{profile.status}</Tag></div>
              <span>{profile.protocol.toUpperCase()} · {profile.version ?? '版本未知'}</span>
              <div className="v16-runtime-tags">
                {profile.capabilities.toolCalls ? <Tag>tool calls</Tag> : null}
                {profile.capabilities.skills ? <Tag>skills</Tag> : null}
                {profile.capabilities.permissions ? <Tag>permissions</Tag> : null}
                {profile.capabilities.worktree ? <Tag>worktree</Tag> : null}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="po-settings-section-title">Skills</div>
      {(skills.data?.skills ?? []).length === 0 ? (
        <div className="v16-empty-inline">尚未导入 Skill。Skill 是流程知识，不等于工具权限。</div>
      ) : (
        <div className="v16-team-list">
          {(skills.data?.skills ?? []).map((skill) => (
            <div className="v16-team-row" key={skill.id}>
              <div><strong>{skill.name}</strong><span>{skill.description || '无描述'}</span></div>
              <Tag>{`v${skill.version}`}</Tag>
            </div>
          ))}
        </div>
      )}

      <InspectorShell open={Boolean(detail) && settingsOpen} onOpenChange={(open) => { if (!open) setDetail(null) }} ariaLabel="Runtime 详情" width={460} testId="settings-runtime-detail">
        <OverlayHeader eyebrow="RUNTIME" title={detail?.name ?? 'Runtime 详情'} closeLabel="关闭 Runtime 详情" meta={detail ? <Tag>{detail.status}</Tag> : null} />
        <OverlayScrollArea className="po-runtime-detail-scroll">
        {detail ? (
          <div className="v16-model-detail">
            <div className="v16-card-title"><strong>{detail.name}</strong><Tag>{detail.status}</Tag></div>
            <div className="v16-setting-kv"><span>协议</span><strong>{detail.protocol}</strong></div>
            <div className="v16-setting-kv"><span>版本</span><strong>{detail.version ?? '未知'}</strong></div>
            <div className="v16-setting-kv"><span>可执行文件</span><strong>{detail.executable ?? '未配置'}</strong></div>
            <div className="v16-setting-kv"><span>来源</span><strong>{detail.source}</strong></div>
            <div className="v16-setting-kv"><span>工具调用</span><strong>{detail.capabilities.toolCalls ? '支持' : '不支持'}</strong></div>
            <div className="v16-setting-kv"><span>权限</span><strong>{detail.capabilities.permissions ? '支持' : '不支持'}</strong></div>
            <div className="v16-setting-kv"><span>Worktree</span><strong>{detail.capabilities.worktree ? '支持' : '不支持'}</strong></div>
            <Button type="primary" onClick={() => openSettings('runtime')}>在 Runtime 管理中打开</Button>
          </div>
        ) : null}
        </OverlayScrollArea>
      </InspectorShell>

      <div className="po-settings-section-title">MCP / 插件</div>
      <div className="v16-empty-inline">当前版本尚未注册 MCP Server 或插件。不会显示虚构的已安装状态。</div>
    </div>
  )
}
