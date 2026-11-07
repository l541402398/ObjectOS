/** Additive migration 5. Existing organization and asset migration bytes stay unchanged. */
export const KNOWLEDGE_SCHEMA_SQL = `
CREATE TABLE organization_knowledge_documents (
  id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  category text NOT NULL CHECK(category IN ('technical','business')),
  visibility text NOT NULL CHECK(visibility IN ('organization','project')), project_id text,
  created_by text NOT NULL REFERENCES "user"(id), created_at bigint NOT NULL,
  CHECK((visibility='project')=(project_id IS NOT NULL)), UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,project_id) REFERENCES organization_projects(organization_id,id)
);
CREATE TABLE organization_knowledge_versions (
  id text PRIMARY KEY, organization_id text NOT NULL, document_id text NOT NULL,
  version text NOT NULL CHECK(version ~ '^(0|[1-9][0-9]{0,5})[.](0|[1-9][0-9]{0,5})[.](0|[1-9][0-9]{0,5})$'),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 20000),
  tags jsonb NOT NULL CHECK(jsonb_typeof(tags)='array' AND jsonb_array_length(tags)<=16),
  checksum text NOT NULL CHECK(checksum ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','deprecated','revoked')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by text NOT NULL REFERENCES "user"(id), created_at bigint NOT NULL, published_at bigint,
  UNIQUE(document_id,version), UNIQUE(organization_id,document_id,id),
  FOREIGN KEY(organization_id,document_id) REFERENCES organization_knowledge_documents(organization_id,id),
  CHECK((status='draft')=(published_at IS NULL))
);
CREATE INDEX organization_knowledge_scope_idx ON organization_knowledge_documents(organization_id,project_id);
CREATE INDEX organization_knowledge_publication_idx ON organization_knowledge_versions(document_id,published_at DESC,id DESC);
CREATE FUNCTION protect_organization_knowledge_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Knowledge identity and visibility are immutable';
END;
$$;
CREATE TRIGGER organization_knowledge_document_immutable BEFORE UPDATE OR DELETE ON organization_knowledge_documents
FOR EACH ROW EXECUTE FUNCTION protect_organization_knowledge_document();
CREATE FUNCTION protect_organization_knowledge_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Knowledge history deletion is forbidden'; END IF;
  IF (NEW.id,NEW.organization_id,NEW.document_id,NEW.version,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.document_id,OLD.version,OLD.created_by,OLD.created_at)
    THEN RAISE EXCEPTION 'Knowledge version identity is immutable'; END IF;
  IF OLD.status<>'draft' AND (NEW.title,NEW.body,NEW.tags,NEW.checksum,NEW.published_at)
    IS DISTINCT FROM (OLD.title,OLD.body,OLD.tags,OLD.checksum,OLD.published_at)
    THEN RAISE EXCEPTION 'Published knowledge is immutable'; END IF;
  IF NOT ((OLD.status='draft' AND NEW.status IN ('draft','published'))
    OR (OLD.status='published' AND NEW.status IN ('deprecated','revoked'))
    OR (OLD.status='deprecated' AND NEW.status='revoked'))
    THEN RAISE EXCEPTION 'Invalid knowledge transition'; END IF;
  IF OLD.status='draft' AND NEW.status='published' AND (NEW.title,NEW.body,NEW.tags,NEW.checksum)
    IS DISTINCT FROM (OLD.title,OLD.body,OLD.tags,OLD.checksum)
    THEN RAISE EXCEPTION 'Publication must use the reviewed draft'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Knowledge revision must advance'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organization_knowledge_version_immutable BEFORE UPDATE OR DELETE ON organization_knowledge_versions
FOR EACH ROW EXECUTE FUNCTION protect_organization_knowledge_version();
`
