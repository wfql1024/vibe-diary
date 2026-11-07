# vibe-diary — a local diary desktop app

[中文](README.md) | English

[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev)
[![SQLite](https://img.shields.io/badge/Storage-SQLite-003B57)](https://www.sqlite.org)

## 0 Overview

Write what happened each day as entries and sort them out with tags; relationships between tags are drawn by hand on a canvas — **relationships only affect retrieval, never the entries themselves**. Everything lives in a local SQLite file; nothing goes online.

## 1 Features

### 1.1 Entries

- List ordered by date (newest first) with keyword search over content / title / date / tags.
- Add or remove tags per entry; a name that does not exist yet is created on the spot.
- Quick composer: date + content + tags (comma separated).

### 1.2 Tags and search

- Tag names are unique; deleting a tag tells you how many entries it affects; renaming onto an existing name offers a merge.
- Counts are shown as **total(self+external)**: external means entries pulled in through tag relationships, de-duplicated.
- Search understands `tag:name` (in the spirit of GitHub `repo:`), mixable with free text; clicking a tag in the sidebar inserts or removes that token.

### 1.3 Tag canvas

- Every tag is laid out on a canvas: the circle size follows the entry count, positions are solved by “connected attract, one hop away push, clusters repel”, animated.
- Drag one tag onto another to create **A → B** (searching B also surfaces A entries); cycles are allowed.
- A bidirectional pair is drawn as one double line; click a line to delete it; switch between automatic layout and free movement.

## 2 UI

| Area | Purpose |
|---|---|
| Top bar | Records / Tag canvas tabs, tag manager, counters |
| Left column | Quick composer + entry list (inline tag editing) |
| Right column | Search box + tag cloud (all tags, sorted by total including relationships) |
| Tag canvas | Tag nodes + relationship lines |

## 3 Quick start

### 3.1 Requirements

- Node.js 20+ and pnpm
- Rust stable (installed through rustup)
- Windows: WebView2 runtime and the MSVC C++ build tools (VS Build Tools with “Desktop development with C++”)

### 3.2 Run

```bash
pnpm install
pnpm tauri dev     # development (Vite on :1420 + native window)
pnpm tauri build   # build installers
```

Opening the **repository root** in VS Code gives you a ready launch configuration under `Ctrl+Shift+D`, and `Ctrl+Shift+B` starts development mode.

## 4 Data

### 4.1 Database

SQLite, stored in the platform app-config directory (Windows: `%APPDATA%\com.peekode.vibeDiary\vibe-diary.db`). Tables are created on first launch; the schema evolves through the SQL files in `src-tauri/migrations/`.

### 4.2 Tables

| Table | Columns |
|---|---|
| `entries` | id, title, content, status(pending/completed/archived), date, created_at, updated_at |
| `tags` | id, name (unique), color |
| `tag_links` | source_tag_id, target_tag_id (**directed**: A → B means searching B also surfaces A entries) |
| `entry_tags` | entry_id, tag_id |

## 5 Development

```bash
pnpm build   # frontend type check (tsc) + bundle (vite)
```

- `src/` frontend (React + TS), `src-tauri/` Rust and database migrations, `scripts/` tooling, `docs/` notes.
- The canvas geometry and layout live in `src/components/tagGraphLayout.ts`, importable from node for numeric checks.
- Rules in detail: [docs/tags.md](docs/tags.md); manual test list: [docs/test-checklist.md](docs/test-checklist.md).