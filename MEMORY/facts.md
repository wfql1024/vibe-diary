# facts — 现在是什么样

> 用途：代码结构地图 + 功能手册，回答"要改 X 去哪、字段叫什么"。
> 不写什么：不写历史、不写日期、不写为什么这么定（去 decisions.md）、不写踩过的坑（去 lessons.md）。
> 更新方式：就地重写（保持它是"当前事实"，不是流水账）。

## 技术栈与运行

- Tauri 2.12 + React 19 + TypeScript 5 + Vite 8；包管理 pnpm；Rust 1.99.1（stable-x86_64-pc-windows-msvc）。
- 应用标识 `com.peekode.vibeDiary`；窗口标题 vibe-diary。
- 开发：`pnpm tauri dev`（Vite :1420 + 原生窗口，改 src/** 热更新，改 src-tauri/** 自动重编译重启）。
- 只构建前端：`pnpm build`（tsc 类型检查 + vite build）；打包：`pnpm tauri build`。
- VS Code：`Ctrl+Shift+D` → 「▶ 启动 vibe-diary（终端模式）」或 `Ctrl+Shift+B`（默认任务 tauri: dev）；任务还有 tauri: build / web: build / db: 统计。

## 目录地图

```
src/
  App.tsx              记录页外壳：tab（记录 / 标签画布）、搜索框、写作框、记录列表、侧栏标签云
  db.ts                所有 SQL：searchEntries / listTags / tagReach / 标签 CRUD / 合并 / entry_tags / tag_links
  query.ts             搜索框语法解析：parseQuery / toggleTagToken / hasTagToken
  components/
    TagGraph.tsx       标签画布渲染与交互（连线、移动、删除、双击网格）
    tagGraphLayout.ts  纯数学布局：clustersOf / relax / requiredGap / edgeCurve / sampleCurve（可被 node 直接 import 验证）
    TagManager.tsx     标签管理弹窗（增 / 删 / 改名 / 合并）
src-tauri/
  src/lib.rs           注册 tauri-plugin-sql 与 migration 列表
  migrations/001_init.sql            四张表 + 索引 + updated_at 触发器
  migrations/002_tag_links_directed.sql  去掉 CHECK，tag_links 改为有向
  capabilities/default.json          sql:default + allow-execute/select/load/close
scripts/
  import-json.mjs      参考 JSON → SQLite（node:sqlite，零依赖；--dry-run / --reset / --with-links）
  fetch-crates.sh      本机网络下用 curl 预下载 crates 到 cargo 缓存
docs/tags.md           标签规则、合并语义、关系语义、画布机制表
docs/json-import.md    参考数据结构 + 导入说明
docs/test-checklist.md 手工测试清单（§0–§18）
MEMORY/                项目记忆（本目录）
```

## 数据

- SQLite 文件：`%APPDATA%\com.peekode.vibeDiary\vibe-diary.db`（插件用 `app_config_dir()`）。
- 迁移：v1 建表、v2 重建 tag_links；`_sqlx_migrations` 记录，随应用启动执行。
- 表：

| 表 | 字段 |
|---|---|
| entries | id, title, content, status(pending/completed/archived，默认 completed), date(YYYY-MM-DD), created_at, updated_at |
| tags | id, name(UNIQUE), color |
| tag_links | source_tag_id, target_tag_id（**有向**，A→B 表示检索 B 时带出 A 的记录） |
| entry_tags | entry_id, tag_id |

- 当前数据量参考：1847 条记录、49 个标签、41 条关系。

## 标签系统规则（当前行为）

- 标签无层级；关系可成环；关系**只影响检索，永远不改 entry_tags**。
- 检索闭包 = 传递的：A→B→C 时查 C 会带出 A、B、C 的记录；递归 CTE 用 `UNION` 去重，成环不会死循环。
- 计数文案统一 `总数(自身+外部)`：自身 = 直接打标条数（`usage`），总数 = 含关系去重后的条数（`reach`）。
- 记录页侧栏：**全部**标签都列（含自身 0 条的聚合标签），按 `reach DESC, name` 排序；不再展示关系清单。
- 点侧栏标签 = 往搜索框插入 `tag:名称`（再点移除）。
- 搜索框语法：`tag:名称`（也支持 `tag:"带 空格"`，多个 tag 之间 AND）+ 其余文字做正文/标题/日期匹配；`tag:` 先精确名、找不到才 LIKE 兜底。
- 双向关系（A→B 且 B→A）在画布上合并为一条**双线**（无箭头），删除时两个方向一起删。

## 画布机制（参数在 `src/components/tagGraphLayout.ts` 顶部）

| 机制 | 当前值 |
|---|---|
| 圆半径 | 记录数 sqrt 映射 24–52px |
| 圆-圆排斥 | 相连 `r1+r2+34`；隔一跳 +28；同簇 ≥3 跳 +46；跨簇 +56；孤立对 +40 |
| 关系弹簧 | 吸到 `r1+r2+56`，强度 0.13，双向只算一次 |
| 线-圆避让 | 力：间隙 14 / 推力 0.6；绘制：贝塞尔迭代 3 轮绕行 |
| 线-线 | 斥力最小距离 30px；真交叉时端点镜像硬翻（仅前 220 帧） |
| 族群抱团 | 连通分量向质心收 3.5% |
| 重力 | 向中心，纵向 ×2.2（铺满 1200×760 的椭圆） |
| 收敛 | 降温 `frames<260 ? max(0.05,1-f/260) : 0`；硬性分离 3 轮兜底；连续 5 帧 <0.12px 停；上限 400 帧 |
| 箭头 | marker 4.2，`M 0 0 L 10 5 L 0 10 z` |
| 位置持久化 | 手动模式存 localStorage（`vibe-diary:tag-graph-positions`），自适应开关 `vibe-diary:tag-graph-auto` |

## 关键函数（src/db.ts）

- `searchEntries({ text, tags, limit })`：唯一检索入口，动态拼 SQL（文字条件 + 每个 tag 一个 EXISTS）。
- `reachableTagIds(name)`：精确名→LIKE 兜底→递归闭包（有占位符防呆检查）。
- `listTags()`：带 usage 与 reach，按 reach 降序。
- `createTag / deleteTag / renameTag / mergeTags / ensureTag`；`addEntryTag / removeEntryTag`；`listTagLinks / createTagLink / deleteTagLink`。

## 本机环境要点

- Rust：`RUSTUP_HOME=D:\SpaceDev\Env\Infrastructure\runtime\rust\rustup`、`CARGO_HOME=...\cargo`，cargo\bin 已在用户 PATH。
- MSVC：VS Build Tools 2022 装在 `D:\SpaceDev\Env\Infrastructure\runtime\msvc\BuildTools`（Windows SDK 在 C 盘）。
- cargo 源：`%CARGO_HOME%\config.toml` 用清华 http 稀疏索引 + 关闭多路复用；crates 本体由 `scripts/fetch-crates.sh` 用 curl 预下载。
- 远程仓库：`git@github.com:wfql1024/vibe-diary.git`（分支 main）。
