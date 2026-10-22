-- Phone calls (ADR 0013): the Mobile Phone, sold at the mall's Tools &
-- Gadgets shop, kept for good. Friends who both have one can call each
-- other and talk in group calls (voice through LiveKit).
INSERT INTO items (id, key, kind, name, rarity, meta) VALUES
    (950, 'phone', 'gadget', 'Mobile Phone', 1, '{"source": "npc", "account_bound": true}')
ON CONFLICT (id) DO NOTHING;

-- An under-16 has switched phone calls on (only matters once calls are open
-- to under-16s, `COMMONS_VOICE_MINORS`; off by default).
ALTER TABLE players ADD COLUMN voice_ok boolean NOT NULL DEFAULT false;
