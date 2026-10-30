import { z } from 'zod'
import { DesktopSessionSchema, OrgRoleSchema, ProjectRoleSchema, ProjectSchema } from '@projectos/organization-contracts'

/** Renderer-safe views: the bearer token is deliberately absent from every IPC output. */
export const OrganizationSessionViewSchema = DesktopSessionSchema.omit({ token: true })
export const OrganizationConnectionViewSchema = z.object({
  status: z.enum(['local', 'connected', 'offline', 'expired']),
  serverUrl: z.string().nullable(),
  session: OrganizationSessionViewSchema.nullable(),
  activeOrganizationId: z.string().nullable(),
  revocationPending: z.boolean(),
})
export type OrganizationConnectionView = z.infer<typeof OrganizationConnectionViewSchema>
export const SharedProjectViewSchema = ProjectSchema.extend({ role: ProjectRoleSchema })
export type SharedProjectView = z.infer<typeof SharedProjectViewSchema>
export const OrganizationProjectsViewSchema = z.object({ organizationId: z.string(), projects: z.array(SharedProjectViewSchema) })
export const OrganizationMembersViewSchema = z.object({ members: z.array(z.object({
  id: z.string(), accountId: z.string(), name: z.string(), email: z.email(), role: OrgRoleSchema,
})) })
export type OrganizationMemberView = z.infer<typeof OrganizationMembersViewSchema>['members'][number]
export const OrganizationInvitationsViewSchema = z.object({ invitations: z.array(z.object({
  id: z.string(), organizationId: z.string(), organizationName: z.string(), role: z.enum(['admin','member']), expiresAt: z.number(),
})) })
export const OrganizationInvitationResultSchema = z.object({ invitation: z.object({
  id: z.string(), email: z.email(), role: z.enum(['admin','member']), status: z.literal('pending'), expiresAt: z.number(),
}), invitationCode: z.string().min(24).max(256) })

const empty = z.object({}).strict()
const ok = z.object({ ok: z.literal(true) })
const id = z.string().min(1).max(128)
export const OrganizationApiSchemas = {
  'organization.status': { input: z.object({ refresh: z.boolean().default(false) }).strict(), output: OrganizationConnectionViewSchema },
  'organization.connect': { input: z.object({ serverUrl: z.url() }).strict(), output: OrganizationConnectionViewSchema },
  'organization.cancel': { input: empty, output: ok },
  'organization.disconnect': { input: empty, output: OrganizationConnectionViewSchema },
  'organization.select': { input: z.object({ organizationId: id }).strict(), output: OrganizationConnectionViewSchema },
  'organization.create': { input: z.object({ name: z.string().trim().min(1).max(100), slug: z.string().min(2).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }).strict(), output: OrganizationConnectionViewSchema },
  'organization.projects': { input: empty, output: OrganizationProjectsViewSchema },
  'organization.createProject': { input: z.object({ key: z.string().min(2).max(16).regex(/^[A-Z][A-Z0-9-]*$/), name: z.string().trim().min(1).max(120), description: z.string().max(600).default('') }).strict(), output: z.object({ project: SharedProjectViewSchema }) },
  'organization.members': { input: empty, output: OrganizationMembersViewSchema },
  'organization.invite': { input: z.object({ email: z.email(), role: z.enum(['admin','member']).default('member') }).strict(), output: OrganizationInvitationResultSchema },
  'organization.invitations': { input: empty, output: OrganizationInvitationsViewSchema },
  'organization.decideInvitation': { input: z.discriminatedUnion('decision',[
    z.object({ invitationId:id, decision:z.literal('accepted'), invitationCode:z.string().min(24).max(256) }).strict(),
    z.object({ invitationId:id, decision:z.literal('rejected') }).strict(),
  ]), output: ok },
  'organization.changeMember': { input: z.object({ memberId: id, role: z.enum(['admin','member']) }).strict(), output: ok },
  'organization.removeMember': { input: z.object({ memberId: id }).strict(), output: ok },
  'organization.setProjectMember': { input: z.object({ projectId: id, accountId: id, role: ProjectRoleSchema.exclude(['owner']) }).strict(), output: ok },
} as const
export const ORGANIZATION_MAIN_METHODS = Object.keys(OrganizationApiSchemas) as Array<keyof typeof OrganizationApiSchemas>
