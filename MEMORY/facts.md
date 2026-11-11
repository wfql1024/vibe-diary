# facts — 现在是什么样

> 用途：代码结构地图 + 功能手册，回答"要改 X 去哪、字段叫什么"。
> 不写什么：不写历史、不写日期、不写为什么这么定（去 decisions.md）、不写踩过的坑（去 lessons.md）。
> 更新方式：就地重写（保持它是"当前事实"，不是流水账）。

## 技术栈与运行

- Tauri 2.12 + React 19 + TypeScript 5 + Vite 8；包管理 pnpm；Rust stable（msvc 工具链）。
- 应用标识 `com.peekode.vibeDiary`；窗口最小尺寸 920×620（App 启动时 `setMinSize`）。
- 开发：`pnpm tauri dev`；只构建前端：`pnpm build`（tsc + vite build）。
- **渲染冒烟**：`node scripts/smoke-render.mjs`（SSR 渲染 App / 画布 / 四种日历 / 弹窗，抓渲染期崩溃）。
- VS Code：`Ctrl+Shift+B`（tauri: dev）等任务，见 `.vscode/`。

## 目录地图

```
src/
  App.tsx                 记录页外壳：三层布局（顶栏 / 工具行 / 内容）、筛选、列表、日历切换、批量选择、右栏当日明细
  db.ts                   所有 SQL：检索、区间/热力图、待办、CRUD、批量改、标签与关系
  components/
    CalendarView.tsx      周 / 月 / 年 / 跨年 四种视图（受控：anchor / selected / onOpen / onCreateAt / filter）
    EntryDialog.tsx       新建 / 编辑记录弹窗（完成时间、标题、描述、标签、置顶、周期、截止、提醒、删除）
    BatchEditDialog.tsx   批量修改弹窗（含改动确认清单）
    ConfirmDialog.tsx     通用确认弹窗（标题 + 说明 + 任意个选项 + 取消）
    FilterPanel.tsx       标签 / 主题筛选面板（三态：选中 / 排除 / 取消），两个筛选共用
    TagTokenInput.tsx     标签 token 输入（回车确认、分号结尾、退格删整块、浮层候选）
    TagGraph.tsx          标签画布：渲染、连线、拖动节点、空白拖动平移、滚轮以光标为中心缩放
    tagGraphLayout.ts     纯数学布局（可被 node 直接 import 验证）
    TagManager.tsx        标签管理弹窗（增 / 删 / 改名 / 合并）
src-tauri/
  src/lib.rs              注册 tauri-plugin-sql 与 migration 列表（v1–v5）
  migrations/001_init.sql               四张表 + 索引 + updated_at 触发器
  migrations/002_tag_links_directed.sql tag_links 改为有向（去掉 CHECK）
  migrations/003_entry_todo_fields.sql  entries 加 pinned / repeat_rule / due_at / remind_at
  migrations/004_entry_completed_at.sql entries 加 completed_at（已被 005 合并掉）
  migrations/005_entry_single_datetime.sql 重建 entries：date 可空 = 完成时间，删除 completed_at
scripts/
  smoke-render.mjs        渲染冒烟入口（配合 scripts/smoke-render/ 下的 SSR 小程序）
  repair-entry-tags.mjs   从标题前缀重建 entry_tags（默认预演，--apply 才写）
  import-json.mjs         参考 JSON → SQLite（--dry-run / --reset / --with-links）
  fetch-crates.sh         curl 预下载 crates（本机网络）
docs/  tags.md（功能与规则）、json-import.md、test-checklist.md（§0–§31）
MEMORY/  项目记忆
```

## 数据模型（迁移 v5 之后）

- 库文件：`%APPDATA%\com.peekode.vibeDiary\vibe-diary.db`；迁移随应用启动执行，`_sqlx_migrations` 记录版本。
- **`entries.date` 是唯一的日期时间**（`YYYY-MM-DD` 或 `YYYY-MM-DDTHH:mm`）：既是日记日期也是完成时间；**NULL = 未完成**（进待办）。`status` 列只是兼容同步（completed / pending）。
- 按天聚合一律 `substr(e.date,1,10)`（SQL）或 `dayOf()`（前端）。

| 表 | 字段 |
|---|---|
| entries | id, title, content, status, date(**可空**), created_at, updated_at, pinned, repeat_rule, due_at, remind_at |
| tags | id, name(UNIQUE), color |
| tag_links | source_tag_id, target_tag_id（**有向**：A→B 表示检索 B 时带出 A 的记录） |
| entry_tags | entry_id, tag_id（**重建 entries 表时必须先备份**，见 lessons L12） |

## 记录页结构（三层）

| 层 | 内容 | 压缩策略 |
|---|---|---|
| 1 | 左：app 名 + 统计；右：记录 / 标签画布 / 标签管理 | 先牺牲统计（省略号） |
| 2 | 记一笔 / 搜索框 / 筛选器（标签·主题）/ 视图按钮（列表·周·月·年·跨年） | 只缩搜索框（min-width 240px），整页 min-width 900px |
| 3 | 一栏：列表 / 年 / 跨年；两栏：周 / 月（右栏 = 当日明细 + 今日待办） | 各栏内部滚动，分页条固定在列表底部 |

- 列表：按天分组（未完成分组在最前），行内 `勾选 → 标签 → 内容(单行省略) → 逾期 → 截止 → 置顶`；**点行选中、双击编辑**；每页 20/50/100/200 可调，支持首页/末页/跳页。
- 筛选：标签 / 主题各有三态（选中蓝底、排除划线、取消）；文字只匹配"没被筛选接管的维度"。
- 右栏：选中日期的记录 + 当天到期但未完成的（虚线）；选中今天时追加「待办」区块（全部未完成）。

## 日历四视图

| 视图 | 内容 | 标识 |
|---|---|---|
| 周 | 7 列，每列按可用高度放卡片（正文 3 行，超出折叠 +N） | 今日=日期数字填充；选中=整列边框 |
| 月 | 7×6 网格，每天彩色主题块（最多 4 个 + N） | 今日=日期数字填充；选中=整格边框 |
| 年 | 12 个月 mini 热力图（按天完成数分五档绿系） | 今日=虚框、选中=实框（实线优先，且只在所属月份内） |
| 跨年 | 3 年 × 12 月热力图（按月完成数） | 今日所在月=虚框、选中日所在月=实框 |

- 主题色：优先标签色，没有则 `themeColor(主题名)` 调色板（8 色散列）。
- 到期预告：未完成但 `due_at` 落在区间内的记录以**虚线**出现在周卡片 / 月色块 / 右栏列表。
- 「今日(待办)」按钮：日历跳到今天 + 右栏切到今天。

## 待办语义

- 完成 = `date` 非空；勾选写入当前时间；晚于截止时弹 `ConfirmDialog` 三选一（按当前时间 / 按截止时间 / 取消）。
- 取消勾选：没有截止则把完成时间挪成 `due_at`，再置空 `date`。
- 逾期（系统标签，不入库）：`isOverdue()` —— 已完成看 `date > due_at`，未完成看 `now > due_at`；显示在列表、右栏、周卡片、月色块。

## 关键函数（src/db.ts）

- 检索：`searchEntries({ text, includeTags, excludeTags, includeThemes, excludeThemes, limit, offset })`、`countEntries()`；内部 `buildFilterSql()` 是唯一筛选编译器。
- 区间/热力图：`listEntriesBetween(from,to,filter)`、`dailyCompletedCounts(from,to,filter)`、`listPendingDueBetween(from,to)`、`listPendingEntries()`、`latestEntryDate()`。
- 记录：`createEntry / updateEntry / deleteEntry / batchUpdateEntries / setEntryDate / setEntryDue`。
- 标签：`listTags / tagReach / tagCountLabel / createTag / deleteTag / renameTag / mergeTags / ensureTag / addEntryTag / removeEntryTag / tagsForEntries`。
- 关系：`listTagLinks / createTagLink / deleteTagLink / reachableTagIds`。
- 主题：`THEME_SQL`（标题第一个冒号前）、`listThemes()`。
- 工具：`dayOf / isOverdue / momentKey / momentLabel / today`。

## 画布（参数在 `src/components/tagGraphLayout.ts` 顶部）

| 机制 | 当前值 |
|---|---|
| 圆半径 | 面积 ∝ 数量：`84·√(max(n,50)/max)`，夹 22–84px |
| 圆-圆排斥 | 相连 `r1+r2+32`；隔一跳 +28；同簇 ≥3 跳 +46；跨簇 +52；孤立对 +40 |
| 关系弹簧 | 吸到 `r1+r2+56`，强度 0.13，双向只算一次 |
| 线-圆避让 | 力：间隙 14；绘制：贝塞尔 3 轮绕行 + 贪心选弯曲方向 + 镜像修复 |
| 线-线 | 近距斥力 30px；**真交叉改为各自绕中点反向微旋**；每帧最多解 2 个、同端点 40 帧冷却 |
| 兜底 | 第 25 帧起若仍有交叉就 `untangle()`（旋转/平移/镜像/交换位置 + 整簇平移旋转），最多 3 轮，与 `separateOnce` 交替 |
| 收敛 | 降温 `frames<260 ? max(0.05,1-f/260) : 0`；硬分离 3 轮；连续 5 帧 <0.12px 停；上限 400 帧 |
| 静止 | 进入 idle：绕安息位置做 4.2/3.6px 低频呼吸（约 9s 周期）；悬停时对 1~2 跳邻居持续施力 |
| 视口 | `{zoom, center}`；空白拖动平移；滚轮以光标为中心缩放 40%–300%；可移动范围 = 内容中心 ± 内容尺寸一半 |
| 入场 | 一次性全量加载，`seedNodes()` 按族群铺位（不再分批） |

## 本机环境要点

- Rust：`RUSTUP_HOME=D:\SpaceDev\Env\Infrastructure\runtime\rust\rustup`、`CARGO_HOME=...\cargo`，cargo\bin 已在 PATH。
- MSVC：VS Build Tools 2022 在 `D:\SpaceDev\Env\Infrastructure\runtime\msvc\BuildTools`。
- cargo：清华 http 稀疏索引 + 关闭多路复用；crate 本体用 `scripts/fetch-crates.sh` 预下载后 `--offline`。
- 仓库：`git@github.com:wfql1024/vibe-diary.git`（main）。

## 本机环境与个人数据（不外发，只记在这）

- 参考数据来源：`E:\Now\OneDrive\文档\LocalDocuments\main\日历日程表-导出.json`；脚本默认读仓库内 `data/diary-export.json`（gitignore）。
- 当前库规模：1848 条记录（多来自 2025 全年）、49 个标签、44 条标签关系；`entry_tags` 现为 1533 条（2026-11-12 事故后按前缀重建，见 lessons L12）。
- 库备份：`%APPDATA%\com.peekode.vibeDiary\vibe-diary.db.bak-20261112-041038`（事故当刻）。
