CREATE TABLE IF NOT EXISTS works (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(12) NOT NULL UNIQUE,
    schema_version SMALLINT NOT NULL,
    palette_id VARCHAR(64) NOT NULL,
    palette_version SMALLINT NOT NULL,
    pixel_data BYTEA NOT NULL,
    content_hash BYTEA NOT NULL UNIQUE,
    author_name VARCHAR(80),
    title VARCHAR(120),
    view_count BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT works_code_format CHECK (
        code ~ '^[1-9A-HJ-NP-Za-km-z]{12}$'
    ),
    CONSTRAINT works_schema_version CHECK (schema_version = 1),
    CONSTRAINT works_pixel_data_length CHECK (octet_length(pixel_data) = 432),
    CONSTRAINT works_content_hash_length CHECK (octet_length(content_hash) = 32),
    CONSTRAINT works_view_count_nonnegative CHECK (view_count >= 0)
);

CREATE INDEX IF NOT EXISTS works_created_at_idx ON works (created_at);
