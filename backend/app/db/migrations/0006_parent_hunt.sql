-- Follow-up hunts spun off a delivered brief from the chat carry a pointer to the hunt they extend,
-- so the frontend can thread a sub-hunt under its parent and a brief can be grown across runs.
ALTER TABLE hunts ADD COLUMN IF NOT EXISTS parent_hunt_id TEXT;

CREATE INDEX IF NOT EXISTS idx_hunts_parent ON hunts (parent_hunt_id) WHERE parent_hunt_id IS NOT NULL;
