-- 完成时间：有值即视为已完成（至少精确到日期），NULL 即未完成
ALTER TABLE entries ADD COLUMN completed_at TEXT;

-- 旧数据：原来 status = 'completed' 的记录，用记录日期当完成时间
UPDATE entries SET completed_at = date WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_entries_completed ON entries (completed_at);
