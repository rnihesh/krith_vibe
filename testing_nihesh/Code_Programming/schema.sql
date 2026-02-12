-- SEFS Database Schema and Sample Queries
-- PostgreSQL compatible

CREATE TABLE IF NOT EXISTS files (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    original_path TEXT NOT NULL UNIQUE,
    current_path TEXT NOT NULL,
    content_hash CHAR(64) NOT NULL,
    embedding BYTEA,
    cluster_id INTEGER DEFAULT -1,
    summary TEXT DEFAULT '',
    file_type VARCHAR(20) DEFAULT '',
    size_bytes BIGINT DEFAULT 0,
    word_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    modified_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_files_cluster ON files(cluster_id);
CREATE INDEX idx_files_hash ON files(content_hash);
CREATE INDEX idx_files_type ON files(file_type);

-- Most common file types
SELECT file_type, COUNT(*) as count, 
       SUM(size_bytes) as total_size,
       AVG(word_count) as avg_words
FROM files 
GROUP BY file_type 
ORDER BY count DESC;

-- Largest clusters
SELECT c.name, c.file_count, 
       STRING_AGG(f.filename, ', ' ORDER BY f.filename) as files
FROM clusters c
JOIN files f ON f.cluster_id = c.id
GROUP BY c.id, c.name, c.file_count
ORDER BY c.file_count DESC
LIMIT 10;

-- Recent activity
SELECT e.event_type, f.filename, e.timestamp
FROM events e
JOIN files f ON f.id = e.file_id
ORDER BY e.timestamp DESC
LIMIT 20;
