-- A lived-in home: pieces turn (`rot`), tanks get fed (`fed_at`), front yards
-- are furnished like rooms (`yard`, with `x`/`y` on the city map), rooms get
-- wallpaper and flooring, and the laptop orders parcels by drone.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (1200, 'planter_pot', 'furniture', 'Planter Pot', 0, '{"buy":60,"sell":20,"planter":true,"market":true}'),
    (1201, 'uv_light', 'furniture', 'UV Grow Light', 1, '{"buy":140,"sell":47,"uv":true,"wall":true,"stands":true,"market":true}'),
    (1202, 'display_shelf', 'furniture', 'Display Shelf', 1, '{"buy":120,"sell":40,"tank":6,"shelf":true,"market":true}'),
    (1203, 'fish_food', 'supply', 'Fish Food', 0, '{"buy":6,"sell":2,"market":true}'),
    (1210, 'wall_stripes', 'room', 'Striped Wallpaper', 0, '{"buy":80,"skin":"wall","pattern":"stripes","market":true}'),
    (1211, 'wall_damask', 'room', 'Damask Wallpaper', 1, '{"buy":140,"skin":"wall","pattern":"damask","market":true}'),
    (1212, 'wall_brick', 'room', 'Brick Wall Skin', 1, '{"buy":120,"skin":"wall","pattern":"brick","market":true}'),
    (1213, 'wall_panels', 'room', 'Wood Panelling', 1, '{"buy":130,"skin":"wall","pattern":"panels","market":true}'),
    (1214, 'wall_stars', 'room', 'Starry Wallpaper', 2, '{"buy":180,"skin":"wall","pattern":"stars","market":true}'),
    (1215, 'wall_floral', 'room', 'Floral Wallpaper', 1, '{"buy":150,"skin":"wall","pattern":"floral","market":true}'),
    (1220, 'floor_parquet', 'room', 'Parquet Flooring', 1, '{"buy":130,"skin":"floor","pattern":"parquet","market":true}'),
    (1221, 'floor_tile', 'room', 'Checker Tile Flooring', 0, '{"buy":100,"skin":"floor","pattern":"tile","market":true}'),
    (1222, 'floor_carpet', 'room', 'Soft Carpet', 0, '{"buy":90,"skin":"floor","pattern":"carpet","market":true}'),
    (1223, 'floor_stone', 'room', 'Stone Flooring', 1, '{"buy":120,"skin":"floor","pattern":"stone","market":true}'),
    (1224, 'floor_marble', 'room', 'Marble Flooring', 2, '{"buy":200,"skin":"floor","pattern":"marble","market":true}');
UPDATE items SET meta = meta || '{"use":"toggle"}' WHERE key = 'floor_lamp';

ALTER TABLE home_objects ADD COLUMN rot smallint NOT NULL DEFAULT 0;
ALTER TABLE home_objects ADD COLUMN fed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE home_objects ADD COLUMN yard boolean NOT NULL DEFAULT false;
ALTER TABLE home_objects DROP CONSTRAINT home_objects_pkey;
ALTER TABLE home_objects ADD PRIMARY KEY (owner_id, yard, x, y, layer);

CREATE TABLE home_looks (
    owner_id    uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    wall_item   integer NOT NULL DEFAULT 0,
    wall_color  integer NOT NULL DEFAULT -1,
    floor_item  integer NOT NULL DEFAULT 0,
    floor_color integer NOT NULL DEFAULT -1
);

CREATE TABLE drone_parcels (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    item_id    integer NOT NULL REFERENCES items(id),
    qty        integer NOT NULL CHECK (qty > 0),
    ordered_at timestamptz NOT NULL DEFAULT now(),
    ready_at   timestamptz NOT NULL,
    claimed    boolean NOT NULL DEFAULT false
);
CREATE INDEX drone_parcels_open ON drone_parcels (owner_id) WHERE NOT claimed;

-- The home map is all indoors now, so the old gardens go: what grew there
-- comes back as its seed, with a pot to plant it in; furniture and whatever
-- was in it, left out where the walls now stand, goes back to the bag.
CREATE FUNCTION pg_temp.give(who uuid, what integer, n integer, why text, k text) RETURNS void AS $$
BEGIN
    INSERT INTO inventory (player_id, item_id, qty) VALUES (who, what, n)
    ON CONFLICT (player_id, item_id) DO UPDATE SET qty = inventory.qty + n;
    INSERT INTO economy_ledger (player_id, item_id, delta, reason, idempotency_key) VALUES (who, what, n, why, k);
END $$ LANGUAGE plpgsql;

DO $$
DECLARE r record; f integer; i integer := 0;
BEGIN
    FOR r IN SELECT pl.owner_id, pl.x, pl.y, pl.plant_item_id AS plant FROM plots pl WHERE pl.space LIKE 'home:%' LOOP
        i := i + 1;
        SELECT id INTO f FROM items WHERE kind = 'seed' AND (meta->>'grows')::integer = r.plant LIMIT 1;
        IF f IS NOT NULL THEN
            PERFORM pg_temp.give(r.owner_id, f, 1, 'home_redo', 'home_redo:seed:' || i);
        END IF;
        PERFORM pg_temp.give(r.owner_id, 1200, 1, 'home_redo', 'home_redo:pot:' || i);
    END LOOP;
    DELETE FROM plots WHERE space LIKE 'home:%';
    FOR r IN DELETE FROM home_objects WHERE x <= 1 OR x >= 23 OR y >= 13 RETURNING owner_id, item_id, fish LOOP
        i := i + 1;
        PERFORM pg_temp.give(r.owner_id, r.item_id, 1, 'home_redo', 'home_redo:piece:' || i);
        FOREACH f IN ARRAY r.fish LOOP
            i := i + 1;
            PERFORM pg_temp.give(r.owner_id, f, 1, 'home_redo', 'home_redo:fish:' || i);
        END LOOP;
    END LOOP;
END $$;
