-- A lamp (a TV, a fireplace…) left on at home is still on when you come
-- back: whether each piece is switched on is kept with it.
ALTER TABLE home_objects ADD COLUMN lit boolean NOT NULL DEFAULT false;
