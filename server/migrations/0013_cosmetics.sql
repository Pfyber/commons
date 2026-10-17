-- Things to wear from the mall (ADR 0011, M4). `code` is the item's byte in
-- a player's `style` (outfit, hat, accessory, skin); bought once and kept
-- (account-bound: never sold back, given or put on a stall).
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (500, 'denim_jacket',    'outfit',    'Denim Jacket',    0, '{"code": 1, "account_bound": true, "source": "npc"}'),
    (501, 'raincoat',        'outfit',    'Raincoat',        0, '{"code": 2, "account_bound": true, "source": "npc"}'),
    (502, 'cosy_sweater',    'outfit',    'Cosy Sweater',    0, '{"code": 3, "account_bound": true, "source": "npc"}'),
    (503, 'sundress',        'outfit',    'Sundress',        0, '{"code": 4, "account_bound": true, "source": "npc"}'),
    (504, 'tuxedo',          'outfit',    'Tuxedo',          2, '{"code": 5, "account_bound": true, "source": "npc"}'),
    (505, 'kimono',          'outfit',    'Kimono',          1, '{"code": 6, "account_bound": true, "source": "npc"}'),
    (510, 'beanie',          'hat',       'Beanie',          0, '{"code": 1, "account_bound": true, "source": "npc"}'),
    (511, 'sun_hat',         'hat',       'Sun Hat',         0, '{"code": 2, "account_bound": true, "source": "npc"}'),
    (512, 'wizard_hat',      'hat',       'Wizard Hat',      1, '{"code": 3, "account_bound": true, "source": "npc"}'),
    (513, 'crown',           'hat',       'Crown',           2, '{"code": 4, "account_bound": true, "source": "npc"}'),
    (520, 'satchel',         'accessory', 'Satchel',         0, '{"code": 1, "account_bound": true, "source": "npc"}'),
    (521, 'butterfly_wings', 'accessory', 'Butterfly Wings', 2, '{"code": 2, "account_bound": true, "source": "npc"}'),
    (522, 'bow_tie',         'accessory', 'Bow Tie',         0, '{"code": 3, "account_bound": true, "source": "npc"}'),
    (530, 'fox_suit',        'skin',      'Fox Suit',        1, '{"code": 1, "account_bound": true, "source": "npc"}'),
    (531, 'frog_suit',       'skin',      'Frog Suit',       1, '{"code": 2, "account_bound": true, "source": "npc"}'),
    (532, 'bear_suit',       'skin',      'Bear Suit',       1, '{"code": 3, "account_bound": true, "source": "npc"}'),
    (533, 'robot_suit',      'skin',      'Robot Suit',      2, '{"code": 4, "account_bound": true, "source": "npc"}')
ON CONFLICT (id) DO NOTHING;
