-- More for indoors: tables that things stand on (`surface`: how high their
-- top is, px), small things that go on them (`top`), things that hang on
-- the wall (`wall`), and plenty more to make a home cozy.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (454, 'coffee_table', 'furniture', 'Coffee Table', 0, '{"buy":110,"sell":37,"surface":12}'),
    (455, 'dining_table', 'furniture', 'Dining Table', 1, '{"buy":180,"sell":60,"surface":13}'),
    (456, 'writing_desk', 'furniture', 'Writing Desk', 1, '{"buy":160,"sell":53,"surface":13}'),
    (457, 'nightstand', 'furniture', 'Nightstand', 0, '{"buy":70,"sell":23,"surface":13}'),
    (458, 'low_cabinet', 'furniture', 'Low Cabinet', 0, '{"buy":90,"sell":30,"surface":12}'),
    (459, 'bar_cart', 'furniture', 'Bar Cart', 2, '{"buy":150,"sell":50,"surface":12}'),
    (460, 'table_lamp', 'furniture', 'Table Lamp', 0, '{"buy":60,"sell":20,"top":true,"use":"toggle"}'),
    (461, 'candle_trio', 'furniture', 'Candles', 0, '{"buy":35,"sell":12,"top":true,"use":"toggle"}'),
    (462, 'vase_flowers', 'furniture', 'Vase of Flowers', 0, '{"buy":45,"sell":15,"top":true}'),
    (463, 'tea_set', 'furniture', 'Tea Set', 1, '{"buy":70,"sell":23,"top":true}'),
    (464, 'book_stack', 'furniture', 'Stack of Books', 0, '{"buy":30,"sell":10,"top":true}'),
    (465, 'succulent', 'furniture', 'Succulent', 0, '{"buy":25,"sell":8,"top":true}'),
    (466, 'radio', 'furniture', 'Radio', 1, '{"buy":90,"sell":30,"top":true,"use":"toggle"}'),
    (467, 'laptop', 'furniture', 'Laptop', 2, '{"buy":240,"sell":80,"top":true,"use":"toggle"}'),
    (469, 'photo_frame', 'furniture', 'Photo Frame', 0, '{"buy":40,"sell":13,"top":true}'),
    (470, 'cake_stand', 'furniture', 'Cake Stand', 1, '{"buy":65,"sell":22,"top":true}'),
    (471, 'desk_globe', 'furniture', 'Globe', 1, '{"buy":85,"sell":28,"top":true}'),
    (472, 'wall_mirror', 'furniture', 'Wall Mirror', 1, '{"buy":130,"sell":43,"wall":true}'),
    (473, 'neon_heart', 'furniture', 'Neon Heart', 2, '{"buy":180,"sell":60,"wall":true,"use":"toggle"}'),
    (474, 'xmas_lights', 'furniture', 'Christmas Lights', 1, '{"buy":110,"sell":37,"wall":true,"use":"toggle"}'),
    (475, 'wreath', 'furniture', 'Wreath', 1, '{"buy":75,"sell":25,"wall":true}'),
    (476, 'cuckoo_clock', 'furniture', 'Cuckoo Clock', 2, '{"buy":210,"sell":70,"wall":true,"use":"toggle"}'),
    (477, 'wall_shelf', 'furniture', 'Wall Shelf', 0, '{"buy":60,"sell":20,"wall":true}'),
    (478, 'bunting', 'furniture', 'Bunting', 0, '{"buy":40,"sell":13,"wall":true}'),
    (479, 'window_curtains', 'furniture', 'Curtained Window', 1, '{"buy":120,"sell":40,"wall":true,"use":"toggle"}'),
    (480, 'christmas_tree', 'furniture', 'Christmas Tree', 3, '{"buy":380,"sell":127,"use":"toggle"}'),
    (481, 'piano', 'furniture', 'Piano', 3, '{"buy":600,"sell":200,"use":"toggle"}'),
    (482, 'teddy_bear', 'furniture', 'Teddy Bear', 0, '{"buy":45,"sell":15}'),
    (483, 'toy_chest', 'furniture', 'Toy Chest', 0, '{"buy":80,"sell":27}'),
    (484, 'floor_cushions', 'furniture', 'Floor Cushions', 0, '{"buy":55,"sell":18,"flat":true}'),
    (485, 'bookcase_full', 'furniture', 'Full Bookcase', 1, '{"buy":190,"sell":63}'),
    (486, 'plant_stand', 'furniture', 'Plant Stand', 0, '{"buy":70,"sell":23}'),
    (487, 'indoor_fountain', 'furniture', 'Indoor Fountain', 2, '{"buy":260,"sell":87}'),
    (488, 'popcorn_machine', 'furniture', 'Popcorn Machine', 2, '{"buy":230,"sell":77,"use":"toggle"}'),
    (489, 'cozy_armchair', 'furniture', 'Cozy Armchair', 1, '{"buy":150,"sell":50}'),
    (490, 'blanket_basket', 'furniture', 'Blanket Basket', 0, '{"buy":50,"sell":17}'),
    (491, 'floor_candles', 'furniture', 'Floor Candles', 1, '{"buy":80,"sell":27,"use":"toggle"}');
UPDATE items SET meta = meta || '{"wall": true}' WHERE key IN ('painting_sunset', 'painting_sea', 'painting_cat', 'wall_clock');
UPDATE items SET meta = meta || '{"top": true, "use": "toggle"}' WHERE key = 'snow_globe';
UPDATE items SET meta = meta || '{"top": true}' WHERE key IN ('fish_bowl', 'aquarium', 'record_player', 'retro_tv', 'lava_lamp', 'cactus_pot');
UPDATE items SET meta = meta || '{"surface": 12}' WHERE key IN ('small_table', 'side_table');
-- Something on a table is its second layer on that tile.
ALTER TABLE home_objects ADD COLUMN layer smallint NOT NULL DEFAULT 0;
ALTER TABLE home_objects DROP CONSTRAINT home_objects_pkey;
ALTER TABLE home_objects ADD PRIMARY KEY (owner_id, x, y, layer);
