ALTER TABLE featured_works
    DROP CONSTRAINT IF EXISTS featured_works_position_range;

ALTER TABLE featured_works
    ALTER COLUMN position TYPE INTEGER;
