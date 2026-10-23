-- Vehicles get real speed (commons_sim::vehicles): 2.2× to 3.5× walking.
-- The `speed` in each item's meta says so too.
UPDATE items SET meta = jsonb_set(meta, '{speed}', to_jsonb(v.speed)) FROM (VALUES
    ('roller_skates', 2.2),
    ('kick_scooter', 2.7),
    ('city_bike', 3.2),
    ('vintage_bike', 3.5),
    ('skateboard', 2.4)
) AS v(key, speed) WHERE items.key = v.key AND items.kind = 'vehicle';
