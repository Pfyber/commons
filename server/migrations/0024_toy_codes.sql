-- The Robot dance (from the arcade and bar merge) is emote 8, free to all;
-- the mall's toys move up one, to emotes 9 to 12. A toy's `code` is its emote.
UPDATE items SET meta = meta || jsonb_build_object('code', (meta->>'code')::int + 1)
WHERE kind = 'toy' AND (meta->>'code')::int BETWEEN 8 AND 11;
