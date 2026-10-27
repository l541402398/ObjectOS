import { z } from 'zod'
import { IdSchema, TimestampSchema } from './common.js'

export const ResourceTypeSchema = z.enum(['host', 'kubernetes', 'pipeline', 'gitops'])
export type ResourceType = z.infer<typeof ResourceTypeSchema>

export const ResourceStatusSchema = z.enum(['active', 'disabled', 'archived'])
export type ResourceStatus = z.infer<typeof ResourceStatusSchema>

export const ResourceSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  type: ResourceTypeSchema,
  name: z.string().min(1).max(120),
  endpoint: z.string().max(500).default(''),
  purpose: z.string().max(500).default(''),
  labels: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  status: ResourceStatusSchema.default('active'),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type Resource = z.infer<typeof ResourceSchema>

export const ConnectionProfileSchema = z.object({
  id: IdSchema,
  resourceId: IdSchema,
  name: z.string().min(1).max(120),
  protocol: z.enum(['ssh', 'https', 'kubernetes', 'gitops']),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(120).default(''),
  authType: z.enum(['password', 'private_key', 'agent', 'token', 'kubeconfig']),
  credentialRef: IdSchema.nullable().default(null),
  hostKeyFingerprint: z.string().nullable().default(null),
  trustPolicy: z.enum(['pinned', 'first_use']).default('pinned'),
  connectTimeoutMs: z.number().int().min(1000).max(120000).default(15000),
  lastTestStatus: z.string().nullable().default(null),
  lastTestAt: TimestampSchema.nullable().default(null),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type ConnectionProfile = z.infer<typeof ConnectionProfileSchema>

export const CredentialMetadataSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  kind: z.enum(['ssh_password', 'ssh_private_key', 'api_token', 'kubeconfig', 'certificate']),
  label: z.string().min(1).max(120),
  status: z.enum(['active', 'disabled']).default('active'),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
export type CredentialMetadata = z.infer<typeof CredentialMetadataSchema>

export const ConnectionTestRunSchema = z.object({
  id: IdSchema,
  profileId: IdSchema,
  resourceId: IdSchema,
  status: z.enum(['connected', 'auth_failed', 'timeout', 'host_key_mismatch', 'host_key_untrusted', 'permission_denied', 'network_error', 'unsupported']),
  stage: z.string(),
  message: z.string(),
  latencyMs: z.number().int().nullable().default(null),
  details: z.record(z.string(), z.unknown()).default({}),
  createdAt: TimestampSchema,
})
export type ConnectionTestRun = z.infer<typeof ConnectionTestRunSchema>

export const ResourceOverviewSchema = z.object({
  resources: z.array(ResourceSchema),
  profiles: z.array(ConnectionProfileSchema),
  credentials: z.array(CredentialMetadataSchema),
  testRuns: z.array(ConnectionTestRunSchema),
})
export type ResourceOverview = z.infer<typeof ResourceOverviewSchema>

export const CreateResourceInputSchema = z.object({
  projectId: IdSchema,
  type: ResourceTypeSchema,
  name: z.string().min(1).max(120),
  endpoint: z.string().max(500).default(''),
  purpose: z.string().max(500).default(''),
  labels: z.array(z.string().max(40)).max(20).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
})
export type CreateResourceInput = z.infer<typeof CreateResourceInputSchema>

export const CreateConnectionProfileInputSchema = z.object({
  resourceId: IdSchema,
  name: z.string().min(1).max(120),
  protocol: z.enum(['ssh', 'https', 'kubernetes', 'gitops']),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(120).default(''),
  authType: z.enum(['password', 'private_key', 'agent', 'token', 'kubeconfig']),
  credentialRef: IdSchema.nullable().default(null),
  hostKeyFingerprint: z.string().nullable().default(null),
  trustPolicy: z.enum(['pinned', 'first_use']).default('pinned'),
  connectTimeoutMs: z.number().int().min(1000).max(120000).default(15000),
})
export type CreateConnectionProfileInput = z.infer<typeof CreateConnectionProfileInputSchema>
