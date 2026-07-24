-- One-shot migration for existing Postgres volumes (deface sidecar columns).
ALTER TABLE captures
  ADD COLUMN IF NOT EXISTS deface_status TEXT NOT NULL DEFAULT 'n/a',
  ADD COLUMN IF NOT EXISTS deface_error TEXT,
  ADD COLUMN IF NOT EXISTS defaced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sha256_original TEXT;

CREATE INDEX IF NOT EXISTS idx_captures_deface_pending
  ON captures (id) WHERE deface_status = 'pending';
