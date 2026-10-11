-- Core schema (spec §13). Applied automatically by the Postgres container on
-- first start (infra/docker-compose.yml). Services adopt these tables
-- milestone by milestone: auth in M3 (replacing the in-memory store), economy
-- in M3, governance in M6, districts in M7, content in M8.

CREATE TYPE trust_tier AS ENUM ('visitor', 'newcomer', 'resident', 'steward');

CREATE TABLE accounts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email       text NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    birth_year  smallint NOT NULL,
    status      text NOT NULL DEFAULT 'active' -- active | suspended | deleted
);

CREATE TABLE players (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    display_name  text NOT NULL,
    avatar        jsonb NOT NULL DEFAULT '{}',
    trust_tier    trust_tier NOT NULL DEFAULT 'visitor',
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX players_display_name_ci ON players (lower(display_name));

CREATE TABLE refresh_tokens (
    token_hash  text PRIMARY KEY, -- sha256 hex; raw tokens are never stored
    player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    expires_at  timestamptz NOT NULL
);

CREATE TABLE districts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            text NOT NULL UNIQUE,
    name            text NOT NULL,
    state           text NOT NULL, -- proposed | founding | approved | constructing | open | growing | quiet | dormant
    charter         jsonb NOT NULL DEFAULT '[]',
    theme           jsonb NOT NULL DEFAULT '{}',
    tags            text[] NOT NULL DEFAULT '{}',
    founded_at      timestamptz,
    last_active_at  timestamptz
);

CREATE TABLE activity_days (
    player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    day           date NOT NULL,
    district_id   uuid NOT NULL REFERENCES districts(id),
    minutes       integer NOT NULL DEFAULT 0,
    interactions  integer NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, day, district_id)
);

CREATE TABLE friendships (
    a      uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    b      uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    level  smallint NOT NULL DEFAULT 0, -- 0 acquainted, 1 friend, 2 close friend
    since  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (a, b),
    CHECK (a < b)
);

CREATE TABLE events (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind      text NOT NULL,
    zone_id   uuid,
    starts_at timestamptz NOT NULL,
    ends_at   timestamptz NOT NULL,
    config    jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE items (
    id                serial PRIMARY KEY,
    kind              text NOT NULL, -- fish | plant | material | cosmetic | furniture | event
    name              text NOT NULL,
    rarity            smallint NOT NULL DEFAULT 0,
    limited_event_id  uuid REFERENCES events(id),
    meta              jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE inventory (
    player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    item_id    integer NOT NULL REFERENCES items(id),
    qty        integer NOT NULL CHECK (qty >= 0),
    PRIMARY KEY (player_id, item_id)
);

-- Append-only: every grant/spend goes through the economy service (spec §4.1, §8.4).
CREATE TABLE economy_ledger (
    id               bigserial PRIMARY KEY,
    player_id        uuid NOT NULL REFERENCES players(id),
    item_id          integer NOT NULL REFERENCES items(id),
    delta            integer NOT NULL,
    reason           text NOT NULL,
    idempotency_key  text NOT NULL UNIQUE,
    at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE zones (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug           text NOT NULL UNIQUE, -- matches assets/maps/<slug>.json
    district_id    uuid REFERENCES districts(id),
    map_chunk_url  text NOT NULL,
    soft_cap       integer NOT NULL DEFAULT 250,
    hard_cap       integer NOT NULL DEFAULT 500
);
ALTER TABLE events ADD FOREIGN KEY (zone_id) REFERENCES zones(id);

CREATE TABLE district_plots (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    district_id  uuid NOT NULL REFERENCES districts(id),
    region       polygon NOT NULL,
    state        text NOT NULL,
    opened_at    timestamptz
);

CREATE TABLE construction_pools (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type   text NOT NULL, -- district | plot | public_building
    target_id     uuid NOT NULL,
    requirements  jsonb NOT NULL,
    progress      jsonb NOT NULL DEFAULT '{}',
    state         text NOT NULL DEFAULT 'open'
);

CREATE TABLE contributions (
    pool_id    uuid NOT NULL REFERENCES construction_pools(id),
    player_id  uuid NOT NULL REFERENCES players(id),
    item_id    integer NOT NULL REFERENCES items(id),
    qty        integer NOT NULL CHECK (qty > 0),
    at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contributions_pool ON contributions (pool_id);

CREATE TABLE world_objects (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id     uuid NOT NULL REFERENCES zones(id),
    kind        text NOT NULL,
    tile_x      smallint NOT NULL,
    tile_y      smallint NOT NULL,
    owner_id    uuid REFERENCES players(id),
    state       jsonb NOT NULL DEFAULT '{}',
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX world_objects_zone ON world_objects (zone_id);

CREATE TABLE garden_plots (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id        uuid NOT NULL REFERENCES zones(id),
    owner_id       uuid REFERENCES players(id), -- null = community plot
    plant_item_id  integer REFERENCES items(id),
    planted_at     timestamptz,
    watered_at     timestamptz,
    stage          smallint NOT NULL DEFAULT 0
);

CREATE TABLE proposals (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type               text NOT NULL, -- new_district | district_expansion | town_rule | event | public_building | charter_change | revival
    scope_district_id  uuid REFERENCES districts(id),
    author_id          uuid NOT NULL REFERENCES players(id),
    body               jsonb NOT NULL,
    state              text NOT NULL DEFAULT 'draft', -- draft | discussion | voting | passed | failed
    opens_at           timestamptz,
    closes_at          timestamptz
);
-- One active proposal per player (spec §10.3).
CREATE UNIQUE INDEX proposals_one_active ON proposals (author_id) WHERE state IN ('draft', 'discussion', 'voting');

CREATE TABLE votes (
    proposal_id  uuid NOT NULL REFERENCES proposals(id),
    voter_id     uuid NOT NULL REFERENCES players(id),
    choice       smallint NOT NULL,
    weight       real NOT NULL CHECK (weight > 0 AND weight <= 4.0),
    cast_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (proposal_id, voter_id)
);

CREATE TABLE elections (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope   text NOT NULL, -- 'town' or a district id
    season  text NOT NULL,
    state   text NOT NULL DEFAULT 'nominating' -- nominating | voting | closed
);

CREATE TABLE candidacies (
    election_id   uuid NOT NULL REFERENCES elections(id),
    player_id     uuid NOT NULL REFERENCES players(id),
    statement     text NOT NULL DEFAULT '',
    PRIMARY KEY (election_id, player_id)
);

CREATE TABLE ballots (
    election_id  uuid NOT NULL REFERENCES elections(id),
    voter_id     uuid NOT NULL REFERENCES players(id),
    ranking      uuid[] NOT NULL,
    weight       real NOT NULL,
    cast_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (election_id, voter_id)
);

CREATE TABLE jury_cases (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope        text NOT NULL,
    subject_ref  text NOT NULL,
    reason       text NOT NULL,
    state        text NOT NULL DEFAULT 'summoning',
    verdict      text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    resolved_at  timestamptz
);

CREATE TABLE jury_members (
    case_id       uuid NOT NULL REFERENCES jury_cases(id),
    player_id     uuid NOT NULL REFERENCES players(id),
    response      text,
    responded_at  timestamptz,
    PRIMARY KEY (case_id, player_id)
);

CREATE TABLE sanctions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id  uuid NOT NULL REFERENCES players(id),
    scope      text NOT NULL,
    kind       text NOT NULL, -- mute_1h | mute_24h | district_ban_7d | ...
    until      timestamptz NOT NULL,
    case_id    uuid REFERENCES jury_cases(id)
);

-- Append-only public record (spec §10.7).
CREATE TABLE governance_ledger (
    id       bigserial PRIMARY KEY,
    kind     text NOT NULL,
    ref_id   uuid,
    summary  jsonb NOT NULL,
    at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE boards (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    district_id uuid REFERENCES districts(id),
    tile        point NOT NULL,
    pixels      bytea NOT NULL,
    palette_id  smallint NOT NULL,
    author_id   uuid NOT NULL REFERENCES players(id),
    state       text NOT NULL DEFAULT 'review',
    at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE paper_issues (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_no      integer NOT NULL UNIQUE,
    published_at  timestamptz
);

CREATE TABLE paper_articles (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id   uuid REFERENCES paper_issues(id),
    author_id  uuid NOT NULL REFERENCES players(id),
    body       text NOT NULL,
    state      text NOT NULL DEFAULT 'draft'
);

-- Append-only enforcement for the two ledgers.
CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
CREATE TRIGGER economy_ledger_append_only BEFORE UPDATE OR DELETE ON economy_ledger
    FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
CREATE TRIGGER governance_ledger_append_only BEFORE UPDATE OR DELETE ON governance_ledger
    FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
