-- v6: the pack's memory becomes visible and vetoable. Every lesson row gets a lifecycle status:
--   active   — recalled into future hunts (the default; distilled lessons land here)
--   archived — the Packmaster vetoed it; kept for the record, never recalled again
-- TEXT with app-level enum (tools/memory.py normalizes) — matches the schema's existing pattern
-- (memory.kind has no CHECK constraint either).
ALTER TABLE memory ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Recall filters to active rows on every hunt — index the hot path.
CREATE INDEX IF NOT EXISTS idx_memory_status ON memory (status, id DESC);
