-- M6 "Govern" (spec §10): activity days, the town's state, proposals and
-- ranked-choice voting, the public ledger, reports and sanctions.
--
-- 0001 sketched some of these tables from the spec's data model; nothing
-- ever used them. They're replaced here by the shapes the decided rules need
-- (elections and juries keep their sketches until they're built).
DROP TABLE votes, proposals, sanctions, governance_ledger, activity_days CASCADE;

-- Time present and meaningful interactions per player per UTC day. A day
-- counts as an *active day* above thresholds set in code (spec §10.2: ≥ 10
-- minutes and ≥ 3 interactions).
CREATE TABLE activity_days (
    player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    day           date NOT NULL,
    seconds       integer NOT NULL DEFAULT 0,
    interactions  integer NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, day)
);
CREATE INDEX activity_days_day ON activity_days (day);

-- Town-wide state: its name, the governance phase and when it began.
CREATE TABLE town_state (
    key    text PRIMARY KEY,
    value  jsonb NOT NULL
);
INSERT INTO town_state (key, value) VALUES
    ('name', '"Commons"'),
    ('phase', '{"phase": 0, "since": null}');

-- Proposals (spec §10.3). `options` are the choices on the ballot (two for
-- yes/no). `electorate` says who may vote: 'founders' (the founding votes,
-- open early) or 'residents'. Stages advance on `stage_ends_at`.
CREATE TABLE proposals (
    id             bigserial PRIMARY KEY,
    kind           text NOT NULL,
    title          text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
    body           text NOT NULL DEFAULT '' CHECK (char_length(body) <= 1000),
    options        jsonb NOT NULL DEFAULT '[]',
    ranked         boolean NOT NULL DEFAULT false,
    electorate     text NOT NULL CHECK (electorate IN ('founders', 'residents')),
    threshold      real NOT NULL DEFAULT 0.5,
    quorum         real NOT NULL DEFAULT 0.1,
    author_id      uuid REFERENCES players(id) ON DELETE SET NULL,
    author_name    text NOT NULL,
    by_caretaker   boolean NOT NULL DEFAULT false,
    status         text NOT NULL CHECK (status IN ('collecting', 'discussion', 'voting', 'passed', 'failed', 'withdrawn')),
    stage_ends_at  timestamptz NOT NULL,
    result         jsonb,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX proposals_status ON proposals (status, stage_ends_at);

-- Suggested options while a proposal is collecting them (e.g. town names),
-- and who supports each.
CREATE TABLE proposal_suggestions (
    id           bigserial PRIMARY KEY,
    proposal_id  bigint NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    text         text NOT NULL CHECK (char_length(text) BETWEEN 2 AND 40),
    author_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (proposal_id, author_id)
);
CREATE UNIQUE INDEX proposal_suggestions_text ON proposal_suggestions (proposal_id, lower(text));
CREATE TABLE suggestion_support (
    suggestion_id  bigint NOT NULL REFERENCES proposal_suggestions(id) ON DELETE CASCADE,
    player_id      uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    PRIMARY KEY (suggestion_id, player_id)
);

CREATE TABLE proposal_comments (
    id           bigserial PRIMARY KEY,
    proposal_id  bigint NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    author_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    author_name  text NOT NULL,
    body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 280),
    hidden       boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX proposal_comments_proposal ON proposal_comments (proposal_id, created_at);

-- Secret ballots: who voted is recorded apart from what was voted, so the
-- two can't be joined (spec §10.2: votes are secret, weights public).
CREATE TABLE proposal_voters (
    proposal_id  bigint NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    voter_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    PRIMARY KEY (proposal_id, voter_id)
);
CREATE TABLE proposal_ballots (
    id           bigserial PRIMARY KEY,
    proposal_id  bigint NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    ranking      smallint[] NOT NULL,
    weight       real NOT NULL CHECK (weight > 0)
);
CREATE INDEX proposal_ballots_proposal ON proposal_ballots (proposal_id);

-- The public ledger (spec §10.7): append-only. Updates and deletes are
-- refused by the database itself.
CREATE TABLE governance_ledger (
    id       bigserial PRIMARY KEY,
    at       timestamptz NOT NULL DEFAULT now(),
    kind     text NOT NULL,
    summary  text NOT NULL,
    data     jsonb NOT NULL DEFAULT '{}'
);
CREATE TRIGGER governance_ledger_append_only BEFORE UPDATE OR DELETE ON governance_ledger
    FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

-- Reports from players, handled by the Caretaker until juries exist.
CREATE TABLE reports (
    id           bigserial PRIMARY KEY,
    reporter_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    target_id    uuid REFERENCES players(id) ON DELETE SET NULL,
    target_name  text NOT NULL,
    reason       text NOT NULL,
    context      text NOT NULL DEFAULT '',
    status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    action       text,
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    resolved_at  timestamptz
);
CREATE INDEX reports_open ON reports (status, created_at);

CREATE TABLE sanctions (
    id          bigserial PRIMARY KEY,
    player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    kind        text NOT NULL CHECK (kind IN ('warning', 'mute')),
    until       timestamptz,
    report_id   bigint REFERENCES reports(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sanctions_player ON sanctions (player_id, created_at DESC);
