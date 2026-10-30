/** Additive migration 2. Never edit migration 1 to install the asset catalog. */
export const ASSETS_SCHEMA_SQL = `
CREATE TABLE organization_assets (
  id text PRIMARY KEY, organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name text NOT NULL, kind text NOT NULL CHECK(kind IN ('agent','skill','mcp','tool')),
  visibility text NOT NULL CHECK(visibility IN ('organization','project')), project_id text,
  created_by text NOT NULL REFERENCES "user"(id), created_at bigint NOT NULL,
  CHECK ((visibility='project')=(project_id IS NOT NULL)),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,project_id) REFERENCES organization_projects(organization_id,id)
);
CREATE TABLE organization_asset_versions (
  id text PRIMARY KEY, organization_id text NOT NULL, asset_id text NOT NULL, version text NOT NULL,
  definition jsonb NOT NULL, checksum text NOT NULL, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  status text NOT NULL CHECK(status IN ('draft','published','deprecated','revoked')),
  created_by text NOT NULL REFERENCES "user"(id), created_at bigint NOT NULL, published_at bigint,
  UNIQUE(asset_id,version), UNIQUE(organization_id,asset_id,id),
  FOREIGN KEY(organization_id,asset_id) REFERENCES organization_assets(organization_id,id),
  CHECK(checksum ~ '^sha256:[a-f0-9]{64}$'),
  CHECK((status='draft')=(published_at IS NULL))
);
CREATE INDEX organization_asset_versions_asset_idx ON organization_asset_versions(asset_id,created_at DESC,id);
CREATE TABLE organization_asset_bindings (
  organization_id text NOT NULL, project_id text NOT NULL, asset_id text NOT NULL, version_id text NOT NULL,
  updated_by text NOT NULL REFERENCES "user"(id), updated_at bigint NOT NULL,
  PRIMARY KEY(organization_id,project_id,asset_id),
  FOREIGN KEY(organization_id,project_id) REFERENCES organization_projects(organization_id,id),
  FOREIGN KEY(organization_id,asset_id,version_id) REFERENCES organization_asset_versions(organization_id,asset_id,id)
);
CREATE FUNCTION protect_organization_asset_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Asset version deletion is forbidden'; END IF;
  IF (NEW.id,NEW.organization_id,NEW.asset_id,NEW.version,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.asset_id,OLD.version,OLD.created_by,OLD.created_at)
    THEN RAISE EXCEPTION 'Asset identity is immutable'; END IF;
  IF OLD.status<>'draft' AND (NEW.definition,NEW.checksum,NEW.published_at)
    IS DISTINCT FROM (OLD.definition,OLD.checksum,OLD.published_at)
    THEN RAISE EXCEPTION 'Published definition is immutable'; END IF;
  IF NOT ((OLD.status='draft' AND NEW.status IN ('draft','published'))
    OR (OLD.status='published' AND NEW.status IN ('deprecated','revoked'))
    OR (OLD.status='deprecated' AND NEW.status='revoked'))
    THEN RAISE EXCEPTION 'Invalid asset lifecycle transition'; END IF;
  IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Asset revision must advance'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organization_asset_version_immutable BEFORE UPDATE OR DELETE ON organization_asset_versions
FOR EACH ROW EXECUTE FUNCTION protect_organization_asset_version();
`
