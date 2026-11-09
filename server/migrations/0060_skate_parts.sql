-- The skatepark's shop (Dusty's van): parts to build your board from. Each
-- is bought once and kept (account-bound: not sold or traded on), and you
-- pick which of yours to ride: the deck's colour (the glow-in-the-dark one
-- glows), the wheels (small: quicker off the mark; big: a higher top speed),
-- the bearings (each level up, faster acceleration), the trucks (which
-- tricks you can do), and a trail behind you as you skate. `part` and `code`
-- say which and what (the client's skatekit.ts); the stock parts (code 0)
-- everyone has and aren't items. Not on the market cart (no "market").
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (1300, 'deck_red', 'skate_part', 'Cherry Deck', 0, '{"buy":80,"account_bound":true,"part":"deck","code":1}'),
    (1301, 'deck_orange', 'skate_part', 'Tangerine Deck', 0, '{"buy":80,"account_bound":true,"part":"deck","code":2}'),
    (1302, 'deck_yellow', 'skate_part', 'Sunshine Deck', 0, '{"buy":80,"account_bound":true,"part":"deck","code":3}'),
    (1303, 'deck_green', 'skate_part', 'Lime Deck', 0, '{"buy":80,"account_bound":true,"part":"deck","code":4}'),
    (1304, 'deck_pink', 'skate_part', 'Bubblegum Deck', 0, '{"buy":80,"account_bound":true,"part":"deck","code":5}'),
    (1305, 'deck_purple', 'skate_part', 'Grape Deck', 0, '{"buy":80,"account_bound":true,"part":"deck","code":6}'),
    (1306, 'deck_black', 'skate_part', 'Midnight Deck', 1, '{"buy":150,"account_bound":true,"part":"deck","code":7}'),
    (1307, 'deck_white', 'skate_part', 'Ivory Deck', 1, '{"buy":150,"account_bound":true,"part":"deck","code":8}'),
    (1308, 'deck_gold', 'skate_part', 'Gold Deck', 2, '{"buy":500,"account_bound":true,"part":"deck","code":9}'),
    (1309, 'deck_glow', 'skate_part', 'Glow-in-the-Dark Deck', 3, '{"buy":1000,"account_bound":true,"part":"deck","code":10}'),
    (1310, 'wheels_small', 'skate_part', 'Small Wheels', 0, '{"buy":120,"account_bound":true,"part":"wheels","code":1}'),
    (1311, 'wheels_big', 'skate_part', 'Big Wheels', 1, '{"buy":300,"account_bound":true,"part":"wheels","code":2}'),
    (1312, 'bearings_2', 'skate_part', 'Bearings Lv 2', 0, '{"buy":150,"account_bound":true,"part":"bearings","code":2}'),
    (1313, 'bearings_3', 'skate_part', 'Bearings Lv 3', 1, '{"buy":350,"account_bound":true,"part":"bearings","code":3}'),
    (1314, 'bearings_4', 'skate_part', 'Bearings Lv 4', 2, '{"buy":700,"account_bound":true,"part":"bearings","code":4}'),
    (1315, 'bearings_5', 'skate_part', 'Bearings Lv 5', 3, '{"buy":1400,"account_bound":true,"part":"bearings","code":5}'),
    (1316, 'trucks_flip', 'skate_part', 'Flip Trucks', 1, '{"buy":250,"account_bound":true,"part":"trucks","code":1}'),
    (1317, 'trucks_grind', 'skate_part', 'Grind Trucks', 1, '{"buy":300,"account_bound":true,"part":"trucks","code":2}'),
    (1318, 'trucks_vert', 'skate_part', 'Vert Trucks', 2, '{"buy":800,"account_bound":true,"part":"trucks","code":3}'),
    (1319, 'trucks_pro', 'skate_part', 'Pro Trucks', 3, '{"buy":2500,"account_bound":true,"part":"trucks","code":4}'),
    (1320, 'trail_spark', 'skate_part', 'Spark Trail', 1, '{"buy":600,"account_bound":true,"part":"trail","code":1}'),
    (1321, 'trail_neon', 'skate_part', 'Neon Trail', 2, '{"buy":900,"account_bound":true,"part":"trail","code":2}'),
    (1322, 'trail_rainbow', 'skate_part', 'Rainbow Trail', 2, '{"buy":1500,"account_bound":true,"part":"trail","code":3}'),
    (1323, 'trail_fire', 'skate_part', 'Fire Trail', 3, '{"buy":2000,"account_bound":true,"part":"trail","code":4}'),
    (1324, 'trail_galaxy', 'skate_part', 'Galaxy Trail', 3, '{"buy":3000,"account_bound":true,"part":"trail","code":5}');
