-- 记录只保留一个时间：entries.date 既当日记日期也当完成时间（可以带 HH:mm），NULL 表示未完成
-- completed_at 与之合并，因此重建表以去掉 NOT NULL 约束
PRAGMA foreign_keys = OFF;

CREATE TABLE entries_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL DEFAULT '',
  content    TEXT    NOT NULL DEFAULT '',
  status     TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'completed', 'archived')),
  date       TEXT,                                   -- YYYY-MM-DD 或 YYYY-MM-DDTHH:mm；NULL = 未完成
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  pinned     INTEGER NOT NULL DEFAULT 0,
  repeat_rule TEXT   NOT NULL DEFAULT '',
  due_at     TEXT,
  remind_at  TEXT
);

INSERT INTO entries_new (id, title, content, status, date, created_at, updated_at, pinned, repeat_rule, due_at, remind_at)
SELECT
  id,
  title,
  content,
  CASE WHEN completed_at IS NOT NULL THEN 'completed' ELSE 'pending' END,
  completed_at,
  created_at,
  updated_at,
  pinned,
  repeat_rule,
  due_at,
  remind_at
FROM entries;

DROP TABLE entries;
ALTER TABLE entries_new RENAME TO entries;

CREATE INDEX IF NOT EXISTS idx_entries_date ON entries (date);
CREATE INDEX IF NOT EXISTS idx_entries_status ON entries (status);
CREATE INDEX IF NOT EXISTS idx_entries_due ON entries (due_at);
CREATE INDEX IF NOT EXISTS idx_entries_pinned ON entries (pinned);

CREATE TRIGGER IF NOT EXISTS trg_entries_updated_at
AFTER UPDATE ON entries
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE entries SET updated_at = datetime('now', 'localtime') WHERE id = NEW.id;
END;

PRAGMA foreign_keys = ON;
