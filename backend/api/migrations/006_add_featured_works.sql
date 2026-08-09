CREATE TABLE IF NOT EXISTS featured_works (
    position SMALLINT PRIMARY KEY,
    work_code VARCHAR(12) NOT NULL UNIQUE REFERENCES works(code) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT featured_works_position_range CHECK (position BETWEEN 1 AND 6)
);

CREATE INDEX IF NOT EXISTS featured_works_work_code_idx
    ON featured_works (work_code);
