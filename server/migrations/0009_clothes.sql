-- The clothes shop: outfits, hats and accessories to buy and keep.
--
-- meta: price (coins), slot (the look field: outfit, hat, accessory) and
-- index (its value there, as in client/src/world/look.ts). The plain tee, no
-- hat and no accessory are free and have no item. Clothes are kept, never
-- sold, so they have no "sell"; they use "price" rather than "buy" so the
-- market cart doesn't stock them.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (501, 'outfit_overalls',     'clothing', 'Overalls',     0, '{"price": 35,  "slot": "outfit",    "index": 1}'),
    (502, 'outfit_stripes',      'clothing', 'Stripes',      0, '{"price": 25,  "slot": "outfit",    "index": 2}'),
    (503, 'outfit_dress',        'clothing', 'Dress',        0, '{"price": 45,  "slot": "outfit",    "index": 3}'),
    (504, 'outfit_hoodie',       'clothing', 'Hoodie',       0, '{"price": 50,  "slot": "outfit",    "index": 4}'),
    (505, 'outfit_jacket',       'clothing', 'Jacket',       1, '{"price": 70,  "slot": "outfit",    "index": 5}'),
    (506, 'outfit_heart_jumper', 'clothing', 'Heart jumper', 1, '{"price": 60,  "slot": "outfit",    "index": 6}'),
    (507, 'outfit_waistcoat',    'clothing', 'Waistcoat',    1, '{"price": 85,  "slot": "outfit",    "index": 7}'),
    (511, 'hat_beanie',          'clothing', 'Beanie',       0, '{"price": 15,  "slot": "hat",       "index": 1}'),
    (512, 'hat_cap',             'clothing', 'Cap',          0, '{"price": 20,  "slot": "hat",       "index": 2}'),
    (513, 'hat_flower',          'clothing', 'Flower',       0, '{"price": 10,  "slot": "hat",       "index": 3}'),
    (521, 'acc_glasses',         'clothing', 'Glasses',      0, '{"price": 20,  "slot": "accessory", "index": 1}'),
    (522, 'acc_sunglasses',      'clothing', 'Sunglasses',   1, '{"price": 40,  "slot": "accessory", "index": 2}'),
    (523, 'acc_scarf',           'clothing', 'Scarf',        0, '{"price": 25,  "slot": "accessory", "index": 3}'),
    (524, 'acc_backpack',        'clothing', 'Backpack',     1, '{"price": 55,  "slot": "accessory", "index": 4}'),
    (525, 'acc_bow',             'clothing', 'Bow',          0, '{"price": 15,  "slot": "accessory", "index": 5}'),
    (526, 'acc_headphones',      'clothing', 'Headphones',   2, '{"price": 75,  "slot": "accessory", "index": 6}'),
    (527, 'acc_flower_crown',    'clothing', 'Flower crown', 2, '{"price": 100, "slot": "accessory", "index": 7}');
