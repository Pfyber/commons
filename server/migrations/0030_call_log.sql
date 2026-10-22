-- The phone's call log (ADR 0013, V2): one line per person per call, with
-- whether they called or were called, how it went, who else was on it, and
-- how long it lasted. Kept 90 days.
CREATE TABLE call_log (
    id         bigserial PRIMARY KEY,
    player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    call_id    uuid NOT NULL,
    direction  text NOT NULL,                 -- 'out' | 'in'
    status     text NOT NULL,                 -- 'talked' | 'unanswered' | 'missed' | 'declined' | 'removed'
    people     jsonb NOT NULL DEFAULT '[]',   -- the others: [{"id": …, "name": …}]
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at   timestamptz
);
CREATE UNIQUE INDEX call_log_once ON call_log (player_id, call_id);
CREATE INDEX call_log_recent ON call_log (player_id, started_at DESC);
