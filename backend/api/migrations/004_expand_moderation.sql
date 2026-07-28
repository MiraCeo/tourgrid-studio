ALTER TABLE works
    ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(16)
        NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS moderation_reason VARCHAR(500),
    ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;

UPDATE works
SET
    moderation_status = 'hidden',
    moderated_at = deleted_at,
    moderation_reason = deleted_reason
WHERE deleted_at IS NOT NULL
  AND moderation_status = 'active';

ALTER TABLE works
    DROP CONSTRAINT IF EXISTS works_moderation_status,
    DROP CONSTRAINT IF EXISTS works_pixel_data_length;

ALTER TABLE works
    ALTER COLUMN pixel_data DROP NOT NULL;

ALTER TABLE works
    ADD CONSTRAINT works_moderation_status CHECK (
        moderation_status IN ('active', 'hidden', 'purged')
    ),
    ADD CONSTRAINT works_pixel_data_length CHECK (
        pixel_data IS NULL OR octet_length(pixel_data) = 432
    ),
    ADD CONSTRAINT works_purged_content_removed CHECK (
        moderation_status <> 'purged'
        OR (
            pixel_data IS NULL
            AND author_name IS NULL
            AND title IS NULL
        )
    );

CREATE INDEX IF NOT EXISTS works_moderation_list_idx
    ON works (moderation_status, id DESC);

CREATE TABLE IF NOT EXISTS work_tombstones (
    code VARCHAR(12) PRIMARY KEY REFERENCES works (code) ON DELETE CASCADE,
    canonical_content_hash BYTEA NOT NULL UNIQUE,
    schema_version SMALLINT NOT NULL,
    palette_id VARCHAR(64) NOT NULL,
    palette_version SMALLINT NOT NULL,
    reason VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT work_tombstones_hash_length CHECK (
        octet_length(canonical_content_hash) = 32
    )
);

CREATE TABLE IF NOT EXISTS moderation_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    action VARCHAR(32) NOT NULL,
    target_type VARCHAR(32) NOT NULL,
    target_value VARCHAR(128) NOT NULL,
    reason VARCHAR(500),
    request_id VARCHAR(64),
    administrator_ip INET,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS moderation_events_created_at_idx
    ON moderation_events (id DESC);
