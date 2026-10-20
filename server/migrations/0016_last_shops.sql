-- The mall's last shops (ADR 0011, M7).
--
-- Tools: a nicer rod (seen while fishing) and watering can (seen watering);
-- cosmetic, no effect on catches or growth. `tool` says which hand it's for,
-- `code` its look. Music: instruments for the bandstand jam, and Toys: things
-- to play with that everyone nearby sees. Their `code` is the jam instrument
-- or the play emote they unlock (`kit`). Gift Shop: wrapping paper and cards
-- for doorstep gifts, used up when a gift is sent. Home exterior: paint,
-- fences, yard decor and postboxes, applied to your house (`slot`), for
-- everyone passing to see.
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (800, 'cherry_rod',      'tool',       'Cherrywood Rod',   0, '{"tool": "rod", "code": 1, "source": "npc"}'),
    (801, 'carbon_rod',      'tool',       'Carbon Rod',       1, '{"tool": "rod", "code": 2, "source": "npc"}'),
    (802, 'golden_rod',      'tool',       'Golden Rod',       2, '{"tool": "rod", "code": 3, "source": "npc"}'),
    (805, 'copper_can',      'tool',       'Copper Watering Can', 0, '{"tool": "can", "code": 1, "source": "npc"}'),
    (806, 'floral_can',      'tool',       'Floral Watering Can', 1, '{"tool": "can", "code": 2, "source": "npc"}'),
    (810, 'ukulele',         'instrument', 'Ukulele',          0, '{"code": 3, "kit": true, "source": "npc"}'),
    (811, 'kalimba',         'instrument', 'Kalimba',          1, '{"code": 4, "kit": true, "source": "npc"}'),
    (812, 'flute',           'instrument', 'Flute',            0, '{"code": 5, "kit": true, "source": "npc"}'),
    (820, 'polka_wrap',      'wrap',       'Polka-dot Wrapping', 0, '{"code": 1, "source": "npc"}'),
    (821, 'striped_wrap',    'wrap',       'Striped Wrapping', 0, '{"code": 2, "source": "npc"}'),
    (822, 'starry_wrap',     'wrap',       'Starry Wrapping',  1, '{"code": 3, "source": "npc"}'),
    (823, 'kraft_wrap',      'wrap',       'Brown-paper Wrapping', 0, '{"code": 4, "source": "npc"}'),
    (825, 'thank_you_card',  'card',       'Thank-you Card',   0, '{"code": 1, "source": "npc"}'),
    (826, 'birthday_card',   'card',       'Birthday Card',    0, '{"code": 2, "source": "npc"}'),
    (827, 'flower_card',     'card',       'Flower Card',      0, '{"code": 3, "source": "npc"}'),
    (828, 'just_because_card', 'card',     'Just-because Card', 0, '{"code": 4, "source": "npc"}'),
    (830, 'bubble_wand',     'toy',        'Bubble Wand',      0, '{"code": 8, "kit": true, "source": "npc"}'),
    (831, 'kite',            'toy',        'Kite',             1, '{"code": 9, "kit": true, "source": "npc"}'),
    (832, 'yo_yo',           'toy',        'Yo-yo',            0, '{"code": 10, "kit": true, "source": "npc"}'),
    (833, 'pinwheel',        'toy',        'Pinwheel',         0, '{"code": 11, "kit": true, "source": "npc"}'),
    (840, 'sage_paint',      'exterior',   'Sage Green Paint', 0, '{"slot": "facade", "code": 1, "account_bound": true, "source": "npc"}'),
    (841, 'rose_paint',      'exterior',   'Rose Pink Paint',  0, '{"slot": "facade", "code": 2, "account_bound": true, "source": "npc"}'),
    (842, 'sky_paint',       'exterior',   'Sky Blue Paint',   0, '{"slot": "facade", "code": 3, "account_bound": true, "source": "npc"}'),
    (843, 'sunny_paint',     'exterior',   'Sunny Yellow Paint', 0, '{"slot": "facade", "code": 4, "account_bound": true, "source": "npc"}'),
    (845, 'picket_fence',    'exterior',   'Picket Fence',     0, '{"slot": "fence", "code": 1, "account_bound": true, "source": "npc"}'),
    (846, 'low_hedge',       'exterior',   'Low Hedge',        1, '{"slot": "fence", "code": 2, "account_bound": true, "source": "npc"}'),
    (848, 'yard_gnome',      'exterior',   'Yard Gnome',       0, '{"slot": "yard", "code": 1, "account_bound": true, "source": "npc"}'),
    (849, 'bird_bath',       'exterior',   'Bird Bath',        1, '{"slot": "yard", "code": 2, "account_bound": true, "source": "npc"}'),
    (850, 'flower_arch',     'exterior',   'Flower Arch',      2, '{"slot": "yard", "code": 3, "account_bound": true, "source": "npc"}'),
    (852, 'blue_postbox',    'exterior',   'Blue Postbox',     0, '{"slot": "postbox", "code": 1, "account_bound": true, "source": "npc"}'),
    (853, 'cottage_postbox', 'exterior',   'Cottage Postbox',  1, '{"slot": "postbox", "code": 2, "account_bound": true, "source": "npc"}')
ON CONFLICT (id) DO NOTHING;

-- What a house looks like outside, by its resident (moving takes it along).
CREATE TABLE home_exterior (
    owner    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    slot     text NOT NULL CHECK (slot IN ('facade', 'fence', 'yard', 'postbox')),
    item_id  integer NOT NULL REFERENCES items(id),
    PRIMARY KEY (owner, slot)
);

-- Doorstep gifts can come wrapped, with a card (the codes of the wrapping
-- and the card used; 0 for none).
ALTER TABLE gifts ADD COLUMN wrap smallint NOT NULL DEFAULT 0;
ALTER TABLE gifts ADD COLUMN card smallint NOT NULL DEFAULT 0;
