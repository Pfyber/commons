-- Surf trucks down to 200 coins (from 6000): pumping's for everyone.
UPDATE items SET meta = jsonb_set(meta, '{buy}', '200') WHERE key = 'trucks_surf';
