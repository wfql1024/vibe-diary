#!/usr/bin/env node
// 把「日历日程表-导出.json」导入 SQLite。
//
// 用法（在项目根执行）：
//   node scripts/import-json.mjs                       # 默认 JSON 路径 + 默认数据库
//   node scripts/import-json.mjs --db ./tmp/test.db    # 指定数据库文件（试跑很方便）
//   node scripts/import-json.mjs --dry-run             # 只统计，不写库
//   node scripts/import-json.mjs --reset               # 先清空四张表再导入
//   node scripts/import-json.mjs --with-links          # 额外按"同一天共同出现"自动连一批标签关系（默认不连）
//
// 依赖：Node 22+ 内置的 node:sqlite（不需要 npm 安装任何东西）。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

// 默认读仓库内 data/ 下的导出文件（data/ 已 gitignore）；也可以用 --path 指定任意路径
const DEFAULT_JSON = path.join(process.cwd(), 'data', 'diary-export.json');
const DEFAULT_DB = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'com.peekode.vibeDiary',
  'vibe-diary.db',
);
const MIGRATION = path.join(import.meta.dirname, '..', 'src-tauri', 'migrations', '001_init.sql');

const PALETTE = [
  '#2f6bff', '#e0603c', '#2fa36b', '#9a5bd6', '#c9a227',
  '#1f9bb5', '#d6538a', '#7f8c3a', '#5b6abf', '#b3722e',
];

function parseArgs(argv) {
  const args = { json: DEFAULT_JSON, db: DEFAULT_DB, dryRun: false, reset: false, withLinks: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--json' || key === '--path') args.json = argv[++i];
    else if (key === '--db') args.db = argv[++i];
    else if (key === '--dry-run') args.dryRun = true;
    else if (key === '--reset') args.reset = true;
    else if (key === '--with-links') args.withLinks = true;
    else if (key === '--help' || key === '-h') {
      console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n'));
      process.exit(0);
    }
  }
  return args;
}

const FALLBACK_TAG = '随手记';
const PREFIX_RE = /^([A-Za-z\u4e00-\u9fa5(（][A-Za-z0-9\u4e00-\u9fa5()（）·]{0,9})[:：]/;

/**
 * 从正文提取标签候选：按分号切段，取每段的「前缀:」。
 * 只做语法筛选，出现的次数过滤在 main() 里做（≥2 次才算标签，滤掉正文里偶然出现的冒号）。
 */
function extractTags(text) {
  const tags = new Set();
  for (const segment of String(text).split(/[;；\n]/)) {
    const piece = segment.trim();
    if (!piece) continue;
    const match = PREFIX_RE.exec(piece);
    if (match) tags.add(match[1]);
  }
  return [...tags];
}

function makeTitle(text) {
  const head = String(text).split(/[;；\n。]/)[0].trim();
  return head.length > 40 ? head.slice(0, 40) + '…' : head;
}

function colorFor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) % 100000;
  return PALETTE[hash % PALETTE.length];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.json)) {
    console.error('找不到 JSON 文件: ' + args.json + '\n用 --path <文件> 指定路径，或把导出文件放到 data/diary-export.json');
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(args.json, 'utf8'));
  if (!Array.isArray(raw)) {
    console.error('JSON 顶层不是数组，无法导入');
    process.exit(1);
  }

  console.log('JSON: ' + args.json + '（' + raw.length + ' 条）');
  console.log('DB  : ' + args.db + (args.dryRun ? '  [dry-run]' : ''));

  let db = null;
  if (!args.dryRun) {
    fs.mkdirSync(path.dirname(args.db), { recursive: true });
    db = new DatabaseSync(args.db);
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(fs.readFileSync(MIGRATION, 'utf8')); // 幂等建表，与应用启动时执行的是同一份 SQL
    if (args.reset) {
      db.exec('DELETE FROM entry_tags; DELETE FROM tag_links; DELETE FROM tags; DELETE FROM entries;');
      console.log('已清空 entries / tags / tag_links / entry_tags');
    }
  }

  const selectEntry = db && db.prepare('SELECT id FROM entries WHERE date = ? AND content = ?');
  const insertEntry = db && db.prepare(
    'INSERT INTO entries (title, content, status, date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertTag = db && db.prepare("INSERT INTO tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO NOTHING");
  const selectTag = db && db.prepare('SELECT id FROM tags WHERE name = ?');
  const insertEntryTag = db && db.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING');
  const insertLink = db && db.prepare('INSERT INTO tag_links (source_tag_id, target_tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING');

  // 预处理：解析出条目 + 标签候选，并统计前缀出现次数
  const records = [];
  const prefixCount = new Map();
  for (const item of raw) {
    const content = String(item.text || '').trim();
    if (!content) continue;
    const date = String(item.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const candidates = extractTags(content);
    for (const name of candidates) prefixCount.set(name, (prefixCount.get(name) || 0) + 1);
    records.push({ content, date, candidates, status: item.done === false ? 'pending' : 'completed' });
  }
  const vocabulary = new Set([...prefixCount].filter(([, n]) => n >= 2).map(([name]) => name));

  const tagIds = new Map();
  const tagsByDate = new Map();
  let inserted = 0;
  let skipped = 0;
  let entryTagRows = 0;

  if (db) db.exec('BEGIN');
  for (const { content, date, candidates, status } of records) {
    const stamp = date + ' 00:00:00';

    if (selectEntry && selectEntry.get(date, content)) {
      skipped += 1;
      continue;
    }
    const info = insertEntry.run(makeTitle(content), content, status, date, stamp, stamp);
    const entryId = Number(info.lastInsertRowid);
    inserted += 1;

    const accepted = candidates.filter((name) => vocabulary.has(name));
    for (const name of accepted.length > 0 ? accepted : [FALLBACK_TAG]) {
      if (!tagIds.has(name)) {
        insertTag.run(name, colorFor(name));
        const row = selectTag.get(name);
        tagIds.set(name, Number(row.id));
      }
      insertEntryTag.run(entryId, tagIds.get(name));
      entryTagRows += 1;
      if (!tagsByDate.has(date)) tagsByDate.set(date, new Set());
      tagsByDate.get(date).add(tagIds.get(name));
    }
  }

  // 标签关系默认不生成：关系应当由人在「标签画布」上手工连线（A→B 表示检索 B 时带出 A 的记录）。
  // 想按"同一天共同出现"自动铺一遍再加 --with-links。
  let linkRows = 0;
  if (args.withLinks) {
    for (const ids of tagsByDate.values()) {
      const list = [...ids].sort((a, b) => a - b);
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          insertLink.run(list[i], list[j]);
          linkRows += 1;
        }
      }
    }
  }
  if (db) db.exec('COMMIT');

  const summary = {
    entriesInserted: inserted,
    entriesSkipped: skipped,
    tags: tagIds.size,
    entryTagRows,
    tagLinkRows: linkRows,
  };
  if (db) {
    const count = (table) => Number(db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n);
    summary.totals = {
      entries: count('entries'),
      tags: count('tags'),
      tag_links: count('tag_links'),
      entry_tags: count('entry_tags'),
    };
    db.close();
  }
  console.log(JSON.stringify(summary, null, 2));
}

main();