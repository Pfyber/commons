-- Chairs and sofas can be sat on (`seat`); rugs can be walked over (`walk`).
UPDATE items SET meta = meta || '{"seat": true}'
    WHERE key IN ('wooden_chair', 'armchair', 'sofa', 'rocking_chair', 'cozy_armchair', 'bean_bag', 'floor_cushions');
UPDATE items SET meta = meta || '{"walk": true}'
    WHERE key IN ('round_rug', 'rug_persian', 'rug_stripes', 'rug_heart');
