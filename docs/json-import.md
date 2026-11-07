# 参考数据 → SQLite 导入说明

## 1. 参考数据是什么样

来源文件：`E:\Now\OneDrive\文档\LocalDocuments\main\日历日程表-导出.json`

顶层是一个**数组**，共 1847 条记录，覆盖 2025-01-01 ~ 2025-12-31 的 365 天（单日最多 10 条）：

```json
{
  "sheet": "Jan",            // 原 Excel 工作表 = 月份（Jan…Dec）
  "week": 1,                 // 当月第几周（1~6）
  "date": "2025-01-01",      // 日期 YYYY-MM-DD
  "weekday": "星期三",        // 中文星期
  "isoWeek": 1,              // ISO 周（1~52）
  "text": "lolm：诶嘿，消耗6个系统盾上了大师；拿了两个五杀；峡谷之巅1胜/1局",
  "done": true,              // 是否完成（1846 条 true，1 条 false）
  "row": 16,                 // 原 Excel 行号
  "cell": "X16"              // 原 Excel 单元格
}
```

正文 `text` 里带有「分类：内容」的写法（`粥` / `SiEm` / `lolm` / `共有` / `暖暖` / `MWM` / `健身` / `生活` / `与姐日常` …），
用 `;` / `；` 分段，这就是天然的标签来源。

## 2. 映射关系

| JSON 字段 | 去向 |
|---|---|
| `text` | `entries.content`（原样保存） |
| `text` 首段 | `entries.title`（截断 40 字） |
| `done` | `entries.status`：`true` → `completed`，`false` → `pending` |
| `date` | `entries.date`；同时写入 `created_at` / `updated_at`（`YYYY-MM-DD 00:00:00`） |
| `text` 里每段的「前缀:」 | `tags.name`（出现 ≥2 次才算标签，颜色由名字哈希从调色板取） |
| 条目 ↔ 标签 | `entry_tags`；没有可识别前缀的条目挂到「随手记」 |
| 同一天共同出现的标签 | `tag_links`（无向边，约定 `source_tag_id < target_tag_id`） |
| `sheet` / `week` / `weekday` / `isoWeek` / `row` / `cell` | 不落库；可由 `date` 推导，原始 JSON 保留为事实来源 |

## 2.1 标签关系不再自动生成

早期版本会把「同一天共同出现的标签」两两连成 `tag_links`，噪声很大，现在**默认不生成**：
关系应当由人在应用的「标签画布」里手工连线（A → B 表示检索 B 时带出 A 的记录）。
想重新铺一遍自动关系可加 `--with-links`，语义见 [tags.md](tags.md)。

## 3. 数据库在哪

Tauri 插件按应用配置目录存放 SQLite（Windows）：

```
%APPDATA%\com.peekode.vibeDiary\vibe-diary.db
# 即 C:\Users\<用户名>\AppData\Roaming\com.peekode.vibeDiary\vibe-diary.db
```

表结构由 `src-tauri/migrations/001_init.sql` 定义，**首次启动应用时由 tauri-plugin-sql 自动执行**（不可重复执行，幂等）。

## 4. 导入步骤

```bash
# 0) 建议先关掉正在运行的 vibe-diary 窗口

# 1) 干跑，只统计不写库
node scripts/import-json.mjs --dry-run

# 2) 正式导入到应用默认数据库（目录不存在会自动创建）
node scripts/import-json.mjs

# 想反复试跑就先清空四张表再导入
node scripts/import-json.mjs --reset

# 也可以导入到任意一个独立文件，先验证再覆盖正式库
node scripts/import-json.mjs --db ./tmp/test.db
```

脚本用 Node 内置的 `node:sqlite`，**不需要安装任何 npm 依赖**；它执行的就是同一份 `001_init.sql`，
所以无论先跑脚本还是先跑应用，表结构都一致。

预期输出（首次）：

```json
{
  "entriesInserted": 1847,
  "entriesSkipped": 0,
  "tags": 44,
  "entryTagRows": 1867,
  "tagLinkRows": 3909,
  "totals": { "entries": 1847, "tags": 44, "tag_links": 267, "entry_tags": 1867 }
}
```

再执行一次会全部进入 `entriesSkipped`（按 `date + content` 去重），不会重复插入。

## 5. 校验

```bash
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.APPDATA+'/com.peekode.vibeDiary/vibe-diary.db');console.log(d.prepare('select count(*) n from entries').get(),d.prepare('select status,count(*) n from entries group by status').all(),d.prepare('select date,content from entries order by date desc limit 3').all())"
```

或在应用窗口里直接看：顶部统计（记录 / 标签 / 标签关系）应显示 `1847 条记录 · 44 个标签 · 267 条标签关系`。
