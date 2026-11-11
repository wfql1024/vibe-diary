# vibe-diary · 项目热记忆

> 本文件与 `MEMORY/` 的内容规范严格遵循全局 `~/.dsh/AGENTS.md`。
> 这里只放"每次动手都必须遵守/使用"的内容，事实细节看 `MEMORY/facts.md`。

## 项目是什么

本地日记桌面应用：Tauri 2 + React 19 + TS + SQLite（tauri-plugin-sql）。核心是「记录 + 标签 + 标签关系画布」，目标形态是日历视图。

## 常用命令（在项目根执行）

```bash
pnpm tauri dev                 # 开发：Vite :1420 + 原生窗口
pnpm build                     # 只构建前端（tsc 类型检查 + vite build）——改完前端必跑
node scripts/import-json.mjs --path <导出.json> --dry-run   # 导入（另有 --reset / --with-links）
node .vscode/db-stat.cjs       # 直连库看记录/标签/关系条数（VS Code 任务 db: 统计）
bash scripts/fetch-crates.sh   # 新增 Rust 依赖后，先预下载 crates 再 cargo build --offline
```

## 硬约束

- **数据位置**：`%APPDATA%\com.peekode.vibeDiary\vibe-diary.db`；表结构只经 `src-tauri/migrations/*.sql` 演进，**不要手改数据库结构**（应用启动自动跑 migration）。
- **不改已应用的 migration**：sqlx 校验 checksum，改 001 会让应用启动直接失败；要变更就新增 `00N_*.sql` 并在 `lib.rs` 注册。
- **完成状态只看 `entries.date`**：非空 = 已完成（值就是完成时间，可带 `HH:mm`），`NULL` = 未完成（进待办）。不要再用 `status` 或已删除的 `completed_at` 判定；按天聚合一律 `substr(date,1,10)` / `dayOf()`。
- **重建表前必须备份子表数据**：entry_tags 对 entries(id) 是 ON DELETE CASCADE，而迁移里 PRAGMA foreign_keys = OFF 在事务内不生效；DROP TABLE entries 会把关联全删掉（MEMORY/lessons.md L12）。
- **标签关系只影响检索**：任何"把关系写回 `entry_tags`"的实现都是错的（见 `MEMORY/decisions.md` D3）。
- **`tag_links` 是有向的**：插入/删除/合并都保留原方向，不要排序去重（那是 v1 的 bug，见 `lessons.md` L3）。
- **拼 SQL 占位符必须带 `$`**（`$1..$n`）：漏掉会被 SQLite 当字面量，静默返回错误数据（`lessons.md` L1）。
- **改完代码要看改后原文**：用脚本/模板串生成替换文本时，`$` 和反引号容易被吞（`lessons.md` L2）。
- **Rust 环境**：`RUSTUP_HOME` / `CARGO_HOME` 指向本机独立目录（具体路径见 `MEMORY/facts.md`），cargo 走镜像源；新增 Rust 依赖后先跑 `scripts/fetch-crates.sh` 再 `cargo build --offline`。

## 验证纪律

- 前端改动：`pnpm build` 必须通过（tsc + vite）。
- **改组件后必须跑 `node scripts/smoke-render.mjs`**（SSR 渲染冒烟）：`tsc`/`vite build` 都不检查渲染期错误，而 helper 定义在使用它的 `useMemo` 之后（TDZ）、hooks 顺序错乱这类问题会直接让界面整页空白。
- Rust/迁移改动：`cargo build --offline`（在 `src-tauri` 下）通过即可。
- **不要自己驱动 UI 做端到端测试**（用户明确要求）：改为在 `docs/test-checklist.md` 追加条目，交给用户点。
- 布局/几何类改动：优先在 `node` 里 import `src/components/tagGraphLayout.ts` 做数值验证（间距、交叉、收敛帧），比截图可靠。
- 涉及数据语义的改动：用 `node:sqlite` 直连库跑一遍真实数据核对数字，再交付。

## 记忆规范（摘要，细则看全局）

- **每轮结束时**必须往 `MEMORY/tmp/{当天YYYY-MM-DD}.md` 追加一张卡：`## HH:MM:SS — 主题` + 做了什么/证据/候选去向/状态。只追加、不改过往。
- **不要自行开始整理**：用户说"整理/凝练"时才做，且按天逐份、先列卡片候选去向清单再归置、归置后逐条核对。
- 归置判据：当前事实 → `facts.md`（就地重写）；有分歧的选择 → `decisions.md`；坑 → `lessons.md`；过程与证据 → `dev_logs.md`；台账 → `index.md`。
- 计划与进度写在 `MEMORY/` + 对话里，**不要用 todo_write**（用户要求）。

## 代码风格

- 前端不引额外 UI 库；样式全在 `src/App.css`（单文件、语义类名）。
- 纯逻辑与渲染分离：布局/几何放 `tagGraphLayout.ts`，组件只做渲染与交互。
- 注释只写"为什么"，不复述代码；中文注释。
- **按钮**：只有 `button.primary` 是蓝底（主操作：保存 / 添加 / 记一笔）；其余按钮走基础白底描边样式。不要再用「黑名单排除」的方式定义按钮底色。