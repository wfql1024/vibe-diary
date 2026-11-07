# vibe-diary — 本地日记桌面应用

中文 | [English](README.en.md)

[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev)
[![SQLite](https://img.shields.io/badge/Storage-SQLite-003B57)](https://www.sqlite.org)

## 0 简介

把每天发生的事记成一条条记录，用标签分类；标签之间的关系在画布上手工连线 —— **关系只影响检索，不改记录本身**。数据存在本地 SQLite，不联网。

## 1 功能

### 1.1 记录

- 按日期倒序的列表，支持关键词检索（正文 / 标题 / 日期 / 标签）。
- 每条记录可单独增删标签；输入库里没有的名字会自动创建。
- 快速记录框：日期 + 内容 + 标签（逗号分隔）。

### 1.2 标签与检索

- 标签不重名；删除会提示影响多少条记录；改名撞名时可选择「合并」。
- 数量以 **总数(自身+外部)** 展示：外部 = 通过标签关系带出的、去重后的记录。
- 检索支持 `tag:名称` 语法（类 GitHub 的 `repo:` 写法），可与文字混用；点侧栏标签即插入/移除该标记。

### 1.3 标签画布

- 所有标签铺在画布上：圆的大小对应记录数，位置由「相连的靠拢、隔跳的推开、族群互斥」自动排布，带过渡动画。
- 从一个标签拖到另一个标签 = 建立 **A → B** 关系（检索 B 时也会带出 A 的记录）；关系可成环。
- 双向关系合并为一条双线；点线可删除；可切换「自适应分布 / 自由移动」。

## 2 界面

| 区域 | 作用 |
|---|---|
| 顶部 | 记录 / 标签画布 tab、标签管理入口、统计 |
| 左栏 | 快速记录框 + 记录列表（含每条记录的标签编辑） |
| 右栏 | 搜索框 + 标签云（全部标签，按含关系总数排序） |
| 标签画布 | 标签节点 + 关系连线 |

## 3 快速开始

### 3.1 环境要求

- Node.js 20+ 与 pnpm
- Rust stable（用 rustup 安装）
- Windows：WebView2 运行时；MSVC C++ 构建工具（VS Build Tools 勾「使用 C++ 的桌面开发」）

### 3.2 运行

```bash
pnpm install
pnpm tauri dev     # 开发（Vite :1420 + 原生窗口）
pnpm tauri build   # 打包安装程序
```

用 VS Code 打开**仓库根目录**（不是单个文件）后，`Ctrl+Shift+D` 里有现成的启动配置，`Ctrl+Shift+B` 直接起开发模式。

## 4 数据

### 4.1 数据库

SQLite，位于系统应用配置目录（Windows：`%APPDATA%\com.peekode.vibeDiary\vibe-diary.db`）。首次启动自动建表；表结构由 `src-tauri/migrations/` 下的 SQL 演进。

### 4.2 表

| 表 | 字段 |
|---|---|
| `entries` | id, title, content, status(pending/completed/archived), date, created_at, updated_at |
| `tags` | id, name(唯一), color |
| `tag_links` | source_tag_id, target_tag_id（**有向**：A → B 表示检索 B 时带出 A 的记录） |
| `entry_tags` | entry_id, tag_id |

## 5 开发

```bash
pnpm build   # 前端类型检查（tsc）+ 构建（vite）
```

- `src/` 前端（React + TS），`src-tauri/` Rust 与数据库迁移，`scripts/` 工具脚本，`docs/` 说明文档。
- 画布的纯几何与布局逻辑在 `src/components/tagGraphLayout.ts`，可被 node 直接 import 做数值验证。
- 规则细节见 [docs/tags.md](docs/tags.md)；手工验收清单见 [docs/test-checklist.md](docs/test-checklist.md)。