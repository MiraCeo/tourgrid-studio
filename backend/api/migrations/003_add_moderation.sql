ALTER TABLE works
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_reason VARCHAR(200);

CREATE INDEX IF NOT EXISTS works_active_code_idx
    ON works (code)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS client_bans (
    client_ip INET PRIMARY KEY,
    reason VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
