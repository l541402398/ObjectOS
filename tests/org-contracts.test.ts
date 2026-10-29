import { describe, expect, it } from 'vitest'
import {
  DesktopAuthorizeQuerySchema,
  DesktopTokenRequestSchema,
  OrganizationSchema,
  ProjectSchema,
  ProjectMembershipSchema,
  WorkerJobEnvelopeSchema,
  WorkflowGraphSchema,
  assertProjectAccess,
  canOrg,
  canProject,
  orgPermissionsForRole,
  projectRoleOf,
  type ProjectMembership,
} from '@projectos/organization-contracts'

/**
 * A0 organization contracts — pure unit tests.
 *
 * These lock the permission semantics that the A0 PoC server relies on: an organization role never
 * becomes a project permission, project access requires a membership in that project, and the
 * desktop login contract refuses anything that is not a loopback PKCE redirect.
 */

const memberships: ProjectMembership[] = [
  {
    id: 'pm-1',
    organizationId: 'org-a',
    projectId: 'proj-a',
    accountId: 'account-1',
    role: 'maintainer',
    createdAt: 1,
  },
  {
    id: 'pm-2',
    organizationId: 'org-a',
    projectId: 'proj-a',
    accountId: 'account-2',
    role: 'viewer',
    createdAt: 1,
  },
]

describe('organization role permissions', () => {
  it('grants owners every organization permission', () => {
    expect(orgPermissionsForRole('owner').has('org.manage_billing')).toBe(true)
    expect(canOrg('owner', 'org.publish_asset')).toBe(true)
  })

  it('keeps billing away from admins but allows member management', () => {
    expect(canOrg('admin', 'org.manage_billing')).toBe(false)
    expect(canOrg('admin', 'org.manage_members')).toBe(true)
  })

  it('gives members read-only organization access', () => {
    expect(canOrg('member', 'org.view')).toBe(true)
    expect(canOrg('member', 'org.create_project')).toBe(false)
    expect(canOrg('member', 'org.publish_asset')).toBe(false)
  })
})

describe('project permissions are not inherited from organization roles', () => {
  it('requires a project membership row', () => {
    expect(projectRoleOf(memberships, 'proj-a', 'account-3')).toBeNull()
    expect(assertProjectAccess(memberships, 'proj-a', 'account-3', 'project.view')).toEqual({
      ok: false,
      code: 'PROJECT_FORBIDDEN',
    })
  })

  it('lets a maintainer approve documents but not deliver', () => {
    expect(projectRoleOf(memberships, 'proj-a', 'account-1')).toBe('maintainer')
    expect(canProject('maintainer', 'project.approve_design')).toBe(true)
    expect(canProject('maintainer', 'project.deliver')).toBe(false)
    expect(assertProjectAccess(memberships, 'proj-a', 'account-1', 'project.approve_design')).toEqual({ ok: true })
  })

  it('does not let a viewer write requirements', () => {
    expect(assertProjectAccess(memberships, 'proj-a', 'account-2', 'project.write_requirement')).toEqual({
      ok: false,
      code: 'PROJECT_FORBIDDEN',
    })
  })

  it('does not treat a different project as accessible', () => {
    expect(assertProjectAccess(memberships, 'proj-b', 'account-1', 'project.view')).toEqual({
      ok: false,
      code: 'PROJECT_FORBIDDEN',
    })
  })
})

describe('shared records never carry a machine-local path', () => {
  it('rejects a rootPath property on the shared project schema', () => {
    expect(Object.keys(ProjectSchema.shape)).not.toContain('rootPath')
  })

  it('validates the project key and organization ownership', () => {
    const parsed = ProjectSchema.safeParse({
      id: 'proj-1',
      organizationId: 'org-1',
      key: 'osp',
      name: 'ProjectOS',
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
    })
    expect(parsed.success).toBe(false)
  })
})

describe('desktop login contract', () => {
  const validQuery = {
    client_id: 'projectos-desktop',
    redirect_uri: 'http://127.0.0.1:49152/callback',
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256',
    state: 'b'.repeat(32),
  }

  it('accepts a loopback callback with PKCE S256', () => {
    expect(DesktopAuthorizeQuerySchema.safeParse(validQuery).success).toBe(true)
  })

  it('rejects non-loopback redirects', () => {
    for (const redirect_uri of [
      'http://localhost:49152/callback',
      'https://attacker.example/callback',
      'http://127.0.0.1:49152/other',
      'http://10.0.0.5:49152/callback',
    ]) {
      expect(DesktopAuthorizeQuerySchema.safeParse({ ...validQuery, redirect_uri }).success).toBe(false)
    }
  })

  it('rejects plain PKCE and short state', () => {
    expect(DesktopAuthorizeQuerySchema.safeParse({ ...validQuery, code_challenge_method: 'plain' }).success).toBe(false)
    expect(DesktopAuthorizeQuerySchema.safeParse({ ...validQuery, state: 'short' }).success).toBe(false)
  })

  it('requires an authorization_code grant with a long verifier', () => {
    expect(DesktopTokenRequestSchema.safeParse({
      client_id: 'projectos-desktop',
      grant_type: 'authorization_code',
      code: 'c'.repeat(32),
      code_verifier: 'd'.repeat(43),
    }).success).toBe(true)
    expect(DesktopTokenRequestSchema.safeParse({
      client_id: 'projectos-desktop',
      grant_type: 'authorization_code',
      code: 'c'.repeat(32),
      code_verifier: 'd'.repeat(10),
    }).success).toBe(false)
  })
})

describe('asset, workflow and worker envelopes stay structurally validated', () => {
  it('requires a valid organization slug', () => {
    expect(OrganizationSchema.safeParse({ id: 'o', slug: 'Bad Slug', name: 'X', createdAt: 1 }).success).toBe(false)
    expect(OrganizationSchema.safeParse({ id: 'o', slug: 'star-sea', name: '星海', createdAt: 1 }).success).toBe(true)
  })

  it('rejects a workflow graph without nodes', () => {
    expect(WorkflowGraphSchema.safeParse({ nodes: [], edges: [] }).success).toBe(false)
  })

  it('requires a bounded worker envelope with a workspace reference', () => {
    const base = {
      jobId: 'job-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      requirementId: 'REQ-1',
      planId: 'plan-1',
      runId: 'run-1',
      workerId: 'worker-1',
      leaseToken: 'l'.repeat(40),
      fencing: 2,
      issuedAt: 1,
      expiresAt: 2,
      idempotencyKey: 'idem-key-1',
      allowedPaths: [],
      permittedToolIds: [],
      budget: { maxCalls: 1, maxCost: 0 },
      assetSnapshots: [],
      workspaceRef: 'ws-1',
    }
    expect(WorkerJobEnvelopeSchema.safeParse(base).success).toBe(true)
    expect(WorkerJobEnvelopeSchema.safeParse({ ...base, fencing: -1 }).success).toBe(false)
    expect(WorkerJobEnvelopeSchema.safeParse({ ...base, workspaceRef: '' }).success).toBe(false)
  })

  it('keeps project membership scoped to organization and project', () => {
    expect(ProjectMembershipSchema.safeParse({
      id: 'pm-1',
      organizationId: 'org-1',
      projectId: 'proj-1',
      accountId: 'acc-1',
      role: 'owner',
      createdAt: 1,
    }).success).toBe(true)
  })
})
