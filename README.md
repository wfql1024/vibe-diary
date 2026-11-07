# vibe-diary

Tauri 2 + React 19 + TypeScript + SQLite 的本地日记桌面应用。目标形态是日历视图，当前先以列表 + 标签画布展示数据。

## 目录结构

```
vibe-diary/
├─ src/
│  ├─ App.tsx                    应用外壳：记录 / 标签画布 两个 tab
│  ├─ db.ts                      SQLite 访问层（@tauri-apps/plugin-sql）
│  └─ components/
│     ├─ TagGraph.tsx            标签关系画布：拖拽连线、移动、点箭头删除
│     └─ TagManager.tsx          标签管理：增 / 删 / 改名（重名可合并）
├─ src-tauri/
│  ├─ Cargo.toml                 依赖（含 tauri-plugin-sql · sqlite）
│  ├─ tauri.conf.json            应用配置（identifier = com.peekode.vibeDiary）
│  ├─ capabilities/default.json  权限（sql:default + allow-execute）
│  ├─ migrations/001_init.sql    初始表结构
│  └─ src/lib.rs                 注册 sql 插件与 migration
├─ scripts/
│  ├─ import-json.mjs            参考 JSON → SQLite（Node 内置 node:sqlite）
│  └─ fetch-crates.sh            本机网络下预下载 crate
├─ docs/
│  ├─ json-import.md             参考数据结构 + 导入说明
│  └─ tags.md                    标签规则、合并语义、关系语义
└─ MEMORY/                       项目记忆（facts / decisions / lessons / 过程素材）
```

## 表结构

| 表 | 字段 |
|---|---|
| `entries` | id, title, content, status(默认 completed), date, created_at, updated_at |
| `tags` | id, name(唯一), color |
| `tag_links` | source_tag_id, target_tag_id（无向存储，约定 source < target；语义是 A → B 有向） |
| `entry_tags` | entry_id, tag_id |

数据库文件：`%APPDATA%\com.peekode.vibeDiary\vibe-diary.db`，首次启动应用时自动建表（sqlx migration v1）。

## 功能

- **记录列表**：按日期倒序，支持关键词检索（内容 / 标题 / 日期 / 标签，含标签关系的扩展命中）。
- **记录的标签编辑**：每条记录可加标签（输入新名字会自动建标签）、可单条移除标签。
- **标签管理**：标签不重名；删除会从记录中移除并提示影响条数；改名撞名时可选择「合并」。
- **标签画布**：所有标签摊在画布上，从一个标签拖到另一个标签即建立 A → B 关系；关系只影响检索，不改记录。

细节（合并语义、关系语义、已验证行为）见 [docs/tags.md](docs/tags.md)。

## 在 VS Code 里启动

用 **File > Open Folder** 打开仓库根目录 `E:\SpaceDev\Projects\Mine\vibe-diary`（不要只打开单个文件，否则 `${workspaceFolder}`、rust-analyzer、tasks 都会失效）。

| 想干什么 | 怎么做 |
|---|---|
| 启动应用（最常用） | `Ctrl+Shift+D` → 选「▶ 启动 vibe-diary（终端模式，无断点）」→ `F5` |
| 不想开调试面板 | `Ctrl+Shift+B`（默认构建任务 = `tauri: dev`） |
| 前端断点调试 | 选「🐞 前端断点调试（WebView2 :9222）」→ `F5`（会先起 dev，再把调试器挂到 WebView2） |
| 打安装包 | `Ctrl+Shift+P` → `Tasks: Run Task` → `tauri: build` |
| 看库里有几条数据/哪几条关系 | `Tasks: Run Task` → `db: 统计` |

入口文件：`src/main.tsx` → `src/App.tsx`（前端）、`src/db.ts`（SQL）、`src-tauri/src/main.rs` → `src-tauri/src/lib.rs`（Rust）。

注意：`F5` 启动的终端不要关，关掉就是停应用；改 `src/**` 热更新，改 `src-tauri/**` 会自动重编译并重启窗口。

## 开发

```bash
pnpm install
pnpm tauri dev      # 开发模式（Vite :1420 + 原生窗口）
pnpm build          # 只构建前端（tsc 类型检查 + vite build）
pnpm tauri build    # 打安装包（release 编译较慢）
```

## 导入历史数据

参考数据（2025 全年 1847 条）导入方式见 [docs/json-import.md](docs/json-import.md)：

```bash
node scripts/import-json.mjs --dry-run   # 先看统计
node scripts/import-json.mjs             # 写入应用默认数据库（默认不生成标签关系）
```

## 本机 Rust 工具链位置

- `RUSTUP_HOME=D:\SpaceDev\Env\Infrastructure\runtime\rust\rustup`
- `CARGO_HOME=D:\SpaceDev\Env\Infrastructure\runtime\rust\cargo`
- 用户 PATH 已包含 `D:\SpaceDev\Env\Infrastructure\runtime\rust\cargo\bin`（新开终端生效）
- MSVC（VS Build Tools 2022 + Windows SDK）装在 `D:\SpaceDev\Env\Infrastructure\runtime\msvc\BuildTools`

## 网络注意事项（本机实测）

1. **rustup 下载**：直连 static.rust-lang.org 只有 ~45 KB/s，改用清华 http 镜像（`RUSTUP_DIST_SERVER=http://mirrors.tuna.tsinghua.edu.cn/rustup`）后 20+ MB/s。
2. **crates.io 索引**：cargo 直连 `index.crates.io` 的 TLS 会被重置（curl 却正常），已在
   `%CARGO_HOME%\config.toml` 里换成清华 http 稀疏索引，并关闭 http 多路复用。
3. **crate 包下载**：`static.crates.io` 对 cargo 仍会 TLS 重置，所以用
   `bash scripts/fetch-crates.sh`（走 curl，多线程）预下载到 cargo 缓存，再 `cargo build --offline`。
   新增依赖后，重新跑一次该脚本即可。