import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Project, Task } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'
import type { UpstreamContextItem } from '@projectos/context-engine'
import { isProtectedPath } from '@projectos/policy'

export interface UpstreamAuditArtifact {
  id: string
  taskId: string
  kind: string
  title: string
  uri: string | null
  verified: boolean
  fileExists: boolean | null
  injected: boolean
  reason?: string
}

export interface UpstreamAudit {
  artifacts: UpstreamAuditArtifact[]
  runIds: string[]
  skipped: string[]
}

export interface UpstreamBundle {
  items: UpstreamContextItem[]
  audit: UpstreamAudit
}

const MAX_UPSTREAM_TASKS = 8
const MAX_UPSTREAM_ARTIFACTS = 20
const MAX_ARTIFACT_BODY = 12_000

function checkArtifactUri(rootPath: string, kind: string, uri: string | null): { ok: boolean; fileExists: boolean | null; reason?: string } {
  if (!uri) return { ok: true, fileExists: null }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return { ok: true, fileExists: null }
  if (isProtectedPath(uri)) return { ok: false, fileExists: null, reason: '受保护路径，未注入' }
  // Diff artifacts commonly store a branch name, not a file path.
  if (kind === 'diff') return { ok: true, fileExists: null }
  if (isAbsolute(uri)) return { ok: true, fileExists: null }
  const normalized = uri.replace(/\\/g, '/')
  if (normalized.split('/').includes('..')) {
    return { ok: false, fileExists: null, reason: '路径包含 ..，未注入' }
  }
  const absolute = resolve(rootPath, normalized)
  const rel = relative(rootPath, absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, fileExists: null, reason: '路径超出项目根目录，未注入' }
  }
  return { ok: true, fileExists: existsSync(absolute) }
}

/**
 * Collect only direct upstream dependencies' real deliverables. This is a read
 * model for prompt context; it never mutates tasks, artifacts or runs.
 */
export function collectUpstreamContext(store: SqliteStore, project: Project, task: Task): UpstreamBundle {
  const card = store.read.getTaskCard(task.id)
  const dependencyIds = (card?.dependencyIds ?? []).slice(0, MAX_UPSTREAM_TASKS)
  const runs = store.read.listRunSummaries(project.id, 1000)
  const handoffs = store.read.listHandoffViews(project.id)
  const seenArtifacts = new Set<string>()
  const seenRuns = new Set<string>()
  const artifacts: UpstreamAuditArtifact[] = []
  const skipped: string[] = []
  const items: UpstreamContextItem[] = []

  for (const dependencyId of dependencyIds) {
    const dependency = store.read.getTask(dependencyId)
    if (!dependency || dependency.projectId !== project.id) {
      skipped.push(`上游任务 ${dependencyId} 不存在或不属于当前项目`)
      continue
    }
    if (dependency.status !== 'done') {
      skipped.push(`上游任务「${dependency.title}」尚未完成（${dependency.status}）`)
      continue
    }
    const latestRun = runs.find((run) => run.taskId === dependency.id) ?? null
    const handoff = handoffs.find((item) => item.taskId === dependency.id && item.status === 'accepted') ?? null
    const dependencyArtifacts = store.read.listArtifacts(project.id, dependency.id).filter((artifact) => !artifact.isDemo)
    const upstreamArtifacts: UpstreamContextItem['artifacts'] = []
    const itemSkipped: string[] = []

    for (const artifact of dependencyArtifacts.slice(0, MAX_UPSTREAM_ARTIFACTS)) {
      if (seenArtifacts.has(artifact.id)) {
        const reason = `Artifact「${artifact.title}」重复，未重复注入`
        itemSkipped.push(reason)
        skipped.push(reason)
        continue
      }
      seenArtifacts.add(artifact.id)
      const uriCheck = checkArtifactUri(project.rootPath, artifact.kind, artifact.uri)
      const hasContent = Boolean(artifact.body?.trim()) || Boolean(artifact.uri)
      if (!uriCheck.ok) {
        const reason = `Artifact「${artifact.title}」${uriCheck.reason ?? '不可用'}`
        itemSkipped.push(reason)
        skipped.push(reason)
        artifacts.push({
          id: artifact.id,
          taskId: dependency.id,
          kind: artifact.kind,
          title: artifact.title,
          uri: artifact.uri,
          verified: Boolean(artifact.verifiedAt),
          fileExists: uriCheck.fileExists,
          injected: false,
          reason: reason,
        })
        continue
      }
      if (!hasContent) {
        const reason = `Artifact「${artifact.title}」没有正文或文件引用`
        itemSkipped.push(reason)
        skipped.push(reason)
        artifacts.push({
          id: artifact.id,
          taskId: dependency.id,
          kind: artifact.kind,
          title: artifact.title,
          uri: artifact.uri,
          verified: Boolean(artifact.verifiedAt),
          fileExists: uriCheck.fileExists,
          injected: false,
          reason,
        })
        continue
      }
      if (uriCheck.fileExists === false) {
        itemSkipped.push(`Artifact「${artifact.title}」引用的文件不存在：${artifact.uri}`)
        skipped.push(`Artifact「${artifact.title}」引用的文件不存在：${artifact.uri}`)
      }
      upstreamArtifacts.push({
        id: artifact.id,
        title: artifact.title,
        kind: artifact.kind,
        uri: artifact.uri,
        verified: Boolean(artifact.verifiedAt),
        body: (artifact.body ?? '').slice(0, MAX_ARTIFACT_BODY),
      })
      artifacts.push({
        id: artifact.id,
        taskId: dependency.id,
        kind: artifact.kind,
        title: artifact.title,
        uri: artifact.uri,
        verified: Boolean(artifact.verifiedAt),
        fileExists: uriCheck.fileExists,
        injected: true,
      })
    }

    const runIds: string[] = []
    if (latestRun?.status === 'completed') {
      if (!seenRuns.has(latestRun.id)) {
        seenRuns.add(latestRun.id)
        runIds.push(latestRun.id)
      }
    }
    if (upstreamArtifacts.length === 0 && !latestRun?.summary && !handoff?.summary) {
      itemSkipped.push('该上游任务没有可用的 Artifact、完成摘要或交接摘要')
      skipped.push(`上游任务「${dependency.title}」没有可用的 Artifact、完成摘要或交接摘要`)
    }
    items.push({
      taskId: dependency.id,
      taskTitle: dependency.title,
      status: dependency.status,
      summary: latestRun?.status === 'completed' ? latestRun.summary : null,
      runIds,
      handoffSummary: handoff?.summary ?? null,
      artifacts: upstreamArtifacts,
      skipped: itemSkipped,
    })
  }

  return {
    items,
    audit: {
      artifacts,
      runIds: [...seenRuns],
      skipped,
    },
  }
}
