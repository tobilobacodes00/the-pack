-- Dead-letter table for the outbox relay. When an event's XADD to Redis fails persistently (a
-- poison row that can never publish), the relay copies it here and marks the source row relayed, so
-- one bad event can't wedge a hunt's event tail forever. Rows here are an operator alarm: a delivered
-- event stream that skips a quarantined seq has a (logged) gap.
CREATE TABLE IF NOT EXISTS dead_events (
    hunt_id   TEXT        NOT NULL,
    seq       INTEGER     NOT NULL,
    event_id  TEXT        NOT NULL,
    ts        TEXT        NOT NULL,
    type      TEXT        NOT NULL,
    actor     TEXT        NOT NULL,
    payload   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    attempts  INTEGER     NOT NULL,
    reason    TEXT,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (hunt_id, seq)
);
