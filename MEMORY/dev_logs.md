# dev_logs — 过程与证据

> 用途：这次/那次是怎么做的、验证了什么，留证据（命令、数字、截图结论）。
> 不写什么：不写"现在是什么样"（facts.md）、不写为什么（decisions.md）、不写坑（lessons.md）。
> 更新方式：追加，按日期分节。

## 2026-11-08

### 从零搭建（00:05–02:20）

- Rust 装 D 盘（rustup 1.29.3 / rustc 1.99.1），winget 静默装 VS Build Tools 2022 到 D 盘；WebView2 已存在（156.0.4314.58）。
- `create-tauri-app` 生成 react-ts 模板（identifier `com.peekode.vibeDiary`）；接入 `tauri-plugin-sql`（sqlite）；写 `migrations/001_init.sql`。
- 导入参考数据：1847 条记录 / 44 标签 / 1867 entry_tags；`_sqlx_migrations` 记录 v1 success=1。
- 首次 `cargo build` 因 `Migration` 未实现 `Clone` 失败 → 改 `fn migrations() -> Vec<Migration>` 通过（1m27s）。
- 网络：rustup 直连 45KB/s → 清华镜像；cargo 索引 TLS 重置 → 清华 http 稀疏索引；crates 用 curl 预下载 529 个包后 `--offline` 构建成功。

### 标签系统（02:55–05:55）

- migration 002 去掉 `tag_links` 的 CHECK（已应用到实库，`sqlite_master` 中该表已无 CHECK）。
- 检索从"一跳 UNION"改递归 CTE；实测建 健身→生活 后搜「生活」59→131；反向搜「健身」77→77；「生活」标签计数仍 57（关系不写回记录）。
- 计数与排序改为 reach：实测 娱乐 1046（自身 0）/ 暖暖 438（自身 156）/ 随手记 316 / 学习 251 / 粥 234 / SiEm 188 / 健身 72 / Dorm 11。
- 标签筛选恒 184 的 bug：占位符漏 `$` → `IN (1,2)`；修复后按标签分别命中，与侧栏数字一致。

### 画布（04:10–05:30）

- 布局抽到 `tagGraphLayout.ts`（纯函数），用 node 直接 import 做数值验证，不再靠肉眼。
- 关键实测（44 个标签、41 条关系）：236 帧收敛；最短可见连线 34px；圆-圆最小间隙 34px；曲线-圆最小间隙 +15.2px；41 条曲线交叉 0；冻结后 120 帧残余位移 1.5px。
- 早期版本对照：包围盒 458×535（正圆团）→ 1135×696（铺满 1200×760 的椭圆）。
- 箭头 marker 曾写成零面积路径导致不可见，已修（4.2 尺寸）。

### 工具链与协作（02:55–03:10）

- VS Code：加 `launch.json`（node-terminal）/ `tasks.json`（dev、build、db 统计）/ `settings.json`（排除 target、注入 Rust 环境变量）；`.gitignore` 放行这四个文件。
- `pnpm tauri dev` 报 cargo not found → 确认是终端环境快照问题（注册表校验通过），靠 terminal env 注入解决。

### 交付状态

- `pnpm build`（tsc + vite）持续通过；dev 常驻运行（vite + tauri + app 三个进程）。
- 仓库：`git init -b main` 后全部改动以暂存方式存放，未提交（本轮合并为一次提交并推送）。

## 2026-11-09 ~ 11-12（画布 / 日历 / 待办 / 批量编辑）

### 画布
- 面积公式改为 `84·√(max(n,50)/max)`，夹 22–84px；`seedNodes()` 按族群铺位；一次全量加载（不再分批）。
- 交叉：过程内每帧最多 2 个 + 40 帧冷却；`untangle()` 兜底（第 25 帧起、最多 3 轮）；渲染层"缺口跨越"。
- 视口：空白拖动平移、滚轮以光标为中心缩放 40%–300%、可移动范围 = 内容 2 倍（`clampCenterToBounds`）。
- 实测（49 标签 / 44 关系）：交叉轨迹 107→12→5→5→5，兜底后 0；最小间隙 29–32px；出界 0。可用高度 360–920px 时周视图放 2–7 张卡且不溢出。

### 日历
- 四种视图（周 / 月 / 年 / 跨年）+ 点击联动 + 今日(待办) 按钮。
- 年视图 12×42 热力格改为事件委托 + memo 后拖窗口不卡。

### 数据模型
- 迁移 003（置顶/周期/截止/提醒）→ 004（completed_at）→ 005（合并成单日期，date 可空）。
- 事故：005 重建表触发 `entry_tags` 级联清空；备份后按标题前缀重建 1533 条（36/49 标签），前 5 标签计数与事故前一致（粥 231 / SiEm 189 / lolm 184 / 共有 178 / 暖暖 156）。

### 验证手段
- 新增 `scripts/smoke-render.mjs`（SSR 渲染 App / 画布 / 四种日历 / 记录弹窗 / 确认弹窗 / 批量弹窗，共 9 项输出）。
- 数值验证统一在 node 里 import `tagGraphLayout.ts` 或直连 `node:sqlite` 跑真库副本。
