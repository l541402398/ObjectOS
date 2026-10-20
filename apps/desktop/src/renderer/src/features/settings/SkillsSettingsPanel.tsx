import { useRef, useState } from 'react'
import { App as AntApp, Button, Drawer, Tag } from 'antd'
import { ImportOutlined, PlusOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { EmptyState, LoadingBlock } from '@projectos/ui'
import { useSkills } from '../../lib/queries'
import { errorMessage } from '../../lib/errors'
import type { Skill } from '@projectos/contracts'

function parseSkillFile(filename: string, raw: string): { name: string; description: string; version: string; content: string } {
  const front = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  const meta: Record<string, string> = {}
  if (front) {
    for (const line of front[1]!.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_-]+):\s*(.+)$/)
      if (match) meta[match[1]!.toLowerCase()] = match[2]!.trim().replace(/^["']|["']$/g, '')
    }
  }
  const body = front ? raw.slice(front[0].length) : raw
  const firstLine = body.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#'))?.trim() ?? ''
  return {
    name: meta.name || filename.replace(/\.md$/i, '') || '未命名 Skill',
    description: meta.description || firstLine.slice(0, 300),
    version: meta.version || '1.0.0',
    content: raw,
  }
}

export function SkillsSettingsPanel() {
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const skills = useSkills()
  const inputRef = useRef<HTMLInputElement>(null)
  const [detail, setDetail] = useState<Skill | null>(null)
  const importSkill = useMutation({
    mutationFn: (input: { name: string; content: string; description: string; version: string }) => window.projectos.skills.import(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['skills'] })
      message.success('Skill 已导入')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const onFile = async (file: File): Promise<void> => {
    const raw = await file.text()
    importSkill.mutate(parseSkillFile(file.name, raw))
  }

  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head">
        <div><h2>Skills 管理</h2><p>{skills.data?.skills.length ?? 0} 个已导入 Skill</p></div>
        <Button type="primary" icon={<PlusOutlined />} loading={importSkill.isPending} onClick={() => inputRef.current?.click()}>导入 SKILL.md</Button>
      </div>
      {skills.isLoading ? <LoadingBlock rows={4} /> : (skills.data?.skills.length ?? 0) === 0 ? (
        <EmptyState icon={<ImportOutlined />} title="尚未导入 Skill" description="导入符合规范的 SKILL.md，Agent 可在 Skills Tab 中绑定。" action={<Button onClick={() => inputRef.current?.click()}>导入 SKILL.md</Button>} />
      ) : (
        <div className="v16-skill-library">
          {(skills.data?.skills ?? []).map((skill) => (
            <button type="button" className="v16-skill-library-card" key={skill.id} onClick={() => setDetail(skill)}>
              <div><strong>{skill.name}</strong><Tag>{`v${skill.version}`}</Tag></div>
              <p>{skill.description || '无描述'}</p>
              <span>{skill.source} · {skill.content.length} 字符</span>
            </button>
          ))}
        </div>
      )}
      <div className="v16-inline-note">Skill 是流程知识与工作提示，不等于 Shell/文件/网络权限。</div>
      <input ref={inputRef} type="file" accept=".md,text/markdown" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); event.target.value = '' }} />
      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} width={560} title={detail?.name ?? 'Skill'}>
        {detail ? (
          <div className="v16-model-detail">
            <div className="v16-card-title"><strong>{detail.name}</strong><Tag>{`v${detail.version}`}</Tag></div>
            <div className="v16-setting-kv"><span>来源</span><strong>{detail.source}</strong></div>
            <div className="v16-setting-kv"><span>描述</span><strong>{detail.description || '无'}</strong></div>
            <pre className="v16-skill-content">{detail.content}</pre>
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}
