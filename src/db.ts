import Database from "@tauri-apps/plugin-sql";

/** 与 src-tauri/src/lib.rs 中的 DB_URL 必须保持一致 */
const DB_URL = "sqlite:vibe-diary.db";

export type EntryStatus = "pending" | "completed" | "archived";

export interface EntryRow {
  id: number;
  title: string;
  content: string;
  status: EntryStatus;
  date: string;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: number;
  name: string;
  color: string | null;
  /** 直接打了这个标签的记录数 */
  usage: number;
  /** 计入标签关系扩展后的记录数（reach >= usage） */
  reach: number;
}

export interface TagLink {
  source_tag_id: number;
  target_tag_id: number;
}

export interface Stats {
  entries: number;
  tags: number;
  links: number;
}

/** 标签重名（新增/改名时抛出，UI 据此提示或询问是否合并） */
export class TagNameTakenError extends Error {
  readonly existingId: number;
  constructor(name: string, existingId: number) {
    super(`标签「${name}」已存在`);
    this.name = "TagNameTakenError";
    this.existingId = existingId;
  }
}

let connection: Promise<Database> | null = null;

/** 单例连接；首次 await 时插件会执行 Rust 端注册的 migration */
export function db(): Promise<Database> {
  if (!connection) connection = Database.load(DB_URL);
  return connection;
}

export async function getStats(): Promise<Stats> {
  const database = await db();
  const [row] = await database.select<Stats[]>(
    `SELECT (SELECT COUNT(*) FROM entries)   AS entries,
            (SELECT COUNT(*) FROM tags)      AS tags,
            (SELECT COUNT(*) FROM tag_links) AS links`,
  );
  return row;
}

/* ---------------- 记录 ---------------- */

/** 侧栏/画布统一的数量文案：总数(自身+外部)，没有外部就只显示自身 */
export function tagCountLabel(tag: Pick<Tag, "usage" | "reach">): { main: string; extra: string | null } {
  const usage = Number(tag.usage ?? 0);
  const reach = Number(tag.reach ?? usage);
  if (reach > usage) {
    return { main: String(reach), extra: `(${usage}+${reach - usage})` };
  }
  return { main: String(usage), extra: null };
}

/**
 * 标签名 → id 集合（含传递地指向它的标签）。先按精确名匹配，找不到才按"包含"匹配，
 * 这样 tag:X 的结果与侧栏「X 总数(自身+外部)」里的总数完全一致，不会把名字相近的其它标签也算进来。
 */
async function reachableTagIds(name: string): Promise<number[]> {
  const database = await db();
  let seeds = (await database.select<{ id: number }[]>("SELECT id FROM tags WHERE name = $1", [name])).map(
    (row) => Number(row.id),
  );
  if (seeds.length === 0) {
    seeds = (
      await database.select<{ id: number }[]>("SELECT id FROM tags WHERE name LIKE $1", [`%${name}%`])
    ).map((row) => Number(row.id));
  }
  if (seeds.length === 0) return [];

  const placeholders = seeds
    .map((_, index) => `$${index + 1}`)
    .join(", ");
  // 防呆：占位符必须以 $ 开头，否则 SQLite 会把编号当字面量（曾导致筛选结果恒定）
  if (!placeholders.startsWith("$")) throw new Error(`SQL 占位符拼错: ${placeholders}`);
  const rows = await database.select<{ id: number }[]>(
    `WITH RECURSIVE matched(id) AS (
       SELECT id FROM tags WHERE id IN (${placeholders})
       UNION
       SELECT l.source_tag_id FROM tag_links l JOIN matched m ON m.id = l.target_tag_id
     )
     SELECT id FROM matched`,
    seeds,
  );
  return rows.map((row) => Number(row.id));
}

export interface EntrySearch {
  /** 自由文字：匹配正文 / 标题 / 日期 / 标签名（标签名走传递闭包） */
  text?: string;
  /** tag:xxx 过滤，多个之间是"同时具备" */
  tags?: string[];
  limit?: number;
}

/**
 * 记录检索。文字条件与每个 tag: 条件都是 AND；每个 tag: 内部按传递闭包扩展，
 * 所以 A→B 时用 tag:B 也能查到只打了 A 的记录。
 */
export async function searchEntries(query: EntrySearch = {}): Promise<EntryRow[]> {
  const database = await db();
  const limit = query.limit ?? 300;
  const text = (query.text ?? "").trim();
  const params: (string | number)[] = [];
  const conditions: string[] = [];
  let cte = "";

  if (text) {
    params.push(`%${text}%`);
    const ph = `$${params.length}`;
    cte = `WITH RECURSIVE matched(id) AS (
      SELECT id FROM tags WHERE name LIKE ${ph}
      UNION
      SELECT l.source_tag_id FROM tag_links l JOIN matched m ON m.id = l.target_tag_id
    )`;
    conditions.push(
      `(e.content LIKE ${ph} OR e.title LIKE ${ph} OR e.date LIKE ${ph}` +
        ` OR EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id AND et.tag_id IN (SELECT id FROM matched)))`,
    );
  }

  for (const name of query.tags ?? []) {
    const ids = await reachableTagIds(name);
    if (ids.length === 0) {
      conditions.push("0");
      continue;
    }
    const placeholders = ids
      .map((id) => {
        params.push(id);
        return `$${params.length}`;
      })
      .join(", ");
    conditions.push(
      `EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id AND et.tag_id IN (${placeholders}))`,
    );
  }

  params.push(limit);
  const limitPlaceholder = `$${params.length}`;
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return database.select<EntryRow[]>(
    `${cte}
     SELECT e.id, e.title, e.content, e.status, e.date, e.created_at, e.updated_at
       FROM entries e
       ${where}
      ORDER BY e.date DESC, e.id DESC
      LIMIT ${limitPlaceholder}`,
    params,
  );
}

/** 一次取回这批记录的所有标签，避免 N+1 查询 */
export async function tagsForEntries(entryIds: number[]): Promise<Map<number, Tag[]>> {
  const map = new Map<number, Tag[]>();
  if (entryIds.length === 0) return map;
  const database = await db();
  const placeholders = entryIds.map((_, index) => `$${index + 1}`).join(", ");
  const rows = await database.select<(Tag & { entry_id: number })[]>(
    `SELECT et.entry_id, t.id, t.name, t.color, 0 AS usage, 0 AS reach
       FROM entry_tags et JOIN tags t ON t.id = et.tag_id
      WHERE et.entry_id IN (${placeholders})
      ORDER BY t.name`,
    entryIds,
  );
  for (const row of rows) {
    const list = map.get(row.entry_id) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color, usage: 0, reach: 0 });
    map.set(row.entry_id, list);
  }
  return map;
}

export async function createEntry(input: {
  date: string;
  content: string;
  status?: EntryStatus;
  tags?: string[];
}): Promise<number> {
  const database = await db();
  const content = input.content.trim();
  if (!content) throw new Error("内容不能为空");
  const title = content.split(/[\n；;。]/)[0].slice(0, 40);

  const result = await database.execute(
    "INSERT INTO entries (title, content, status, date) VALUES ($1, $2, $3, $4)",
    [title, content, input.status ?? "completed", input.date],
  );
  const entryId = Number(result.lastInsertId);
  for (const name of input.tags ?? []) {
    if (!name.trim()) continue;
    await addEntryTag(entryId, name);
  }
  return entryId;
}

/* ---------------- 标签本身 ---------------- */

/** 每个标签"计入关系"后的记录数：把所有（传递地）指向它的标签的记录去重后统计 */
async function tagReach(): Promise<Map<number, number>> {
  const database = await db();
  const rows = await database.select<{ tag_id: number; reach: number }[]>(
    `WITH RECURSIVE reach(root, node) AS (
       SELECT id, id FROM tags
       UNION
       SELECT r.root, l.source_tag_id
         FROM reach r JOIN tag_links l ON l.target_tag_id = r.node
     )
     SELECT r.root AS tag_id, COUNT(DISTINCT et.entry_id) AS reach
       FROM reach r JOIN entry_tags et ON et.tag_id = r.node
      GROUP BY r.root`,
  );
  return new Map(rows.map((row) => [row.tag_id, Number(row.reach)]));
}

export async function listTags(): Promise<Tag[]> {
  const database = await db();
  const [tags, reach] = await Promise.all([
    database.select<Tag[]>(
      `SELECT t.id, t.name, t.color, COUNT(et.entry_id) AS usage
         FROM tags t LEFT JOIN entry_tags et ON et.tag_id = t.id
        GROUP BY t.id ORDER BY usage DESC, t.name`,
    ),
    tagReach(),
  ]);
  // 排序按"含外部连接的总数"，不是原始条数；总数相同再按名字
  return tags
    .map((tag) => ({ ...tag, reach: reach.get(tag.id) ?? tag.usage }))
    .sort((a, b) => b.reach - a.reach || a.name.localeCompare(b.name));
}

async function findTagByName(name: string): Promise<Tag | undefined> {
  const database = await db();
  const [row] = await database.select<Tag[]>("SELECT id, name, color FROM tags WHERE name = $1", [name]);
  return row;
}

/** 记录里手动输入的新标签：不存在就建，返回 id */
export async function ensureTag(name: string): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("标签名不能为空");
  const existing = await findTagByName(trimmed);
  if (existing) return existing.id;
  const database = await db();
  const result = await database.execute("INSERT INTO tags (name) VALUES ($1)", [trimmed]);
  return Number(result.lastInsertId);
}

export async function createTag(name: string): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("标签名不能为空");
  const existing = await findTagByName(trimmed);
  if (existing) throw new TagNameTakenError(trimmed, existing.id);
  return ensureTag(trimmed);
}

/** 删除标签会同步断开它与记录的关联、以及它作为端点的关系边（记录本身不删） */
export async function deleteTag(tagId: number): Promise<{ affectedEntries: number }> {
  const database = await db();
  const [row] = await database.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM entry_tags WHERE tag_id = $1",
    [tagId],
  );
  await database.execute("DELETE FROM entry_tags WHERE tag_id = $1", [tagId]);
  await database.execute("DELETE FROM tag_links WHERE source_tag_id = $1 OR target_tag_id = $1", [tagId]);
  await database.execute("DELETE FROM tags WHERE id = $1", [tagId]);
  return { affectedEntries: Number(row?.n ?? 0) };
}

/** 纯改名：目标名称已被占用时抛出 TagNameTakenError（由 UI 决定是否合并） */
export async function renameTag(tagId: number, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error("标签名不能为空");
  const clash = await findTagByName(trimmed);
  if (clash && clash.id !== tagId) throw new TagNameTakenError(trimmed, clash.id);
  const database = await db();
  await database.execute("UPDATE tags SET name = $1 WHERE id = $2", [trimmed, tagId]);
}

/**
 * 合并：把 source 的所有引用与关系边改挂到 target，再删除 source。
 * 效果等价于"这些记录加上 target 标签、然后移除 source 标签"。
 */
export async function mergeTags(sourceId: number, targetId: number): Promise<void> {
  if (sourceId === targetId) return;
  const database = await db();

  await database.execute(
    "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT entry_id, $1 FROM entry_tags WHERE tag_id = $2",
    [targetId, sourceId],
  );
  await database.execute("DELETE FROM entry_tags WHERE tag_id = $1", [sourceId]);

  const edges = await database.select<{ s: number; t: number }[]>(
    "SELECT source_tag_id AS s, target_tag_id AS t FROM tag_links WHERE source_tag_id = $1 OR target_tag_id = $1",
    [sourceId],
  );
  const remap = (id: number) => (id === sourceId ? targetId : id);
  for (const edge of edges) {
    const a = remap(edge.s);
    const b = remap(edge.t);
    if (a === b) continue; // 合并后自己连自己：直接丢弃
    await database.execute(
      "INSERT INTO tag_links (source_tag_id, target_tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [a, b],
    );
  }
  await database.execute("DELETE FROM tag_links WHERE source_tag_id = $1 OR target_tag_id = $1", [sourceId]);
  await database.execute("DELETE FROM tags WHERE id = $1", [sourceId]);
}

/* ---------------- 记录 ↔ 标签 ---------------- */

export async function addEntryTag(entryId: number, name: string): Promise<void> {
  const tagId = await ensureTag(name);
  const database = await db();
  await database.execute(
    "INSERT INTO entry_tags (entry_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [entryId, tagId],
  );
}

/** 只解除这条记录的标签关联；标签本身仍留在标签管理里 */
export async function removeEntryTag(entryId: number, tagId: number): Promise<void> {
  const database = await db();
  await database.execute("DELETE FROM entry_tags WHERE entry_id = $1 AND tag_id = $2", [entryId, tagId]);
}

/* ---------------- 标签关系（画布连线） ---------------- */

export async function listTagLinks(): Promise<TagLink[]> {
  const database = await db();
  return database.select<TagLink[]>(
    "SELECT source_tag_id, target_tag_id FROM tag_links ORDER BY source_tag_id, target_tag_id",
  );
}

/** A → B：检索 B 时把 A 的记录也带出来。方向按用户拖拽原样存储。 */
export async function createTagLink(sourceId: number, targetId: number): Promise<void> {
  if (sourceId === targetId) throw new Error("不能连接标签自己");
  const database = await db();
  await database.execute(
    "INSERT INTO tag_links (source_tag_id, target_tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [sourceId, targetId],
  );
}

export async function deleteTagLink(sourceId: number, targetId: number): Promise<void> {
  const database = await db();
  await database.execute(
    "DELETE FROM tag_links WHERE source_tag_id = $1 AND target_tag_id = $2",
    [sourceId, targetId],
  );
}

export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}