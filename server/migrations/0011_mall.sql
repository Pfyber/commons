-- The Commons Mall (ADR 0011, M2): new furniture and garden pieces sold by
-- the mall. `source: npc` marks things the mall may sell; player-made goods
-- (fish, plants, junk, crafted) never appear in a mall catalog. `sell` is
-- what the market cart pays to take one back.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (408, 'armchair',     'furniture', 'Armchair',     0, '{"sell": 30, "source": "npc"}'),
    (409, 'sofa',         'furniture', 'Sofa',         1, '{"sell": 45, "source": "npc"}'),
    (410, 'side_table',   'furniture', 'Side Table',   0, '{"sell": 18, "source": "npc"}'),
    (411, 'potted_palm',  'furniture', 'Potted Palm',  0, '{"sell": 25, "source": "npc"}'),
    (412, 'wall_clock',   'furniture', 'Wall Clock',   0, '{"sell": 20, "source": "npc"}'),
    (413, 'flower_box',   'furniture', 'Flower Box',   0, '{"sell": 12, "source": "npc"}'),
    (414, 'garden_gnome', 'furniture', 'Garden Gnome', 0, '{"sell": 15, "source": "npc"}'),
    (415, 'birdbath',     'furniture', 'Birdbath',     1, '{"sell": 25, "source": "npc"}')
ON CONFLICT (id) DO NOTHING;
