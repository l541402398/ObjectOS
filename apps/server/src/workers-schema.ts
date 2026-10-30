/** Additive migration 3. No absolute machine paths or device secrets belong here. */
export const WORKERS_SCHEMA_SQL = `
CREATE TABLE organization_workers (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES "user"(id),
  desktop_session_hash text NOT NULL REFERENCES desktop_sessions(token_hash),
  instance_id text NOT NULL,
  secret_hash text NOT NULL CHECK(length(secret_hash)=64),
  name text NOT NULL, platform text NOT NULL CHECK(platform IN ('win32','darwin','linux')),
  protocol text NOT NULL CHECK(protocol='local-worker/1'),
  state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused','revoked')),
  revision integer NOT NULL DEFAULT 1,
  last_seen_at bigint, created_at bigint NOT NULL,
  UNIQUE(organization_id,id)
);
CREATE INDEX organization_workers_scope_idx ON organization_workers(organization_id,created_at);
CREATE TABLE organization_worker_grants (
  id text PRIMARY KEY, organization_id text NOT NULL, worker_id text NOT NULL,
  project_id text NOT NULL, workspace_ref text NOT NULL,
  scope jsonb NOT NULL, scope_digest text NOT NULL CHECK(length(scope_digest)=64),
  expires_at bigint NOT NULL, created_at bigint NOT NULL, revoked_at bigint,
  FOREIGN KEY(organization_id,worker_id) REFERENCES organization_workers(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,project_id) REFERENCES organization_projects(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX organization_worker_grants_worker_idx ON organization_worker_grants(worker_id,created_at);
`
