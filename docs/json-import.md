# 参考数据 → SQLite 导入说明

## 1 参考数据的形状

来源是「按天导出」的 JSON：顶层是一个**数组**，每条对应一天里的一个事项。字段示例（内容为虚构）：

```json
{
  "sheet": "Jan",              // 原表格的工作表 = 月份
  "week": 1,                   // 当月第几周
  "date": "2025-01-01",        // 日期 YYYY-MM-DD
  "weekday": "星期三",          // 中文星期
  "isoWeek": 1,                // ISO 周
  "text": "项目：重构登录模块；生活：晚上跑了 5 公里",
  "done": true,                // 是否完成
  "row": 16,                   // 原表格行号
  "cell": "X16"                // 原表格单元格
}
```

正文 `text` 里常见「分类：内容」的写法（示例里是「项目」「生活」），用 `;` / `；` 分段 —— 这就是天然的标签来源。

## 2 映射关系

| JSON 字段 | 去向 |
|---|---|
| `text` | `entries.content`（原样保存） |
| `text` 首段 | `entries.title`（截断 40 字） |
| `done` | `entries.status`：`true` → `completed`，`false` → `pending` |
| `date` | `entries.date`；同时写入 `created_at` / `updated_at` |
| `text` 里每段的「前缀:」 | `tags.name`（出现 ≥2 次才算标签，颜色由名字哈希取） |
| 条目 ↔ 标签 | `entry_tags`；没有可识别前缀的条目挂到「随手记」 |
| 同一天共同出现的标签 | `tag_links` —— **默认不生成**，见下 |
| `sheet` / `week` / `weekday` / `isoWeek` / `row` / `cell` | 不落库；可由 `date` 推导，原始 JSON 保留为事实来源 |

### 2.1 标签关系不自动生成

把「同一天共同出现的标签」两两连成 `tag_links` 噪声很大，所以**默认不生成**：关系由人在应用的「标签画布」里手工连线
（A → B 表示检索 B 时带出 A 的记录）。想自动铺一遍可加 `--with-links`。语义见 [tags.md](tags.md)。

## 3 数据库位置

`%APPDATA%\com.peekode.vibeDiary\vibe-diary.db`（Windows；其他平台为对应的 app config 目录）。
表结构由 `src-tauri/migrations/001_init.sql` 定义，**首次启动应用时自动执行**（幂等）。

## 4 导入步骤

```bash
# 0) 建议先关掉正在运行的 vibe-diary 窗口

# 1) 干跑，只统计不写库
node scripts/import-json.mjs --path <你的.json> --dry-run

# 2) 正式导入到应用默认数据库（目录不存在会自动创建）
node scripts/import-json.mjs --path <你的.json>

# 反复试跑：先清空四张表再导入
node scripts/import-json.mjs --path <你的.json> --reset

# 也可以导入到任意一个独立文件，先验证再覆盖正式库
node scripts/import-json.mjs --path <你的.json> --db ./tmp/test.db
```

脚本用 Node 内置的 `node:sqlite`，**不需要安装任何 npm 依赖**；它执行的就是同一份 `001_init.sql`，
所以无论先跑脚本还是先跑应用，表结构都一致。

脚本最后会打印一份统计（插入 / 跳过 / 标签数 / entry_tags 行数 / tag_links 行数，以及四张表的最终行数）。
按 `date + content` 去重，所以重复执行不会重复插入。

## 5 校验

```bash
node .vscode/db-stat.cjs     # 打印记录/标签/关系条数与全部关系
```

或在应用窗口里看顶部统计，数字应与脚本输出一致。
