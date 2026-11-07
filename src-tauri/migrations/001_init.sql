-- vibe-diary · 初始表结构
-- 说明：本文件同时被 Tauri(tauri-plugin-sql/sqlx) 与 scripts/import-json.mjs 使用，
-- 因此每条语句都必须幂等（IF NOT EXISTS），保证两条路径可以任意顺序执行。

PRAGMA foreign_keys = ON;

-- 日记条目
CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL DEFAULT '',
  content    TEXT    NOT NULL DEFAULT '',
  status     TEXT    NOT NULL DEFAULT 'completed'
                     CHECK (status IN ('pending', 'completed', 'archived')),
  date       TEXT    NOT NULL,                       -- YYYY-MM-DD（本地日期）
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_entries_date   ON entries (date);
CREATE INDEX IF NOT EXISTS idx_entries_status ON entries (status);

-- 标签
CREATE TABLE IF NOT EXISTS tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT    NOT NULL UNIQUE,
  color TEXT
);

-- 标签之间的图关系（无向边：约定 source_tag_id < target_tag_id，查询时双向 UNION）
CREATE TABLE IF NOT EXISTS tag_links (
  source_tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  target_tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (source_tag_id, target_tag_id),
  CHECK (source_tag_id < target_tag_id)
);

CREATE INDEX IF NOT EXISTS idx_tag_links_target ON tag_links (target_tag_id);

-- 条目与标签的多对多关联
CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id INTEGER NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags (tag_id);

-- updated_at 自动维护（第二次 UPDATE 时 WHEN 不成立，不会递归）
CREATE TRIGGER IF NOT EXISTS trg_entries_updated_at
AFTER UPDATE ON entries
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE entries SET updated_at = datetime('now', 'localtime') WHERE id = NEW.id;
END;
