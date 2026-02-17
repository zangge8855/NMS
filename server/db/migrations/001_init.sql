-- NMS DB bootstrap schema
-- NOTE: Runtime uses ensureDbSchema() for idempotent creation.

-- Replace nms_dev with your DB_SCHEMA when executing manually.
CREATE SCHEMA IF NOT EXISTS nms_dev;

CREATE TABLE IF NOT EXISTS nms_dev.store_snapshots (
    store_key TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    payload_size INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS nms_dev.runtime_modes (
    id SMALLINT PRIMARY KEY,
    read_mode TEXT NOT NULL,
    write_mode TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO nms_dev.runtime_modes (id, read_mode, write_mode)
VALUES (1, 'file', 'file')
ON CONFLICT (id) DO NOTHING;
