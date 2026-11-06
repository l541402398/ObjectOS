/** Additive migration 4: no credential or machine path is stored in a job. */
export const WORKER_JOBS_SCHEMA_SQL = `
CREATE TABLE organization_worker_jobs (
 id uuid PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id),
 project_id text NOT NULL, worker_id text NOT NULL REFERENCES organization_workers(id),
 grant_id text NOT NULL REFERENCES organization_worker_grants(id), requester_id text NOT NULL REFERENCES "user"(id),
 frozen jsonb NOT NULL, status text NOT NULL CHECK(status IN ('pending','running','completed','failed','cancelled','needs_reconciliation')),
 fencing integer NOT NULL DEFAULT 0, lease_hash text, lease_expires_at bigint,
 tool_calls integer NOT NULL DEFAULT 0, run_id text, created_at bigint NOT NULL, updated_at bigint NOT NULL,
 FOREIGN KEY(organization_id,project_id) REFERENCES organization_projects(organization_id,id)
);
CREATE INDEX organization_worker_jobs_scope ON organization_worker_jobs(organization_id,project_id,created_at DESC);
CREATE UNIQUE INDEX organization_worker_jobs_active_grant ON organization_worker_jobs(grant_id) WHERE status='running';
`
