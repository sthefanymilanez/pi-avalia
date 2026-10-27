ALTER TABLE normalization_profiles
  ADD COLUMN rules JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE normalization_profiles
SET rules = '{"pageWidthCm":21,"pageHeightCm":29.7,"marginsCm":{"top":3,"left":3,"bottom":2,"right":2},"bodyFontPt":12,"lineSpacing":1.5}'::jsonb
WHERE norm_code ILIKE '%14724%' AND edition = '2011' AND rules = '{}'::jsonb;
