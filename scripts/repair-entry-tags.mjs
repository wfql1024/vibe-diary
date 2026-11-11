#!/usr/bin/env node
// 从标题前缀「X：…」重建 record↔tag 关联（entry_tags）。
// 默认只预演；加 --apply 才写库。写库前请先备份 vibe-diary.db。
// 用法：node scripts/repair-entry-tags.mjs [--db <路径>] [--apply]
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dbIndex = args.indexOf("--db");
const defaultDb = path.join(os.homedir(), "AppData", "Roaming", "com.peekode.vibeDiary", "vibe-diary.db");
const dbPath = dbIndex >= 0 ? args[dbIndex + 1] : defaultDb;

const db = new DatabaseSync(dbPath, { readOnly: !apply });
const tags = db.prepare("SELECT id, name FROM tags").all();
const byName = new Map(tags.map((tag) => [tag.name.toLowerCase(), tag]));
const entries = db.prepare("SELECT id, title, content FROM entries").all();

const pairs = [];
const unmatched = new Map();
for (const entry of entries) {
  const text = (entry.title || entry.content || "").trim();
  const match = text.match(/^\s*([^：:\s]{1,20})\s*[：:]/);
  if (!match) continue;
  const name = match[1].trim().toLowerCase();
  const tag = byName.get(name);
  if (!tag) {
    unmatched.set(name, (unmatched.get(name) || 0) + 1);
    continue;
  }
  pairs.push([entry.id, tag.id]);
}

console.log("库:", dbPath);
console.log("可重建关联:", pairs.length, "条；覆盖标签:", new Set(pairs.map((pair) => pair[1])).size, "/", tags.length);
console.log("未命中前缀（前 10）:", JSON.stringify([...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)));

if (apply) {
  db.exec("BEGIN");
  const stmt = db.prepare("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)");
  for (const [entryId, tagId] of pairs) stmt.run(entryId, tagId);
  db.exec("COMMIT");
  console.log("写入后 entry_tags:", db.prepare("SELECT COUNT(*) n FROM entry_tags").get().n, "行");
} else {
  console.log("（预演模式，未写库；加 --apply 才会写入）");
}
db.close();
