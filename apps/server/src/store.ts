/**
 * A0 PoC organization-scoped project / requirement store.
 *
 * WHAT THIS IS
 * ------------
 * A deliberately small in-memory store used only by the isolated A0 organization auth PoC. Every
 * record carries an explicit `organizationId` and (where applicable) `projectId`, so that route
 * handlers are forced to filter by tenant scope instead of trusting a path parameter.
 *
 * WHAT THIS IS NOT
 * ----------------
 * This is **not** the A1 persistence layer. There is no PostgreSQL, no Drizzle schema, no migration,
 * no transaction, no row-level security and no durability: a process restart loses everything. In
 * A1/A2 this file is replaced by PostgreSQL + Drizzle migrations where:
 *   - `projects` and `requirements` are real tables with `organization_id` / `project_id` foreign
 *     keys and NOT NULL constraints,
 *   - tenant isolation is additionally enforced by database-level policies (RLS) and by
 *     organization-scoped queries in the repository layer,
 *   - writes happen inside transactions with optimistic concurrency, not array pushes.
 * The function signatures below are intentionally shaped like a future repository so the swap is a
 * re-implementation rather than a route rewrite. Nothing here is safe for concurrent production
 * traffic.
 */
import { randomUUID } from 'node:crypto'
import type { Project, ProjectMembership, ProjectRole } from '@projectos/organization-contracts'

/** A shared project record (contract-shape minus timestamps owned by the store). */
export interface StoredProject extends Project {}

/** Requirement owned by exactly one organization and one project. */
export interface StoredRequirement {
  id: string
  organizationId: string
  projectId: string
  title: string
  status: 'draft' | 'ready' | 'in_progress' | 'done'
  createdAt: number
  updatedAt: number
}

/** Project-level membership. An organization role never implies a project role. */
export interface StoredProjectMembership extends ProjectMembership {}

export interface Store {
  projects: StoredProject[]
  requirements: StoredRequirement[]
  projectMemberships: StoredProjectMembership[]
}

export interface CreateProjectInput {
  organizationId: string
  key: string
  name: string
  description?: string
  createdByAccountId: string
}

export interface CreateRequirementInput {
  organizationId: string
  projectId: string
  title: string
}

/** Fresh store per server instance, so tests never share state. */
export function createStore(): Store {
  return { projects: [], requirements: [], projectMemberships: [] }
}

export function createProject(store: Store, input: CreateProjectInput): StoredProject {
  const now = Date.now()
  const project: StoredProject = {
    id: randomUUID(),
    organizationId: input.organizationId,
    key: input.key,
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  store.projects.push(project)
  addProjectMembership(store, {
    organizationId: input.organizationId,
    projectId: project.id,
    accountId: input.createdByAccountId,
    role: 'owner',
  })
  return project
}

export function listProjectsForOrganization(store: Store, organizationId: string): StoredProject[] {
  return store.projects.filter((project) => project.organizationId === organizationId)
}

export function findProject(store: Store, projectId: string): StoredProject | undefined {
  return store.projects.find((project) => project.id === projectId)
}

export function addProjectMembership(
  store: Store,
  input: {
    organizationId: string
    projectId: string
    accountId: string
    role: ProjectRole
  },
): StoredProjectMembership {
  const membership: StoredProjectMembership = {
    id: randomUUID(),
    organizationId: input.organizationId,
    projectId: input.projectId,
    accountId: input.accountId,
    role: input.role,
    createdAt: Date.now(),
  }
  store.projectMemberships.push(membership)
  return membership
}

export function projectMembershipsOf(store: Store, projectId: string): StoredProjectMembership[] {
  return store.projectMemberships.filter((membership) => membership.projectId === projectId)
}

export function createRequirement(
  store: Store,
  input: CreateRequirementInput,
): StoredRequirement {
  const now = Date.now()
  const requirement: StoredRequirement = {
    id: randomUUID(),
    organizationId: input.organizationId,
    projectId: input.projectId,
    title: input.title,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
  store.requirements.push(requirement)
  return requirement
}

/** Always scoped by project *and* organization so a leaked project id cannot cross tenants. */
export function listRequirementsForProject(
  store: Store,
  organizationId: string,
  projectId: string,
): StoredRequirement[] {
  return store.requirements.filter(
    (requirement) =>
      requirement.projectId === projectId && requirement.organizationId === organizationId,
  )
}
