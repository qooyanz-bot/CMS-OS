BEGIN;

-- 公開4ロールの互換名candidateを残しつつ、正式なrecruiterをDBでも受け入れる。
DO $$
DECLARE
  table_name TEXT;
  constraint_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['cms_role_assignments', 'cms_sessions'] LOOP
    IF to_regclass(table_name) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT conname
      INTO constraint_name
      FROM pg_constraint
     WHERE conrelid = to_regclass(table_name)
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%';

    IF constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', table_name, constraint_name);
    END IF;

    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (role IN (''user'', ''orderer'', ''provider'', ''recruiter'', ''candidate''))',
      table_name,
      table_name || '_role_check'
    );
  END LOOP;
END $$;

ALTER TABLE IF EXISTS cms_contents
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'ja',
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS series TEXT,
  ADD COLUMN IF NOT EXISTS authors JSONB,
  ADD COLUMN IF NOT EXISTS blocks JSONB,
  ADD COLUMN IF NOT EXISTS structured_data JSONB,
  ADD COLUMN IF NOT EXISTS source_evidence JSONB,
  ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reading_time_minutes INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS current_version_id TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

ALTER TABLE IF EXISTS cms_content_proposals
  ADD COLUMN IF NOT EXISTS generation_audit JSONB;

ALTER TABLE IF EXISTS cms_content_versions
  ADD COLUMN IF NOT EXISTS id TEXT,
  ADD COLUMN IF NOT EXISTS summary TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'ja',
  ADD COLUMN IF NOT EXISTS translation_of JSONB,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS series TEXT,
  ADD COLUMN IF NOT EXISTS authors JSONB,
  ADD COLUMN IF NOT EXISTS blocks JSONB,
  ADD COLUMN IF NOT EXISTS structured_data JSONB,
  ADD COLUMN IF NOT EXISTS source_evidence JSONB,
  ADD COLUMN IF NOT EXISTS media_ids JSONB,
  ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reading_time_minutes INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT 'migrated',
  ADD COLUMN IF NOT EXISTS actor_id TEXT,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS generation_audit JSONB;

CREATE TABLE IF NOT EXISTS cms_content_internal_role_assignments (
  assignment_id TEXT PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
  account_id TEXT NOT NULL REFERENCES cms_accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('enterprise_admin', 'tenant_admin', 'editor', 'hr', 'pr', 'ir', 'legal_reviewer', 'approver', 'publisher', 'partner_editor', 'partner_viewer')),
  category TEXT NOT NULL CHECK (category IN ('legal', 'beauty', 'ai-business', 'labor-shortage', 'tourism', 'mobility-dx', 'gx', 'regional-revitalization', '*')),
  provider_id TEXT REFERENCES cms_providers(id),
  organization_id TEXT
);

UPDATE cms_contents
   SET tags = CASE WHEN jsonb_typeof(tags) = 'array' THEN tags ELSE '[]'::jsonb END,
       reading_time_minutes = GREATEST(1, COALESCE(reading_time_minutes, 1)),
       visibility = CASE WHEN visibility IN ('public', 'unlisted', 'private', 'internal') THEN visibility ELSE 'public' END;

UPDATE cms_content_versions
   SET id = 'content-version-' || content_id || '-' || version
 WHERE id IS NULL;

UPDATE cms_content_versions
   SET tags = CASE WHEN jsonb_typeof(tags) = 'array' THEN tags ELSE '[]'::jsonb END,
       reading_time_minutes = GREATEST(1, COALESCE(reading_time_minutes, 1)),
       visibility = CASE WHEN visibility IN ('public', 'unlisted', 'private', 'internal') THEN visibility ELSE 'public' END;

UPDATE cms_contents AS content
   SET current_version_id = latest.id
  FROM (
    SELECT DISTINCT ON (content_id) content_id, id
      FROM cms_content_versions
     ORDER BY content_id, version DESC
  ) AS latest
 WHERE content.id = latest.content_id
   AND content.current_version_id IS NULL;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  IF to_regclass('cms_contents') IS NOT NULL THEN
    SELECT conname
      INTO constraint_name
      FROM pg_constraint
     WHERE conrelid = to_regclass('cms_contents')
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%';
    IF constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE cms_contents DROP CONSTRAINT %I', constraint_name);
    END IF;
    ALTER TABLE cms_contents
      DROP CONSTRAINT IF EXISTS cms_contents_status_check,
      DROP CONSTRAINT IF EXISTS cms_contents_visibility_check,
      DROP CONSTRAINT IF EXISTS cms_contents_reading_time_check;
    ALTER TABLE cms_contents
      ADD CONSTRAINT cms_contents_status_check
      CHECK (status IN ('proposed', 'drafted', 'polished', 'seo_reviewed', 'review_requested', 'changes_requested', 'approved', 'published', 'archived'));
    ALTER TABLE cms_contents
      ADD CONSTRAINT cms_contents_visibility_check
      CHECK (visibility IN ('public', 'unlisted', 'private', 'internal'));
    ALTER TABLE cms_contents
      ADD CONSTRAINT cms_contents_reading_time_check
      CHECK (reading_time_minutes >= 1);
  END IF;

  IF to_regclass('cms_content_versions') IS NOT NULL THEN
    ALTER TABLE cms_content_versions
      DROP CONSTRAINT IF EXISTS cms_content_versions_visibility_check,
      DROP CONSTRAINT IF EXISTS cms_content_versions_reading_time_check;
    ALTER TABLE cms_content_versions
      ADD CONSTRAINT cms_content_versions_visibility_check
      CHECK (visibility IN ('public', 'unlisted', 'private', 'internal'));
    ALTER TABLE cms_content_versions
      ADD CONSTRAINT cms_content_versions_reading_time_check
      CHECK (reading_time_minutes >= 1);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS cms_content_versions_id_idx ON cms_content_versions (id);
CREATE INDEX IF NOT EXISTS cms_contents_metadata_idx ON cms_contents (provider_id, content_type, locale, visibility, featured);
CREATE INDEX IF NOT EXISTS cms_contents_published_idx ON cms_contents (status, published_at, expires_at);

COMMIT;
