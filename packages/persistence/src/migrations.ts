import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export interface Migration {
  version: number
  name: string
  sql: string
}

const V1 = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  root_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_stage TEXT NOT NULL DEFAULT 'ideation',
  version INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE project_stages (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  position INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, stage)
);

CREATE TABLE requirements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  source TEXT NOT NULL DEFAULT 'local',
  acceptance_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_requirements_project_status ON requirements(project_id, status);

CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_at INTEGER,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_milestones_project ON milestones(project_id, status);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES tasks(id),
  milestone_id TEXT REFERENCES milestones(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog',
  priority INTEGER NOT NULL DEFAULT 3,
  assignee_agent_id TEXT REFERENCES agents(id),
  acceptance_json TEXT NOT NULL DEFAULT '[]',
  labels_json TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_agent_id);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);

CREATE TABLE task_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  run_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (task_id, attempt_no)
);

CREATE TABLE task_leases (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  holder_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'builtin',
  driver_id TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  accent TEXT NOT NULL DEFAULT '#4C8DFF',
  system_prompt TEXT NOT NULL DEFAULT '',
  builtin INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE agent_instances (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_id TEXT,
  status TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_project ON sessions(project_id, updated_at DESC);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  run_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  UNIQUE (session_id, seq)
);
CREATE INDEX idx_messages_session_seq ON messages(session_id, seq);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id),
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'created',
  error TEXT,
  summary TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  checkpoint_id TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_runs_project ON agent_runs(project_id, created_at DESC);
CREATE INDEX idx_runs_task ON agent_runs(task_id, created_at DESC);
CREATE INDEX idx_runs_status ON agent_runs(status);

CREATE TABLE run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  title TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  UNIQUE (run_id, seq)
);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (run_id, seq)
);

CREATE TABLE project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  UNIQUE (project_id, seq)
);
CREATE INDEX idx_events_project_seq ON project_events(project_id, seq DESC);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES project_events(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (event_id, destination)
);
CREATE INDEX idx_outbox_pending ON outbox(status, next_attempt_at);

CREATE TABLE agent_inbox (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recipient_agent_id TEXT NOT NULL REFERENCES agents(id),
  recipient_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'delivered',
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  accepted_at INTEGER,
  completed_at INTEGER,
  UNIQUE (project_id, idempotency_key)
);
CREATE INDEX idx_inbox_recipient ON agent_inbox(recipient_session_id, created_at DESC);

CREATE TABLE handoffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_agent_id TEXT NOT NULL REFERENCES agents(id),
  from_session_id TEXT NOT NULL REFERENCES sessions(id),
  to_agent_id TEXT NOT NULL REFERENCES agents(id),
  to_session_id TEXT REFERENCES sessions(id),
  status TEXT NOT NULL DEFAULT 'requested',
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  requested_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  UNIQUE (run_id, idempotency_key)
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_call_id TEXT REFERENCES tool_calls(id),
  status TEXT NOT NULL DEFAULT 'pending',
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  request_json TEXT NOT NULL DEFAULT '{}',
  decision TEXT,
  requested_at INTEGER NOT NULL,
  decided_at INTEGER,
  expires_at INTEGER
);
CREATE INDEX idx_approvals_status ON approvals(status, requested_at DESC);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  uri TEXT,
  content_hash TEXT,
  git_commit TEXT,
  verified_at INTEGER,
  body TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_artifacts_project ON artifacts(project_id, created_at DESC);
CREATE INDEX idx_artifacts_task ON artifacts(task_id);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'proposed',
  supersedes_id TEXT REFERENCES decisions(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE knowledge_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_uri TEXT,
  source_version TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE plugin_installations (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  installed_at INTEGER NOT NULL
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`

const V2 = `
CREATE TABLE ai_connection_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  backend_kind TEXT NOT NULL DEFAULT 'native-llm',
  provider_id TEXT NOT NULL DEFAULT 'custom',
  protocol TEXT NOT NULL DEFAULT 'openai-chat',
  base_url TEXT NOT NULL DEFAULT '',
  default_model_id TEXT,
  secret_ref TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  temperature REAL NOT NULL DEFAULT 0.2,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_ai_connection_default ON ai_connection_profiles(is_default) WHERE is_default = 1;
CREATE INDEX idx_ai_connection_enabled ON ai_connection_profiles(enabled, updated_at DESC);

CREATE TABLE ai_models (
  connection_id TEXT NOT NULL REFERENCES ai_connection_profiles(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  context_window INTEGER,
  max_output_tokens INTEGER,
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (connection_id, model_id)
);
CREATE INDEX idx_ai_models_connection ON ai_models(connection_id, updated_at DESC);

CREATE TABLE ai_connection_checks (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES ai_connection_profiles(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  error_code TEXT,
  message TEXT NOT NULL DEFAULT '',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER NOT NULL
);
CREATE INDEX idx_ai_checks_connection ON ai_connection_checks(connection_id, checked_at DESC);

CREATE TABLE ai_usage_records (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  connection_id TEXT,
  model_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  usage_source TEXT NOT NULL DEFAULT 'unknown',
  estimated_cost REAL,
  currency TEXT,
  pricing_version TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (run_id, connection_id, model_id)
);

CREATE TABLE agent_backend_bindings (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT,
  agent_role TEXT,
  task_type TEXT,
  connection_id TEXT REFERENCES ai_connection_profiles(id) ON DELETE SET NULL,
  model_id TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_agent_backend_bindings_scope ON agent_backend_bindings(scope_type, scope_id, priority DESC);

CREATE TABLE external_agent_installations (
  adapter_id TEXT PRIMARY KEY,
  executable_path TEXT,
  detected_version TEXT,
  auth_state TEXT NOT NULL DEFAULT 'unknown',
  last_checked_at INTEGER NOT NULL
);
`

const V3 = `
CREATE TABLE project_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  git_head TEXT,
  payload_json TEXT NOT NULL,
  index_version INTEGER NOT NULL,
  scanned_at INTEGER NOT NULL
);
CREATE INDEX idx_project_snapshots_project ON project_snapshots(project_id, scanned_at DESC);

CREATE TABLE plan_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  goal TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  approved_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (project_id, revision)
);
CREATE INDEX idx_plan_revisions_project ON plan_revisions(project_id, revision DESC);

CREATE TABLE graph_layouts (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  view_id TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, view_id)
);
`

const V4 = `
CREATE VIRTUAL TABLE knowledge_fts USING fts5(
  title,
  body,
  content='knowledge_entries',
  content_rowid='rowid'
);

INSERT INTO knowledge_fts(rowid, title, body)
SELECT rowid, title, body FROM knowledge_entries;

CREATE TRIGGER knowledge_fts_ai AFTER INSERT ON knowledge_entries BEGIN
  INSERT INTO knowledge_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

CREATE TRIGGER knowledge_fts_ad AFTER DELETE ON knowledge_entries BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, body)
  VALUES ('delete', old.rowid, old.title, old.body);
END;

CREATE TRIGGER knowledge_fts_au AFTER UPDATE ON knowledge_entries BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, title, body)
  VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO knowledge_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
`

const V5 = `
CREATE TABLE ai_model_prices (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES ai_connection_profiles(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  input_per_million REAL NOT NULL DEFAULT 0,
  output_per_million REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  version TEXT NOT NULL DEFAULT 'v1',
  effective_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(connection_id, model_id)
);
CREATE INDEX idx_ai_model_prices_connection ON ai_model_prices(connection_id);
`

const V6 = `
CREATE TABLE project_budgets (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  soft_limit REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  updated_at INTEGER NOT NULL
);
`

const V7 = `
ALTER TABLE agent_backend_bindings ADD COLUMN required_capabilities_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agent_backend_bindings ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agent_backend_bindings ADD COLUMN budget_limit REAL;
ALTER TABLE agent_backend_bindings ADD COLUMN failure_policy TEXT NOT NULL DEFAULT 'fallback';
`

const V8 = `
CREATE TABLE health_check_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  check_id TEXT NOT NULL,
  source_revision TEXT,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  result_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_health_project_time ON health_check_runs(project_id, started_at DESC);

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE(project_id, fingerprint)
);

CREATE TABLE finding_evidence (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  check_run_id TEXT REFERENCES health_check_runs(id),
  source_uri TEXT,
  source_revision TEXT,
  excerpt TEXT,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE repair_proposals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  acceptance_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE proposal_findings (
  proposal_id TEXT NOT NULL REFERENCES repair_proposals(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  PRIMARY KEY(proposal_id, finding_id)
);

CREATE TABLE autonomy_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'observe',
  updated_at INTEGER NOT NULL
);
`

const V9 = `ALTER TABLE repair_proposals ADD COLUMN repair_plan_id TEXT;`

const V10 = `
CREATE TABLE automation_triggers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0,
  next_run_at INTEGER,
  UNIQUE(project_id, kind)
);
`

const V11 = `
CREATE TABLE automation_grants (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  allowed_actions_json TEXT NOT NULL DEFAULT '[]',
  allowed_paths_json TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER NOT NULL,
  max_runs INTEGER NOT NULL DEFAULT 1,
  used_runs INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER,
  updated_at INTEGER NOT NULL
);
`

const V12 = `
CREATE TABLE automation_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('checks','repair')),
  source TEXT NOT NULL,
  proposal_id TEXT REFERENCES repair_proposals(id) ON DELETE SET NULL,
  plan_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed','cancelled','reconciliation_required')),
  attempt INTEGER NOT NULL DEFAULT 1,
  lease_token INTEGER NOT NULL,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX idx_automation_runs_project ON automation_runs(project_id, started_at DESC);
CREATE INDEX idx_automation_runs_status ON automation_runs(status);
CREATE TABLE automation_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_automation_run_events_run ON automation_run_events(run_id, created_at);
ALTER TABLE automation_grants ADD COLUMN issued_at INTEGER;
`

const V13 = `
ALTER TABLE agents ADD COLUMN category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE agents ADD COLUMN visibility TEXT NOT NULL DEFAULT 'project';
ALTER TABLE agents ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE agents ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN persona_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agents ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE agents ADD COLUMN current_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE agent_config_versions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(agent_id, version)
);
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '1.0.0',
  source TEXT NOT NULL DEFAULT 'local',
  content TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE agent_skill_bindings (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(agent_id, skill_id)
);
CREATE TABLE runtime_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  executable TEXT,
  endpoint TEXT,
  args_json TEXT NOT NULL DEFAULT '[]',
  auth_ref TEXT,
  model_ref TEXT,
  options_json TEXT NOT NULL DEFAULT '{}',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'unknown',
  version TEXT,
  source TEXT NOT NULL DEFAULT 'custom',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE agent_runtime_bindings (
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES runtime_profiles(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(agent_id, profile_id)
);
`

const V15 = `
ALTER TABLE autonomy_settings ADD COLUMN repair_agent_id TEXT;
`

const V16 = `
ALTER TABLE tasks ADD COLUMN expected_artifacts_json TEXT NOT NULL DEFAULT '[]';
`

const V17 = `
ALTER TABLE artifacts ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
`

const V18 = `
ALTER TABLE agent_inbox ADD COLUMN priority INTEGER NOT NULL DEFAULT 3;
ALTER TABLE agent_inbox ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
`

const V19 = `
CREATE TABLE agent_execution_slots (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL DEFAULT 1,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_agent_execution_slots_expiry ON agent_execution_slots(expires_at);
`

const V20 = `
ALTER TABLE agent_runs ADD COLUMN deadline_at INTEGER;
ALTER TABLE agent_runs ADD COLUMN budget_json TEXT NOT NULL DEFAULT '{}';
`

const V21 = `
CREATE TABLE run_file_changes (
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  change_type TEXT NOT NULL,
  baseline_hash TEXT,
  after_hash TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, path)
);
CREATE INDEX idx_run_file_changes_path ON run_file_changes(path);
`

const V22 = `
CREATE TABLE plan_execution_grants (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plan_revisions(id) ON DELETE CASCADE,
  plan_revision INTEGER NOT NULL,
  plan_fingerprint TEXT NOT NULL,
  actor_kind TEXT NOT NULL DEFAULT 'user',
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actions_json TEXT NOT NULL DEFAULT '[]',
  allowed_paths_json TEXT NOT NULL DEFAULT '[]',
  allowed_task_ids_json TEXT NOT NULL DEFAULT '[]',
  allowed_agent_ids_json TEXT NOT NULL DEFAULT '[]',
  max_runs INTEGER NOT NULL DEFAULT 1,
  used_runs INTEGER NOT NULL DEFAULT 0,
  max_tool_calls INTEGER NOT NULL DEFAULT 40,
  used_tool_calls INTEGER NOT NULL DEFAULT 0,
  allow_over_budget INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoked_reason TEXT,
  last_used_at INTEGER
);
CREATE INDEX idx_plan_grants_plan ON plan_execution_grants(plan_id, issued_at DESC);
CREATE INDEX idx_plan_grants_project ON plan_execution_grants(project_id, issued_at DESC);

CREATE TABLE planner_usage_records (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id TEXT,
  plan_revision INTEGER,
  attempt INTEGER NOT NULL,
  connection_id TEXT,
  model_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  usage_source TEXT NOT NULL DEFAULT 'unknown',
  estimated_cost REAL,
  currency TEXT,
  pricing_version TEXT,
  outcome TEXT NOT NULL DEFAULT 'unknown',
  created_at INTEGER NOT NULL,
  UNIQUE (request_id, attempt)
);
CREATE INDEX idx_planner_usage_project ON planner_usage_records(project_id, created_at DESC);
CREATE INDEX idx_planner_usage_plan ON planner_usage_records(plan_id, created_at DESC);
`

const V24 = `
ALTER TABLE plan_replan_proposals ADD COLUMN source_fingerprint TEXT NOT NULL DEFAULT '';
ALTER TABLE plan_replan_proposals ADD COLUMN source_run_count INTEGER NOT NULL DEFAULT 0;
`

const V23 = `
ALTER TABLE plan_execution_grants ADD COLUMN reserved_runs INTEGER NOT NULL DEFAULT 0;

CREATE TABLE plan_grant_start_reservations (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES plan_execution_grants(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL,
  plan_fingerprint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  reserved_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  error TEXT,
  run_ids_json TEXT NOT NULL DEFAULT '[]',
  UNIQUE (grant_id, idempotency_key)
);
CREATE INDEX idx_plan_grant_reservations_status ON plan_grant_start_reservations(status, reserved_at);

CREATE TABLE plan_replan_proposals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plan_revisions(id) ON DELETE CASCADE,
  source_revision INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  reason TEXT NOT NULL DEFAULT '',
  decided_reason TEXT,
  context_chars INTEGER NOT NULL DEFAULT 0,
  context_json TEXT NOT NULL DEFAULT '[]',
  proposed_tasks_json TEXT NOT NULL DEFAULT '[]',
  proposed_assumptions_json TEXT NOT NULL DEFAULT '[]',
  proposed_risks_json TEXT NOT NULL DEFAULT '[]',
  diff_json TEXT NOT NULL DEFAULT '{}',
  grant_impact_json TEXT NOT NULL DEFAULT '{}',
  generation_json TEXT,
  error TEXT,
  requested_by TEXT NOT NULL DEFAULT 'local-user',
  requested_at INTEGER NOT NULL,
  decided_at INTEGER,
  applied_plan_id TEXT REFERENCES plan_revisions(id),
  model_calls INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_replan_proposals_plan ON plan_replan_proposals(plan_id, requested_at DESC);
CREATE INDEX idx_replan_proposals_status ON plan_replan_proposals(status, requested_at DESC);
`

const V14 = `
CREATE TABLE run_snapshots (
  run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  schema_version INTEGER NOT NULL DEFAULT 1,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_run_snapshots_agent ON run_snapshots(agent_id);
`

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'initial lifecycle schema', sql: V1 },
  { version: 2, name: 'ai connections and model catalog', sql: V2 },
  { version: 3, name: 'project snapshots plans and graph layouts', sql: V3 },
  { version: 4, name: 'knowledge full text index', sql: V4 },
  { version: 5, name: 'ai model pricing', sql: V5 },
  { version: 6, name: 'project soft budgets', sql: V6 },
  { version: 7, name: 'agent routing policy', sql: V7 },
  { version: 8, name: 'operations health findings and proposals', sql: V8 },
  { version: 9, name: 'proposal repair plan', sql: V9 },
  { version: 10, name: 'operations interval triggers', sql: V10 },
  { version: 11, name: 'automation grants', sql: V11 },
  { version: 12, name: 'automation runs and audit events', sql: V12 },
  { version: 13, name: 'agent definitions skills and runtime profiles', sql: V13 },
  { version: 14, name: 'frozen run configuration snapshots', sql: V14 },
  { version: 15, name: 'autonomy repair agent assignment', sql: V15 },
  { version: 16, name: 'task expected artifacts for completion evidence', sql: V16 },
  { version: 17, name: 'structured artifact metadata for design and review evidence', sql: V17 },
  { version: 18, name: 'inbox priority and retry backoff', sql: V18 },
  { version: 19, name: 'atomic global agent execution slots', sql: V19 },
  { version: 20, name: 'persisted run wall-clock deadline and budgets', sql: V20 },
  { version: 21, name: 'per-run attributed file changes', sql: V21 },
  { version: 22, name: 'plan execution grants and planner usage', sql: V22 },
  { version: 23, name: 'grant start reservations and replan proposals', sql: V23 },
  { version: 24, name: 'replan proposal source state', sql: V24 },
]

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex')
}

export function applyMigrations(db: DatabaseSync, log: (message: string) => void = () => {}): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`)
  const applied = new Map<number, string>()
  for (const row of db.prepare('SELECT version, checksum FROM schema_migrations').all() as Array<{
    version: number
    checksum: string
  }>) {
    applied.set(Number(row.version), String(row.checksum))
  }
  for (const migration of MIGRATIONS) {
    const expected = checksum(migration.sql)
    const existing = applied.get(migration.version)
    if (existing) {
      if (existing !== expected) {
        throw new Error(
          `Database migration ${migration.version} checksum mismatch; refusing to mutate an incompatible database`,
        )
      }
      continue
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration.sql)
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(migration.version, migration.name, expected, Date.now())
      db.exec('COMMIT')
      log(`applied migration ${migration.version}: ${migration.name}`)
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
