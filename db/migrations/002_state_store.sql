BEGIN;

CREATE TABLE IF NOT EXISTS cms_os_state (
  state_key TEXT PRIMARY KEY,
  state_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cms_os_state_updated_idx ON cms_os_state (updated_at DESC);

COMMIT;
