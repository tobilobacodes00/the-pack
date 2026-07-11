-- Durable publish-failure counter for the outbox relay. Previously the count lived only in the
-- relay's process memory, so a restart reset it and a poison event could retry forever across
-- restarts. Persisting it on the event row means the quarantine decision survives a relay restart.
ALTER TABLE events ADD COLUMN IF NOT EXISTS relay_attempts INTEGER NOT NULL DEFAULT 0;
