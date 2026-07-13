BEGIN;

CREATE TABLE IF NOT EXISTS cms_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  provider_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_providers (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('legal', 'beauty', 'ai-business', 'labor-shortage', 'tourism', 'mobility-dx', 'gx', 'regional-revitalization')),
  name TEXT NOT NULL,
  themes JSONB NOT NULL DEFAULT '[]'::jsonb,
  location TEXT NOT NULL,
  public_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  orderer_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  candidate_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cms_accounts
  ADD CONSTRAINT cms_accounts_provider_fk
  FOREIGN KEY (provider_id) REFERENCES cms_providers(id);

CREATE TABLE IF NOT EXISTS cms_role_assignments (
  account_id TEXT NOT NULL REFERENCES cms_accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'orderer', 'provider', 'candidate')),
  category TEXT NOT NULL CHECK (category IN ('legal', 'beauty', 'ai-business', 'labor-shortage', 'tourism', 'mobility-dx', 'gx', 'regional-revitalization', '*')),
  organization_id TEXT,
  provider_id TEXT REFERENCES cms_providers(id),
  PRIMARY KEY (account_id, role, category)
);

CREATE TABLE IF NOT EXISTS cms_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES cms_accounts(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('legal', 'beauty', 'ai-business', 'labor-shortage', 'tourism', 'mobility-dx', 'gx', 'regional-revitalization')),
  role TEXT NOT NULL CHECK (role IN ('user', 'orderer', 'provider', 'candidate')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_requests (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('legal', 'beauty', 'ai-business', 'labor-shortage', 'tourism', 'mobility-dx', 'gx', 'regional-revitalization')),
  orderer_id TEXT NOT NULL REFERENCES cms_accounts(id),
  provider_id TEXT NOT NULL REFERENCES cms_providers(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'accepted', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_jobs (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('legal', 'beauty', 'ai-business', 'labor-shortage', 'tourism', 'mobility-dx', 'gx', 'regional-revitalization')),
  provider_id TEXT NOT NULL REFERENCES cms_providers(id),
  title TEXT NOT NULL,
  employment_type TEXT NOT NULL,
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_applications (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('legal', 'beauty', 'ai-business', 'labor-shortage', 'tourism', 'mobility-dx', 'gx', 'regional-revitalization')),
  job_id TEXT NOT NULL REFERENCES cms_jobs(id),
  provider_id TEXT NOT NULL REFERENCES cms_providers(id),
  candidate_id TEXT NOT NULL REFERENCES cms_accounts(id),
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'screening', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS cms_content_proposals (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('legal', 'beauty', 'ai-business', 'labor-shortage', 'tourism', 'mobility-dx', 'gx', 'regional-revitalization')),
  provider_id TEXT NOT NULL REFERENCES cms_providers(id),
  content_type TEXT NOT NULL CHECK (content_type IN ('company', 'blog', 'job', 'pr', 'ir')),
  audience TEXT NOT NULL CHECK (audience IN ('customer', 'candidate', 'media', 'investor', 'beginner', 'existingCustomer')),
  topic TEXT NOT NULL,
  search_intent TEXT NOT NULL,
  primary_keyword TEXT NOT NULL,
  related_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  outline JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  rationale TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_contents (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('legal', 'beauty', 'ai-business', 'labor-shortage', 'tourism', 'mobility-dx', 'gx', 'regional-revitalization')),
  provider_id TEXT NOT NULL REFERENCES cms_providers(id),
  proposal_id TEXT NOT NULL REFERENCES cms_content_proposals(id),
  content_type TEXT NOT NULL CHECK (content_type IN ('company', 'blog', 'job', 'pr', 'ir')),
  audience TEXT NOT NULL CHECK (audience IN ('customer', 'candidate', 'media', 'investor', 'beginner', 'existingCustomer')),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  seo JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'drafted', 'polished', 'seo_reviewed', 'approved', 'published', 'archived')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, slug)
);

CREATE TABLE IF NOT EXISTS cms_content_versions (
  content_id TEXT NOT NULL REFERENCES cms_contents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  seo JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  created_by TEXT REFERENCES cms_accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (content_id, version)
);

CREATE TABLE IF NOT EXISTS cms_publication_builds (
  id TEXT PRIMARY KEY,
  initiated_by TEXT NOT NULL REFERENCES cms_accounts(id),
  base_url TEXT NOT NULL,
  content_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  files JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('generated', 'deployed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cms_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_account_id TEXT REFERENCES cms_accounts(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  category TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cms_sessions_expires_idx ON cms_sessions (expires_at);
CREATE INDEX IF NOT EXISTS cms_requests_provider_idx ON cms_requests (provider_id, status);
CREATE INDEX IF NOT EXISTS cms_jobs_category_status_idx ON cms_jobs (category, status);
CREATE INDEX IF NOT EXISTS cms_contents_provider_status_idx ON cms_contents (provider_id, status);
CREATE INDEX IF NOT EXISTS cms_audit_logs_resource_idx ON cms_audit_logs (resource_type, resource_id, created_at DESC);

COMMIT;
