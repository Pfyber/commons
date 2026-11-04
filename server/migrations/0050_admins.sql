-- Admins: players with a few extra powers (for now, zooming out much
-- further to see the city whole). Manci is the first.
ALTER TABLE players ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
UPDATE players SET is_admin = true WHERE lower(display_name) = 'manci';
