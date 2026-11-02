-- Inside Housing (the mall's new shop): things for indoors. Paintings,
-- lights, rugs, beds and plants; and things to use: fish tanks you keep
-- your catch in (`tank`: how many fish), lights and gadgets that turn on and
-- off (`use`: toggle), and things for a pet (`pet`).
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (430, 'painting_sunset', 'furniture', 'Sunset Painting', 1, '{"buy":120,"sell":40}'),
    (431, 'painting_sea', 'furniture', 'Seascape Painting', 1, '{"buy":140,"sell":47}'),
    (432, 'painting_cat', 'furniture', 'Cat Portrait', 2, '{"buy":180,"sell":60}'),
    (433, 'fairy_string', 'furniture', 'Fairy String Lights', 1, '{"buy":90,"sell":30,"use":"toggle"}'),
    (434, 'lava_lamp', 'furniture', 'Lava Lamp', 1, '{"buy":110,"sell":37,"use":"toggle"}'),
    (435, 'paper_lantern', 'furniture', 'Paper Lantern', 0, '{"buy":70,"sell":23,"use":"toggle"}'),
    (436, 'rug_persian', 'furniture', 'Persian Rug', 2, '{"buy":160,"sell":53,"flat":true}'),
    (437, 'rug_stripes', 'furniture', 'Striped Rug', 0, '{"buy":80,"sell":27,"flat":true}'),
    (438, 'rug_heart', 'furniture', 'Heart Rug', 1, '{"buy":95,"sell":32,"flat":true}'),
    (439, 'double_bed', 'furniture', 'Double Bed', 1, '{"buy":220,"sell":73}'),
    (440, 'bunk_bed', 'furniture', 'Bunk Bed', 1, '{"buy":200,"sell":67}'),
    (441, 'bean_bag', 'furniture', 'Bean Bag', 0, '{"buy":60,"sell":20}'),
    (442, 'monstera', 'furniture', 'Monstera', 0, '{"buy":85,"sell":28}'),
    (443, 'cactus_pot', 'furniture', 'Cactus', 0, '{"buy":40,"sell":13}'),
    (444, 'fish_bowl', 'furniture', 'Round Fish Bowl', 1, '{"buy":180,"sell":60,"tank":3}'),
    (445, 'aquarium', 'furniture', 'Big Aquarium', 3, '{"buy":450,"sell":150,"tank":8,"use":"toggle"}'),
    (446, 'dog_bed', 'furniture', 'Dog Bed', 0, '{"buy":90,"sell":30,"pet":true}'),
    (447, 'cat_tree', 'furniture', 'Cat Scratching Tree', 1, '{"buy":120,"sell":40,"pet":true}'),
    (448, 'record_player', 'furniture', 'Record Player', 2, '{"buy":200,"sell":67,"use":"toggle"}'),
    (449, 'retro_tv', 'furniture', 'Retro TV', 2, '{"buy":260,"sell":87,"use":"toggle"}'),
    (450, 'fireplace', 'furniture', 'Fireplace', 3, '{"buy":320,"sell":107,"use":"toggle"}'),
    (451, 'arcade_cabinet', 'furniture', 'Arcade Cabinet', 3, '{"buy":350,"sell":117,"use":"toggle"}'),
    (452, 'disco_ball', 'furniture', 'Disco Ball', 2, '{"buy":240,"sell":80,"use":"toggle"}'),
    (453, 'pet_bowl', 'furniture', 'Pet Bowl', 0, '{"buy":30,"sell":10,"pet":true}');
-- The fish in a tank, in the order they went in.
ALTER TABLE home_objects ADD COLUMN fish integer[] NOT NULL DEFAULT '{}';
