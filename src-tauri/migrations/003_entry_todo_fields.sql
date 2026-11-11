-- 记录增加"待办"属性：置顶、周期、截止、提醒
-- 全部可空或有默认值，旧数据不受影响
ALTER TABLE entries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entries ADD COLUMN repeat_rule TEXT NOT NULL DEFAULT '';
ALTER TABLE entries ADD COLUMN due_at TEXT;
ALTER TABLE entries ADD COLUMN remind_at TEXT;

CREATE INDEX IF NOT EXISTS idx_entries_due ON entries (due_at);
CREATE INDEX IF NOT EXISTS idx_entries_pinned ON entries (pinned);
