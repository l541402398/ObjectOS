import { z } from 'zod'

const id = z.string().min(1).max(128)
const timestamp = z.number().int().nonnegative()
export const WorkerDirectorySchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(
    (path) =>
      path === '.' ||
      (!/^[/.]/.test(path) &&
        !/[\\:\u0000-\u001f]/.test(path) &&
        path
          .split('/')
          .every(
            (part) =>
              part !== '' && part !== '.' && part !== '..' && !part.endsWith('.') && !part.endsWith(' '),
          )),
    '请选择工作区内的相对目录；整个项目使用 .',
  )
export const LocalWorkerScopeSchema = z
  .object({
    directories: z.array(WorkerDirectorySchema).min(1).max(16),
    tools: z
      .array(z.enum(['list_directory', 'read_file', 'write_file']))
      .min(1)
      .max(3),
    maxToolCalls: z.number().int().min(1).max(100),
  })
  .strict()
  .refine(
    (scope) =>
      new Set(scope.directories).size === scope.directories.length &&
      new Set(scope.tools).size === scope.tools.length,
    '授权范围不能重复',
  )
export const WorkerEnrollmentSchema = z
  .object({
    registrationId: z.uuid(),
    instanceId: z.uuid(),
    name: z.string().trim().min(1).max(60),
    platform: z.enum(['win32', 'darwin', 'linux']),
    protocol: z.literal('local-worker/1'),
    secret: z.string().regex(/^[A-Za-z0-9_-]{64}$/),
  })
  .strict()
export const LocalWorkerViewSchema = z.object({
  id,
  organizationId: id,
  ownerId: id,
  ownerName: z.string().max(120),
  name: z.string().max(60),
  platform: z.enum(['win32', 'darwin', 'linux']),
  protocol: z.literal('local-worker/1'),
  state: z.enum(['active', 'paused', 'revoked']),
  status: z.enum(['online', 'offline', 'paused', 'revoked', 'session_expired']),
  revision: z.number().int().positive(),
  lastSeenAt: timestamp.nullable(),
  createdAt: timestamp,
  executionReady: z.literal(false),
  canManage: z.boolean(),
})
export const WorkerStateInputSchema = z
  .object({
    workerId: id,
    expectedRevision: z.number().int().positive(),
    state: z.enum(['active', 'paused', 'revoked']),
  })
  .strict()
export const WorkerGrantInputSchema = z
  .object({
    id: z.uuid(),
    projectId: id,
    workspaceRef: z.uuid(),
    scope: LocalWorkerScopeSchema,
    scopeDigest: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: timestamp,
  })
  .strict()
export const WorkerGrantViewSchema = WorkerGrantInputSchema.extend({
  workerId: id,
  projectName: z.string().max(120),
  createdAt: timestamp,
  status: z.enum(['active', 'revoked', 'expired', 'unavailable']),
})
export const WorkerServerListSchema = z.object({
  workers: z.array(LocalWorkerViewSchema).max(200),
  grants: z.array(WorkerGrantViewSchema).max(200),
})
export const LocalWorkerGrantSchema = WorkerGrantInputSchema.extend({
  serverUrl: z.url(),
  organizationId: id,
  accountId: id,
  workerId: id,
  localProjectId: id,
  localProjectName: z.string(),
  rootPath: z.string(),
  rootFingerprint: z.string(),
  status: z.enum(['pending', 'consented', 'active', 'revoked']),
  remoteSynced: z.boolean(),
  createdAt: timestamp,
  consentAt: timestamp.nullable(),
})
export const WorkerLocalContextSchema = z.object({
  instanceId: z.uuid(),
  projects: z.array(z.object({ id, name: z.string(), rootPath: z.string() })).max(500),
  grants: z.array(LocalWorkerGrantSchema).max(500),
})
export const WorkerDesktopListSchema = WorkerServerListSchema.extend({
  currentWorkerId: id.nullable(),
  local: WorkerLocalContextSchema,
})
export const WorkerGrantRequestSchema = z
  .object({
    projectId: id,
    localProjectId: id,
    scope: LocalWorkerScopeSchema,
    durationHours: z.number().int().min(1).max(24),
  })
  .strict()
export const WorkerInternalScopeSchema = z
  .object({ serverUrl: z.url(), organizationId: id, accountId: id })
  .strict()
export const WorkerInternalSchemas = {
  'runtime.worker.context': { input: WorkerInternalScopeSchema, output: WorkerLocalContextSchema },
  'runtime.worker.prepare': {
    input: WorkerInternalScopeSchema.extend({ workerId: id, request: WorkerGrantRequestSchema }).strict(),
    output: LocalWorkerGrantSchema,
  },
  'runtime.worker.confirm': {
    input: z.object({ id: z.uuid(), scopeDigest: z.string() }).strict(),
    output: LocalWorkerGrantSchema,
  },
  'runtime.worker.activate': {
    input: z.object({ id: z.uuid(), scopeDigest: z.string() }).strict(),
    output: LocalWorkerGrantSchema,
  },
  'runtime.worker.revoke': {
    input: z.object({ id: z.uuid() }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  'runtime.worker.synced': {
    input: z.object({ id: z.uuid() }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  'runtime.worker.clear': { input: WorkerInternalScopeSchema, output: z.object({ ok: z.literal(true) }) },
} as const
export type LocalWorkerScope = z.infer<typeof LocalWorkerScopeSchema>
export type LocalWorkerView = z.infer<typeof LocalWorkerViewSchema>
export type LocalWorkerGrant = z.infer<typeof LocalWorkerGrantSchema>
export type WorkerDesktopList = z.infer<typeof WorkerDesktopListSchema>
export type WorkerInternalScope = z.infer<typeof WorkerInternalScopeSchema>
