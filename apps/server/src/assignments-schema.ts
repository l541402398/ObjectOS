/** Additive migration 7. Briefs and command/report history are immutable. */
export const ASSIGNMENTS_SCHEMA_SQL = `
CREATE TABLE organization_assignments (
  id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id), project_id text NOT NULL,
  dispatcher_id text NOT NULL REFERENCES "user"(id), assignee_id text NOT NULL REFERENCES "user"(id),
  brief jsonb NOT NULL CHECK(jsonb_typeof(brief)='object'), brief_checksum text NOT NULL CHECK(brief_checksum ~ '^[a-f0-9]{64}$'),
  creation_hash text NOT NULL CHECK(creation_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','in_progress','ready_for_review','completed','declined','cancelled','reassigned')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0), claim jsonb, latest_report_id text,
  replaces_id text UNIQUE REFERENCES organization_assignments(id), created_at bigint NOT NULL, updated_at bigint NOT NULL,
  FOREIGN KEY(organization_id,project_id) REFERENCES organization_projects(organization_id,id), UNIQUE(organization_id,id),
  CHECK(status NOT IN ('accepted','in_progress','ready_for_review','completed') OR claim IS NOT NULL)
);
CREATE INDEX organization_assignments_inbox ON organization_assignments(organization_id,assignee_id,created_at DESC);
CREATE TABLE organization_assignment_reports (
  id text PRIMARY KEY, organization_id text NOT NULL, assignment_id text NOT NULL, author_id text NOT NULL REFERENCES "user"(id),
  kind text NOT NULL CHECK(kind IN ('progress','delivery')), payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'), created_at bigint NOT NULL,
  FOREIGN KEY(organization_id,assignment_id) REFERENCES organization_assignments(organization_id,id), UNIQUE(assignment_id,id)
);
ALTER TABLE organization_assignments ADD FOREIGN KEY(id,latest_report_id) REFERENCES organization_assignment_reports(assignment_id,id);
CREATE TABLE organization_assignment_commands (
  id text PRIMARY KEY, organization_id text NOT NULL, assignment_id text NOT NULL, actor_id text NOT NULL REFERENCES "user"(id),
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'), action text NOT NULL, note text, receipt jsonb NOT NULL, created_at bigint NOT NULL,
  FOREIGN KEY(organization_id,assignment_id) REFERENCES organization_assignments(organization_id,id)
);
CREATE FUNCTION protect_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Assignment history deletion is forbidden'; END IF;
  IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.dispatcher_id,NEW.assignee_id,NEW.brief,NEW.brief_checksum,NEW.creation_hash,NEW.replaces_id,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.dispatcher_id,OLD.assignee_id,OLD.brief,OLD.brief_checksum,OLD.creation_hash,OLD.replaces_id,OLD.created_at)
    THEN RAISE EXCEPTION 'Assignment brief and ownership are immutable'; END IF;
  IF OLD.status IN ('completed','reassigned') OR (OLD.status IN ('declined','cancelled') AND NEW.status<>'reassigned') OR NEW.revision<>OLD.revision+1
    THEN RAISE EXCEPTION 'Assignment is terminal or has an invalid revision'; END IF;
  IF OLD.claim IS NOT NULL AND NEW.claim IS DISTINCT FROM OLD.claim THEN RAISE EXCEPTION 'Acceptance claim is immutable'; END IF;
  IF NEW.status='completed' AND OLD.status<>'ready_for_review' THEN RAISE EXCEPTION 'Independent delivery review is required'; END IF;
  IF NEW.status IN ('ready_for_review','completed') AND NOT EXISTS(SELECT 1 FROM organization_assignment_reports r
    WHERE r.assignment_id=NEW.id AND r.id=NEW.latest_report_id AND r.kind='delivery' AND r.author_id=NEW.assignee_id
      AND r.payload->'source'->>'kind'='desktop-owner-attested') THEN RAISE EXCEPTION 'Delivery report is required'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER assignment_immutable BEFORE UPDATE OR DELETE ON organization_assignments FOR EACH ROW EXECUTE FUNCTION protect_assignment();
CREATE FUNCTION protect_assignment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Assignment command and report history are immutable'; END; $$;
CREATE TRIGGER assignment_report_immutable BEFORE UPDATE OR DELETE ON organization_assignment_reports FOR EACH ROW EXECUTE FUNCTION protect_assignment_history();
CREATE TRIGGER assignment_command_immutable BEFORE UPDATE OR DELETE ON organization_assignment_commands FOR EACH ROW EXECUTE FUNCTION protect_assignment_history();
`
