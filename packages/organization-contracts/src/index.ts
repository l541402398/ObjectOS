/**
 * Organization domain contracts — A0 draft (not wired to production UI yet).
 *
 * Scope discipline for A0: these are additive, server-side contracts for the organization control
 * plane. They do not change any existing ProjectOS IPC payload, SQLite table or runtime contract.
 * The local-first single-user path keeps using `@projectos/contracts`.
 *
 * Authority rules encoded here (see docs/org-upgrade/ADR-ORG-0001-architecture.md):
 * - Account ↔ OrganizationMembership ↔ Organization → Project ↔ ProjectMembership → Requirement.
 * - An organization role never silently becomes a project permission.
 * - A project permission never grants local filesystem/shell execution; that needs a Worker lease.
 * - Shared assets are published as immutable versions and pinned by runs.
 */
import { z } from 'zod'

/** Stable ids. Server ids are opaque strings; local ids stay local (see LocalProjectLink). */
export const IdSchema = z.string().min(1).max(128)

export const ORG_ROLES = ['owner', 'admin', 'member'] as const
export const PROJECT_ROLES = ['owner', 'maintainer', 'contributor', 'reviewer', 'viewer'] as const
export const MEMBERSHIP_STATUSES = ['invited', 'active', 'suspended', 'removed'] as const
export const ASSET_KINDS = ['agent', 'skill', 'mcp', 'tool', 'workflow', 'model_policy'] as const
export const ASSET_STATUSES = ['draft', 'published', 'deprecated', 'revoked'] as const
export const WORKFLOW_STATES = ['draft', 'published', 'archived'] as const
export const WORKFLOW_INSTANCE_STATES = [
  'waiting_input',
  'running',
  'blocked',
  'completed',
  'cancelled',
] as const

export type OrgRole = (typeof ORG_ROLES)[number]
export type ProjectRole = (typeof PROJECT_ROLES)[number]
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number]
export type AssetKind = (typeof ASSET_KINDS)[number]
export type AssetStatus = (typeof ASSET_STATUSES)[number]

export const OrgRoleSchema = z.enum(ORG_ROLES)
export const ProjectRoleSchema = z.enum(PROJECT_ROLES)
export const MembershipStatusSchema = z.enum(MEMBERSHIP_STATUSES)
export const AssetKindSchema = z.enum(ASSET_KINDS)
export const AssetStatusSchema = z.enum(ASSET_STATUSES)

const TimestampSchema = z.number().int().nonnegative()

export const AccountSchema = z.object({
  id: IdSchema,
  email: z.email(),
  name: z.string().min(1).max(120),
  image: z.string().url().optional(),
  createdAt: TimestampSchema,
})
export type Account = z.infer<typeof AccountSchema>

export const OrganizationSchema = z.object({
  id: IdSchema,
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug 只能包含小写字母、数字和连字符'),
  name: z.string().min(1).max(120),
  createdAt: TimestampSchema,
  /** Display-only; never used for authorization. */
  logo: z.string().url().optional(),
})
export type Organization = z.infer<typeof OrganizationSchema>

export const OrganizationMembershipSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  accountId: IdSchema,
  role: OrgRoleSchema,
  status: MembershipStatusSchema,
  invitedByAccountId: IdSchema.optional(),
  /** Job title is presentation metadata, not a permission. */
  title: z.string().max(120).optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type OrganizationMembership = z.infer<typeof OrganizationMembershipSchema>

/**
 * A shared project record. Deliberately has NO `rootPath`: a machine path is never valid for another
 * member. The mapping from a local project root to this record lives in `LocalProjectLink` and stays
 * on the machine that owns it.
 */
export const ProjectSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  key: z
    .string()
    .min(2)
    .max(16)
    .regex(/^[A-Z][A-Z0-9-]*$/, 'project key 例如 OSP、WS-SDK'),
  name: z.string().min(1).max(120),
  description: z.string().max(600).optional(),
  repo: z
    .object({
      provider: z.enum(['github', 'gitlab', 'gitea', 'other']),
      uri: z.string().min(1).max(500),
      defaultBranch: z.string().min(1).max(200),
    })
    .optional(),
  status: z.enum(['active', 'paused', 'archived']),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Project = z.infer<typeof ProjectSchema>

export const ProjectMembershipSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  projectId: IdSchema,
  accountId: IdSchema,
  role: ProjectRoleSchema,
  createdAt: TimestampSchema,
})
export type ProjectMembership = z.infer<typeof ProjectMembershipSchema>

/** Explicit, auditable bridge between an existing local project and an organization project. */
export const LocalProjectLinkSchema = z.object({
  localProjectId: IdSchema,
  organizationId: IdSchema,
  serverProjectId: IdSchema,
  workerId: IdSchema,
  /** Local-only field. Never returned to another member or written to the shared record. */
  localRootPath: z.string().min(1),
  mappingVersion: z.number().int().positive(),
  createdAt: TimestampSchema,
})
export type LocalProjectLink = z.infer<typeof LocalProjectLinkSchema>

export const OrganizationAssetVersionSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  assetKind: AssetKindSchema,
  assetId: IdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'semver 例如 2.4.1'),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  status: AssetStatusSchema,
  /** Published versions are immutable; edits create a new version. */
  publishedByAccountId: IdSchema.optional(),
  publishedAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
})
export type OrganizationAssetVersion = z.infer<typeof OrganizationAssetVersionSchema>

export const AssetBindingSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  projectId: IdSchema,
  assetVersionId: IdSchema,
  createdAt: TimestampSchema,
})
export type AssetBinding = z.infer<typeof AssetBindingSchema>

export const RequirementWorkspaceBindingSchema = z.object({
  requirementId: IdSchema,
  organizationId: IdSchema,
  projectId: IdSchema,
  workerId: IdSchema,
  baseCommit: z.string().regex(/^[a-f0-9]{7,64}$/),
  branch: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9._/-]+$/, 'branch 含非法字符'),
  /** Opaque local reference; resolved only by the owning Worker. */
  localWorkspaceRef: IdSchema,
  status: z.enum(['requested', 'ready', 'running', 'blocked', 'archived']),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type RequirementWorkspaceBinding = z.infer<typeof RequirementWorkspaceBindingSchema>

export const WorkflowNodeKindSchema = z.enum([
  'human_input',
  'agent_task',
  'document_gate',
  'condition',
  'parallel',
  'join',
  'test_gate',
  'review_gate',
  'knowledge_publish',
  'delivery',
  'extension',
])
export type WorkflowNodeKind = z.infer<typeof WorkflowNodeKindSchema>

export const WorkflowGraphSchema = z.object({
  nodes: z
    .array(
      z.object({
        id: IdSchema,
        kind: WorkflowNodeKindSchema,
        title: z.string().min(1).max(120),
        role: z.string().max(80).optional(),
        /** Declarative inputs/outputs, not arbitrary executable code. */
        inputs: z.array(z.string().max(200)).max(32),
        outputs: z.array(z.string().max(200)).max(32),
        gatePolicyId: IdSchema.optional(),
        optional: z.boolean(),
      }),
    )
    .min(1)
    .max(200),
  edges: z
    .array(z.object({ id: IdSchema, source: IdSchema, target: IdSchema }))
    .max(400),
})
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>

export const WorkflowTemplateVersionSchema = z.object({
  id: IdSchema,
  templateId: IdSchema,
  organizationId: IdSchema,
  version: z.number().int().positive(),
  graph: WorkflowGraphSchema,
  mandatoryGatePolicyId: IdSchema,
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  status: z.enum(WORKFLOW_STATES),
  createdAt: TimestampSchema,
})
export type WorkflowTemplateVersion = z.infer<typeof WorkflowTemplateVersionSchema>

export const WorkflowInstanceSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  requirementId: IdSchema,
  projectId: IdSchema,
  /** Frozen at creation; a template update never mutates a running instance. */
  templateVersionId: IdSchema,
  currentNodeIds: z.array(IdSchema),
  state: z.enum(WORKFLOW_INSTANCE_STATES),
  planLineageIds: z.array(IdSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type WorkflowInstance = z.infer<typeof WorkflowInstanceSchema>

export const WorkerSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  name: z.string().min(1).max(120),
  kind: z.enum(['local', 'remote']),
  capabilities: z.array(z.string().max(80)).max(64),
  publicKeyFingerprint: z.string().max(200),
  status: z.enum(['online', 'offline', 'paused', 'revoked']),
  lastHeartbeatAt: TimestampSchema.optional(),
  revokedAt: TimestampSchema.optional(),
})
export type Worker = z.infer<typeof WorkerSchema>

/** Minimal lease envelope; the Worker validates every field locally before acting. */
export const WorkerJobEnvelopeSchema = z.object({
  jobId: IdSchema,
  organizationId: IdSchema,
  projectId: IdSchema,
  requirementId: IdSchema,
  planId: IdSchema,
  runId: IdSchema,
  workerId: IdSchema,
  leaseToken: z.string().min(32).max(512),
  fencing: z.number().int().nonnegative(),
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  idempotencyKey: z.string().min(8).max(200),
  allowedPaths: z.array(z.string().min(1)).max(32),
  permittedToolIds: z.array(IdSchema).max(64),
  budget: z.object({ maxCalls: z.number().int().positive(), maxCost: z.number().nonnegative() }),
  assetSnapshots: z.array(z.object({ id: IdSchema, version: z.string(), checksum: z.string() })),
  /** Local interpretation only; never a path other members can resolve. */
  workspaceRef: IdSchema,
})
export type WorkerJobEnvelope = z.infer<typeof WorkerJobEnvelopeSchema>

/** Desktop login: loopback redirect + PKCE. No token ever appears in a URL. */
export const DESKTOP_CLIENT_ID = 'projectos-desktop' as const
export const DesktopAuthorizeQuerySchema = z.object({
  client_id: z.literal(DESKTOP_CLIENT_ID),
  redirect_uri: z
    .string()
    .regex(/^http:\/\/127\.0\.0\.1:\d{2,5}\/callback$/, '只允许 127.0.0.1 回环回调'),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'PKCE S256 challenge'),
  code_challenge_method: z.literal('S256'),
  state: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  organization_id: IdSchema.optional(),
})
export type DesktopAuthorizeQuery = z.infer<typeof DesktopAuthorizeQuerySchema>

export const DesktopTokenRequestSchema = z.object({
  client_id: z.literal(DESKTOP_CLIENT_ID),
  grant_type: z.literal('authorization_code'),
  code: z.string().min(16).max(512),
  code_verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
})
export type DesktopTokenRequest = z.infer<typeof DesktopTokenRequestSchema>

export const DesktopSessionSchema = z.object({
  token: z.string().min(32),
  expiresAt: TimestampSchema,
  account: z.object({ id: IdSchema, name: z.string(), email: z.email() }),
  organizations: z.array(z.object({ id: IdSchema, name: z.string(), slug: z.string(), role: OrgRoleSchema })),
})
export type DesktopSession = z.infer<typeof DesktopSessionSchema>

/**
 * Fine-grained permissions. "Has this role" is not the same question as "may perform this action".
 */
export const ORG_PERMISSIONS = [
  'org.view',
  'org.manage_members',
  'org.manage_settings',
  'org.create_project',
  'org.publish_asset',
  'org.view_audit',
  'org.manage_billing',
] as const
export const PROJECT_PERMISSIONS = [
  'project.view',
  'project.write_requirement',
  'project.approve_requirement',
  'project.approve_design',
  'project.review_code',
  'project.deliver',
  'project.manage_members',
  'project.manage_assets',
  'project.manage_settings',
] as const

export type OrgPermission = (typeof ORG_PERMISSIONS)[number]
export type ProjectPermission = (typeof PROJECT_PERMISSIONS)[number]

const ORG_ROLE_PERMISSIONS: Record<OrgRole, readonly OrgPermission[]> = {
  owner: ORG_PERMISSIONS,
  admin: ORG_PERMISSIONS.filter((permission) => permission !== 'org.manage_billing'),
  member: ['org.view'],
}

const PROJECT_ROLE_PERMISSIONS: Record<ProjectRole, readonly ProjectPermission[]> = {
  owner: PROJECT_PERMISSIONS,
  maintainer: [
    'project.view',
    'project.write_requirement',
    'project.approve_requirement',
    'project.approve_design',
    'project.review_code',
    'project.manage_assets',
  ],
  contributor: ['project.view', 'project.write_requirement'],
  reviewer: ['project.view', 'project.review_code'],
  viewer: ['project.view'],
}

export function orgPermissionsForRole(role: OrgRole): ReadonlySet<OrgPermission> {
  return new Set(ORG_ROLE_PERMISSIONS[role])
}

export function projectPermissionsForRole(role: ProjectRole): ReadonlySet<ProjectPermission> {
  return new Set(PROJECT_ROLE_PERMISSIONS[role])
}

export function canOrg(role: OrgRole, permission: OrgPermission): boolean {
  return orgPermissionsForRole(role).has(permission)
}

export function canProject(role: ProjectRole, permission: ProjectPermission): boolean {
  return projectPermissionsForRole(role).has(permission)
}

/**
 * A project role must be read from a membership in *that* project. Organization membership alone
 * grants no project permission — including for owners, who still act through a project role.
 */
export function projectRoleOf(
  memberships: readonly ProjectMembership[],
  projectId: string,
  accountId: string,
): ProjectRole | null {
  const membership = memberships.find(
    (item) => item.projectId === projectId && item.accountId === accountId,
  )
  return membership?.role ?? null
}

export function assertProjectAccess(
  memberships: readonly ProjectMembership[],
  projectId: string,
  accountId: string,
  permission: ProjectPermission,
): { ok: true } | { ok: false; code: 'PROJECT_FORBIDDEN' } {
  const role = projectRoleOf(memberships, projectId, accountId)
  if (!role || !canProject(role, permission)) return { ok: false, code: 'PROJECT_FORBIDDEN' }
  return { ok: true }
}

/** Domain error codes; UI must translate them into a next step, never show raw stacks. */
export const ORG_ERROR_CODES = [
  'ORG_FORBIDDEN',
  'PROJECT_FORBIDDEN',
  'RESOURCE_NOT_IN_SCOPE',
  'WORKER_OFFLINE',
  'WORKER_NOT_AUTHORIZED',
  'LEASE_EXPIRED',
  'WORKFLOW_TEMPLATE_STALE',
  'WORKFLOW_GATE_REQUIRED',
  'REQUIREMENT_WORKSPACE_CONFLICT',
  'REQUIREMENT_BASE_CHANGED',
  'EXECUTION_RECONCILIATION_REQUIRED',
  'CREDENTIAL_NOT_AVAILABLE',
] as const
export type OrgErrorCode = (typeof ORG_ERROR_CODES)[number]

export const OrgErrorSchema = z.object({
  code: z.enum(ORG_ERROR_CODES),
  message: z.string(),
  correlationId: z.string().optional(),
  /** Optional machine-readable field pointer for form errors. */
  field: z.string().optional(),
})
export type OrgError = z.infer<typeof OrgErrorSchema>
