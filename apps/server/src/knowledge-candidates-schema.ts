/** Additive migration 6: immutable candidates and atomic reviewed publication receipts. */
export const KNOWLEDGE_CANDIDATES_SCHEMA_SQL = `
CREATE TABLE organization_knowledge_candidates (
  id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id), project_id text NOT NULL,
  author_id text NOT NULL REFERENCES "user"(id), category text NOT NULL CHECK(category IN ('technical','business')),
  content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'), source jsonb NOT NULL CHECK(jsonb_typeof(source)='object'),
  checksum text NOT NULL CHECK(checksum ~ '^sha256:[a-f0-9]{64}$'), payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  acceptance_id text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','returned','published')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at bigint NOT NULL,
  reviewer_id text REFERENCES "user"(id), reviewed_at bigint, review_note text,
  decision_id text, decision_hash text, publication jsonb,
  FOREIGN KEY(organization_id,project_id) REFERENCES organization_projects(organization_id,id),
  UNIQUE(organization_id,author_id,project_id,acceptance_id,checksum),
  CHECK ((status='pending')=(reviewer_id IS NULL AND reviewed_at IS NULL AND decision_id IS NULL)),
  CHECK (status='pending' OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND decision_id IS NOT NULL
    AND decision_hash IS NOT NULL AND decision_hash ~ '^[a-f0-9]{64}$' AND review_note IS NOT NULL AND length(review_note) BETWEEN 8 AND 2000)),
  CHECK ((status='published')=(publication IS NOT NULL))
);
CREATE INDEX organization_knowledge_candidates_scope ON organization_knowledge_candidates(organization_id,project_id,created_at DESC);
CREATE FUNCTION protect_knowledge_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Candidate history deletion is forbidden'; END IF;
  IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.author_id,NEW.category,NEW.content,NEW.source,NEW.checksum,NEW.payload_hash,NEW.acceptance_id,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.author_id,OLD.category,OLD.content,OLD.source,OLD.checksum,OLD.payload_hash,OLD.acceptance_id,OLD.created_at)
    THEN RAISE EXCEPTION 'Candidate content and provenance are immutable'; END IF;
  IF OLD.status<>'pending' OR NEW.status NOT IN ('returned','published') OR NEW.revision<>OLD.revision+1
    THEN RAISE EXCEPTION 'Invalid candidate decision'; END IF;
  IF NEW.status='published' AND NOT EXISTS(SELECT 1 FROM organization_knowledge_versions v
    JOIN organization_knowledge_documents d ON d.organization_id=v.organization_id AND d.id=v.document_id
    WHERE d.organization_id=NEW.organization_id AND d.project_id=NEW.project_id AND d.category=NEW.category
    AND v.id=NEW.publication->>'versionId' AND d.id=NEW.publication->>'documentId'
    AND v.version=NEW.publication->>'version' AND v.checksum=NEW.checksum
    AND v.checksum=NEW.publication->>'checksum' AND v.status='published')
    THEN RAISE EXCEPTION 'Publication must reference the exact reviewed project knowledge'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER knowledge_candidate_immutable BEFORE UPDATE OR DELETE ON organization_knowledge_candidates
FOR EACH ROW EXECUTE FUNCTION protect_knowledge_candidate();
`
