-- tag_links 改为有向存储：A → B 表示「检索 B 时也带出 A 的记录」，方向必须原样保留。
-- v1 里为了去重加了 CHECK (source_tag_id < target_tag_id)，会把用户拖拽的方向反转，这里重建表。
CREATE TABLE IF NOT EXISTS tag_links_directed (
  source_tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  target_tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (source_tag_id, target_tag_id)
);

INSERT OR IGNORE INTO tag_links_directed (source_tag_id, target_tag_id)
  SELECT source_tag_id, target_tag_id FROM tag_links;

DROP TABLE IF EXISTS tag_links;
ALTER TABLE tag_links_directed RENAME TO tag_links;

CREATE INDEX IF NOT EXISTS idx_tag_links_target ON tag_links (target_tag_id);
