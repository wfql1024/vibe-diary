import Database from "@tauri-apps/plugin-sql";

/** 与 src-tauri/src/lib.rs 中的 DB_URL 必须保持一致 */
const DB_URL = "sqlite:vibe-diary.db";

export type EntryStatus = "pending" | "completed" | "archived";

export interface EntryRow {
  id: number;
  title: string;
  content: string;
  status: EntryStatus;
  /** 唯一的日期时间：既是日记日期也是完成时间（YYYY-MM-DD 或 YYYY-MM-DDTHH:mm）；null = 未完成 */
  date: string | null;
  created_at: string;
  updated_at: string;
  /** 置顶：0/1 */
  pinned: number;
  /** 周期规则：'' | daily | workday | weekly | monthly | yearly | 自定义 */
  repeat_rule: string;
  /** 截止时间：YYYY-MM-DD 或 YYYY-MM-DDTHH:mm */
  due_at: string | null;
  /** 提醒时间 */
  remind_at: string | null;
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

/** 主题 = 标题里第一个「：」之前的部分；没有冒号就整条标题 */
export const THEME_SQL =
  "COALESCE(TRIM(CASE WHEN INSTR(e.title, '：') > 0 THEN SUBSTR(e.title, 1, INSTR(e.title, '：') - 1) " +
  "WHEN INSTR(e.title, ':') > 0 THEN SUBSTR(e.title, 1, INSTR(e.title, ':') - 1) ELSE e.title END), '')";

/** 筛选条件（与 EntrySearch 同构，供日历/明细等处引用） */
export type EntryFilter = EntrySearch;

export interface EntrySearch {
  /** 自由文字：匹配正文，以及"没有被筛选接管"的那几个维度 */
  text?: string;
  /** 选中的标签（同时具备，按传递闭包扩展） */
  includeTags?: string[];
  /** 排除的标签 */
  excludeTags?: string[];
  /** 选中的主题 */
  includeThemes?: string[];
  /** 排除的主题 */
  excludeThemes?: string[];
  limit?: number;
  /** 分页偏移 */
  offset?: number;
}

/**
 * 记录检索。
 * - 标签/主题筛选是 AND；每个标签内部按传递闭包扩展（A→B 时筛 B 也能查到只打了 A 的）。
 * - 自由文字与筛选之间也是 AND，但**文字不再去匹配已被筛选接管的维度**：
 *   标签筛选生效时文字只匹配正文/主题；主题筛选生效时文字只匹配正文/标签；两者都生效只匹配正文。
 */
const ENTRY_COLUMNS =
  "e.id, e.title, e.content, e.status, e.date, e.created_at, e.updated_at, e.pinned, e.repeat_rule, e.due_at, e.remind_at";

/** 把筛选条件编译成 SQL 片段；searchEntries / 区间查询 / 热力图共用这一份 */
async function buildFilterSql(query: EntrySearch) {
  const text = (query.text ?? "").trim();
  const includeTags = query.includeTags ?? [];
  const excludeTags = query.excludeTags ?? [];
  const includeThemes = query.includeThemes ?? [];
  const excludeThemes = query.excludeThemes ?? [];
  const tagsActive = includeTags.length + excludeTags.length > 0;
  const themesActive = includeThemes.length + excludeThemes.length > 0;

  const params: (string | number)[] = [];
  const conditions: string[] = [];
  let cte = "";

  if (text || includeTags.length > 0) {
    const likeParam = text ? `%${text}%` : null;
    if (likeParam !== null) params.push(likeParam);
    const likePh = likeParam !== null ? `$${params.length}` : "";
    cte = `WITH RECURSIVE matched(id) AS (
      SELECT id FROM tags WHERE name LIKE ${likePh || "'%'"}
      UNION
      SELECT l.source_tag_id FROM tag_links l JOIN matched m ON m.id = l.target_tag_id
    )`;
    if (text) {
      const parts = ["e.content LIKE " + likePh];
      if (!themesActive) parts.push("e.title LIKE " + likePh);
      if (!tagsActive) {
        parts.push(
          "EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id AND et.tag_id IN (SELECT id FROM matched))",
        );
      }
      conditions.push("(" + parts.join(" OR ") + ")");
    }
  }

  for (const name of includeTags) {
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

  for (const name of excludeTags) {
    const ids = await reachableTagIds(name);
    if (ids.length === 0) continue;
    const placeholders = ids
      .map((id) => {
        params.push(id);
        return `$${params.length}`;
      })
      .join(", ");
    conditions.push(
      `NOT EXISTS (SELECT 1 FROM entry_tags et WHERE et.entry_id = e.id AND et.tag_id IN (${placeholders}))`,
    );
  }

  for (const theme of includeThemes) {
    params.push(theme);
    conditions.push(`${THEME_SQL} = $${params.length}`);
  }

  for (const theme of excludeThemes) {
    params.push(theme);
    conditions.push(`${THEME_SQL} <> $${params.length}`);
  }

  return { cte, conditions, params };
}

export async function searchEntries(query: EntrySearch = {}): Promise<EntryRow[]> {
  const database = await db();
  const limit = query.limit ?? 300;
  const offset = query.offset ?? 0;
  const { cte, conditions, params } = await buildFilterSql(query);
  params.push(limit, offset);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return database.select<EntryRow[]>(
    `${cte}
     SELECT ${ENTRY_COLUMNS}
       FROM entries e
       ${where}
      ORDER BY (e.date IS NULL) DESC, e.date DESC, e.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
}

/** 同一套筛选条件下的总条数（分页用） */
export async function countEntries(query: EntrySearch = {}): Promise<number> {
  const database = await db();
  const { cte, conditions, params } = await buildFilterSql(query);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await database.select<{ n: number }[]>(`${cte} SELECT COUNT(*) AS n FROM entries e ${where}`, params);
  return Number(rows[0]?.n ?? 0);
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
  /** 唯一的日期时间；null = 未完成 */
  date: string | null;
  content: string;
  /** 主题/标题；留空时取正文第一行 */
  title?: string;
  status?: EntryStatus;
  tags?: string[];
  /** 置顶 */
  pinned?: boolean;
  /** 周期：'' | daily | workday | weekly | monthly | yearly | 自定义文本 */
  repeatRule?: string;
  /** 截止：YYYY-MM-DD 或 YYYY-MM-DDTHH:mm */
  dueAt?: string | null;
  /** 提醒：同上 */
  remindAt?: string | null;
}): Promise<number> {
  const database = await db();
  const content = input.content.trim();
  if (!content) throw new Error("内容不能为空");
  const custom = (input.title ?? "").trim();
  const title = custom || content.split(/[\n；;。]/)[0].slice(0, 40);

  const result = await database.execute(
    "INSERT INTO entries (title, content, status, date, pinned, repeat_rule, due_at, remind_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [
      title,
      content,
      input.date ? "completed" : "pending",
      input.date,
      input.pinned ? 1 : 0,
      input.repeatRule ?? "",
      input.dueAt ?? null,
      input.remindAt ?? null,
    ],
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


/* ---------------- 待办 / 完成状态 ---------------- */

/** 把 "YYYY-MM-DD" 或 "YYYY-MM-DDTHH:mm" 解析成本地时间；只有日期的按当天 23:59 算 */
function parseMoment(value: string | null): Date | null {
  if (!value) return null;
  const text = value.includes("T") ? value : value + "T23:59";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 只取日期部分（YYYY-MM-DD），未完成返回 null */
export function dayOf(row: { date: string | null }): string | null {
  return row.date ? row.date.slice(0, 10) : null;
}

/** 逾期：已完成看「完成时间(date) > 截止时间」，未完成看「现在 > 截止时间」 */
export function isOverdue(row: { date: string | null; due_at: string | null }, now = new Date()): boolean {
  const due = parseMoment(row.due_at);
  if (!due) return false;
  const done = parseMoment(row.date);
  if (done) return done.getTime() > due.getTime();
  return now.getTime() > due.getTime();
}

/** 勾选 / 取消勾选：写或清完成时间，并同步 status 列 */
export async function setEntryDate(entryId: number, value: string | null): Promise<void> {
  const database = await db();
  await database.execute("UPDATE entries SET date = $1, status = $2 WHERE id = $3", [
    value,
    value ? "completed" : "pending",
    entryId,
  ]);
}


/** 只改截止时间（取消勾选且原本没有截止时用） */
export async function setEntryDue(entryId: number, dueAt: string | null): Promise<void> {
  const database = await db();
  await database.execute("UPDATE entries SET due_at = $1 WHERE id = $2", [dueAt, entryId]);
}

/** 本地时间 → "YYYY-MM-DDTHH:mm" */
export function momentKey(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes())
  );
}

/** 展示用：只有日期就显示日期，带时间就显示 日期 时:分 */
export function momentLabel(value: string | null): string {
  if (!value) return "";
  const [day, time] = value.split("T");
  return time ? day + " " + time : day;
}

/** 未完成、但截止时间落在区间内的记录（日历上按截止日"预告"显示） */
export async function listPendingDueBetween(from: string, to: string): Promise<EntryRow[]> {
  const database = await db();
  return database.select<EntryRow[]>(
    "SELECT " + ENTRY_COLUMNS + " FROM entries e" +
      " WHERE e.date IS NULL AND e.due_at IS NOT NULL" +
      " AND substr(e.due_at, 1, 10) >= $1 AND substr(e.due_at, 1, 10) <= $2" +
      " ORDER BY e.due_at, e.id",
    [from, to],
  );
}

/** 所有未完成的事项（不限日期），有截止的排在前面 */
export async function listPendingEntries(): Promise<EntryRow[]> {
  const database = await db();
  return database.select<EntryRow[]>(
    "SELECT " + ENTRY_COLUMNS + " FROM entries e WHERE e.date IS NULL" +
      " ORDER BY (e.due_at IS NULL), e.due_at, e.created_at DESC, e.id DESC",
  );
}

/* ---------------- 日历视图 ---------------- */

/** 取某个日期区间的记录（含首尾），支持与搜索同一套筛选；用于周/月视图与右侧当天明细 */
export async function listEntriesBetween(
  from: string,
  to: string,
  query: EntrySearch = {},
): Promise<EntryRow[]> {
  const database = await db();
  const { cte, conditions, params } = await buildFilterSql(query);
  params.push(from, to);
  conditions.push(`substr(e.date, 1, 10) >= $${params.length - 1}`, `substr(e.date, 1, 10) <= $${params.length}`);
  const where = `WHERE ${conditions.join(" AND ")}`;
  return database.select<EntryRow[]>(
    `${cte} SELECT ${ENTRY_COLUMNS} FROM entries e ${where} ORDER BY e.date, e.id`,
    params,
  );
}

/** 某个日期区间里「每天完成了多少条」，同样支持筛选；返回 date → 数量 */
export async function dailyCompletedCounts(
  from: string,
  to: string,
  query: EntrySearch = {},
): Promise<Map<string, number>> {
  const database = await db();
  const { cte, conditions, params } = await buildFilterSql(query);
  params.push(from, to);
  conditions.push(`substr(e.date, 1, 10) >= $${params.length - 1}`, `substr(e.date, 1, 10) <= $${params.length}`, "e.date IS NOT NULL");
  const where = `WHERE ${conditions.join(" AND ")}`;
  const rows = await database.select<{ date: string; n: number }[]>(
    `${cte} SELECT substr(e.date, 1, 10) AS date, COUNT(*) AS n FROM entries e ${where} GROUP BY substr(e.date, 1, 10)`,
    params,
  );
  return new Map(rows.map((row) => [row.date, Number(row.n)]));
}

export interface BatchPatch {
  /** 完成时间；undefined = 不改，null = 改成未完成 */
  date?: string | null;
  /** 置顶；undefined = 不改 */
  pinned?: boolean;
  /** 截止；undefined = 不改，null = 清空 */
  dueAt?: string | null;
  /** 提醒；undefined = 不改，null = 清空 */
  remindAt?: string | null;
  /** 追加标签 */
  addTags?: string[];
  /** 覆盖正文（留空字符串 = 不改） */
  content?: string;
  /** 追加到正文前面（批量加标记用） */
  prepend?: string;
}

/** 批量改一组记录：共用属性走一条 UPDATE，标签逐条补 */
export async function batchUpdateEntries(ids: number[], patch: BatchPatch): Promise<number> {
  if (ids.length === 0) return 0;
  const database = await db();
  const params: (string | number | null)[] = [];
  const sets: string[] = [];

  if (patch.date !== undefined) {
    params.push(patch.date);
    sets.push(`date = ${params.length}`);
    params.push(patch.date ? "completed" : "pending");
    sets.push(`status = ${params.length}`);
  }
  if (patch.pinned !== undefined) {
    params.push(patch.pinned ? 1 : 0);
    sets.push(`pinned = ${params.length}`);
  }
  if (patch.dueAt !== undefined) {
    params.push(patch.dueAt);
    sets.push(`due_at = ${params.length}`);
  }
  if (patch.remindAt !== undefined) {
    params.push(patch.remindAt);
    sets.push(`remind_at = ${params.length}`);
  }
  if (patch.content) {
    params.push(patch.content);
    sets.push(`content = ${params.length}`);
  }
  if (patch.prepend) {
    params.push(patch.prepend);
    sets.push(`content = ${params.length} || content`);
  }

  const idPlaceholders = ids
    .map((id) => {
      params.push(id);
      return `${params.length}`;
    })
    .join(", ");

  if (sets.length > 0) {
    await database.execute(`UPDATE entries SET ${sets.join(", ")} WHERE id IN (${idPlaceholders})`, params);
  }
  for (const name of patch.addTags ?? []) {
    if (!name.trim()) continue;
    for (const id of ids) await addEntryTag(id, name);
  }
  return ids.length;
}

/** 删除一条记录（连同它的标签关联） */
export async function deleteEntry(entryId: number): Promise<void> {
  const database = await db();
  await database.execute("DELETE FROM entry_tags WHERE entry_id = $1", [entryId]);
  await database.execute("DELETE FROM entries WHERE id = $1", [entryId]);
}

/** 更新一条记录（含标签整体替换） */
export async function updateEntry(
  entryId: number,
  input: {
    /** 唯一的日期时间；null = 未完成 */
    date: string | null;
    content: string;
    title?: string;
    status?: EntryStatus;
    tags?: string[];
    pinned?: boolean;
    repeatRule?: string;
    dueAt?: string | null;
    remindAt?: string | null;
  
  },
): Promise<void> {
  const database = await db();
  const content = input.content.trim();
  if (!content) throw new Error("内容不能为空");
  const custom = (input.title ?? "").trim();
  const title = custom || content.split(/[\n；;。]/)[0].slice(0, 40);
  await database.execute(
    "UPDATE entries SET title = $1, content = $2, status = $3, date = $4, pinned = $5, repeat_rule = $6, due_at = $7, remind_at = $8 WHERE id = $9",
    [
      title,
      content,
      input.date ? "completed" : "pending",
      input.date,
      input.pinned ? 1 : 0,
      input.repeatRule ?? "",
      input.dueAt ?? null,
      input.remindAt ?? null,
      entryId,
    ],
  );
  if (input.tags) {
    await database.execute("DELETE FROM entry_tags WHERE entry_id = $1", [entryId]);
    for (const name of input.tags) {
      if (name.trim()) await addEntryTag(entryId, name);
    }
  }
}

/** 最新一条记录的日期（日历打开时用来定位到有内容的时间段） */
export async function latestEntryDate(): Promise<string | null> {
  const database = await db();
  const [row] = await database.select<{ d: string | null }[]>("SELECT MAX(date) AS d FROM entries");
  return row?.d ?? null;
}

export interface ThemeCount {
  theme: string;
  count: number;
}

/** 所有出现过的主题（标题里第一个冒号之前），按条数排序 */
export async function listThemes(): Promise<ThemeCount[]> {
  const database = await db();
  const rows = await database.select<{ theme: string; count: number }[]>(
    "SELECT " + THEME_SQL + " AS theme, COUNT(*) AS count FROM entries e GROUP BY theme HAVING theme <> '' ORDER BY count DESC, theme",
  );
  return rows.map((row) => ({ theme: row.theme, count: Number(row.count) }));
}