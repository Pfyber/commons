-- The skateboard (from the arcade and bar merge) joins the mall's vehicles:
-- bought once at the Vehicles shop, 1.6× walking speed outdoors, off at doors.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (704, 'skateboard', 'vehicle', 'Skateboard', 0, '{"code": 5, "speed": 1.6, "account_bound": true, "source": "npc"}')
ON CONFLICT (id) DO NOTHING;
