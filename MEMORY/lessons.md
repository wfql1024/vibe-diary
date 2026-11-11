# lessons — 坑与瓶颈

> 用途：换个人也会再踩的坑（症状 → 根因 → 修法 → 预防），以及未解决的已知问题。
> 不写什么：不写"现在是什么样"（facts.md）、不写决策理由（decisions.md）。
> 更新方式：追加。

## L1 SQL 占位符漏 `$`，静默变成字面量

- 症状：点任何标签筛选，结果恒为同一批（184 条）。
- 根因：`reachableTagIds` 里 `.map((_, index) => `${index + 1}`)` 少了 `$`，SQL 变成 `WHERE id IN (1, 2)`，SQLite 把编号当标签 id 字面量，闭包固定。
- 修法：改成 `$${index + 1}`；并加防呆 `if (!placeholders.startsWith("$")) throw`。
- 预防：拼 SQL 的占位符必须带 `$`；这类错误不报错、只静默返回错数据（"结果恒定"是很强的信号）。

## L2 「修复文本」自己被模板字符串吃掉，导致空操作

- 症状：改完代码、脚本打印"已完成"，但用户复测仍是老行为。
- 根因：我用模板字符串生成替换文本时，`$${index + 1}` 里的 `$` 被吞掉，写回的"修复版"与原文一字不差。
- 修法：用编辑工具直接改，并 `grep -n` 核对改后原文。
- 预防：任何自动替换后都要"读回原文"验证，不能只看脚本输出。

## L3 SQLite 的 CHECK 用来"去重"会吃掉业务方向

- 症状：关系箭头方向随机反、检索方向不对。
- 根因：`CHECK (source_tag_id < target_tag_id)` 强制排序，把有向关系压成无向。
- 修法：migration 002 重建表；去重交给主键 `PRIMARY KEY (source, target)`。
- 预防：约束只用来表达业务规则，别用它实现排序/去重这类"表达技巧"。

## L4 SVG marker 路径写错，箭头静默消失

- 症状：线只有一条，看不到箭头；用户以为没做箭头。
- 根因：marker 的 path 写成 `M 0 0 L 10 5 L 0 0 z`（零面积三角形）。
- 修法：`M 0 0 L 10 5 L 0 10 z`。
- 预防：SVG 的视觉问题不会报错，改完要截图/目视确认。

## L5 稠密图纯力平衡永远不收敛

- 症状：40+ 条关系时画面一直缓慢旋转/蠕动。
- 根因：约束互相冲突，系统维持 ~0.1px/帧 的稳态速度。
- 修法：全局降温（260 帧后 damp=0）+ 连续 5 帧 <0.12px 停 + 硬性分离 pass 兜底。实测 236 帧收敛、冻结后 120 帧残余位移 1.5px。
- 预防：力导向布局必须有"降温 + 停止判据"，不能指望力自然平衡。

## L6 边界夹取会破坏分离约束

- 症状：明明设了最小间隙，仍有圆贴在一起（2px）。
- 根因：先做排斥、后做边界 clamp，clamp 会把被推出画布的圆又挤回来。
- 修法：把「硬性分离」放到整帧最后（clamp 之后）执行。
- 预防：约束的执行顺序决定它是否是硬约束。

## L7 Windows 改了用户环境变量，已开的终端/VS Code 不更新

- 症状：`pnpm tauri dev` 报 `cargo metadata ... program not found`。
- 根因：那个终端是设变量之前启动的，PATH 是旧快照（注册表其实是对的）。
- 修法：新开终端；或在 `settings.json` 的 `terminal.integrated.env.windows` / `tasks.json` 的 env 里显式注入 `RUSTUP_HOME / CARGO_HOME / PATH`。
- 预防：给项目配置注入环境变量，不依赖用户 shell 的状态。

## L8 本机 cargo 直连 crates.io 的 TLS 会被重置

- 症状：`cargo build` 反复 `[35] SSL connect error`，而 curl 拉同一个文件正常。
- 修法：crates.io 换清华 http 稀疏索引（`%CARGO_HOME%\config.toml`，`multiplexing=false`）；crates 本体用 `scripts/fetch-crates.sh` 走 curl 预下载，再 `cargo build --offline`。
- 预防：新增依赖后要重跑一次 fetch-crates.sh。

## L9 rustup 直连下载只有 ~45KB/s

- 修法：`RUSTUP_DIST_SERVER=http://mirrors.tuna.tsinghua.edu.cn/rustup`（http 比 https 通）。曾因超时中断导致 `missing manifest`，需 `rustup toolchain uninstall` 后重装。

## L10 自动化点击可能落到前台窗口上

- 症状：我用 PowerShell 模拟点击验证画布时，坐标打在 Edge/DSH 窗口上（当时 app 在后台）。
- 修法：点前用 `WindowFromPoint` + 进程/根窗口归属校验；或干脆不做 UI 自动化，改由用户按清单测。
- 预防：用户已明确"你不用自己测试，给测试清单就行"。

## 未解决的已知问题

- 标签关系是无限制传递闭包：长链可能让"搜具体标签"带出过多记录（如 `娱乐` 达 1046 条）。若要收敛，可加"最多穿透 N 跳"。
- `pnpm tauri build`（release 打包）未验证过，首次需要下载 NSIS/WiX。

## L11 · helper 定义在 useMemo 之后 = 渲染期 TDZ（整页空白）
- 症状：构建通过但打开应用整页空白，console 报 `Cannot access X before initialization`。
- 根因：`const radiusFor = ...` 定义在用到它的 `useMemo` 之后；tsc / vite build 都不查渲染期。
- 修法：被 hook 回调引用的 helper 一律放在所有 `useMemo` 之前。
- 预防：改组件后跑 `node scripts/smoke-render.mjs`。

## L12 · 迁移里重建表会顺手删掉子表数据（2026-11-12）

- 症状：迁移 005 之后，entries 记录还在、tags / tag_links 也在，但 entry_tags 变成 **0 行** —— 界面上所有标签（列表 / 周视图 / 右栏）全部消失。
- 根因：005 为了去掉 date 的 NOT NULL 约束用了「建新表 → 复制 → DROP TABLE entries → RENAME」。entry_tags 对 entries(id) 是 ON DELETE CASCADE，而迁移脚本里的 PRAGMA foreign_keys = OFF **在事务内不生效**（sqlx 把整个迁移包在一个事务里），于是 DROP 触发级联删除。
- 修法（下次重建表必须这么做）：
  1. 先把子表数据复制到临时表：CREATE TEMP TABLE et_backup AS SELECT * FROM entry_tags;
  2. DROP TABLE entries; ALTER TABLE entries_new RENAME TO entries;
  3. 再灌回去：INSERT OR IGNORE INTO entry_tags SELECT * FROM et_backup;
  4. 或者干脆不重建表：加新列、用空串语义表示未完成，避免动结构。
- 预防：凡是「重建表」的迁移，必须同时备份所有指向它的子表（本项目：entry_tags），并在迁移末尾校验行数。

## L13 · 全局按钮「黑名单」规则会一直漏
- 症状：新加的日历格子、切换条、筛选项全变成蓝底。
- 根因：`button:not(.ghost):not(.danger):not(.chip):not(.tabs button)` 这种"排除法"永远漏。
- 修法：改成**显式** `button.primary` 才是蓝底，其余走基础白底样式。

## L14 · 给几百个单元格逐个绑事件 + 每次渲染重建矩阵 = 拖窗口就卡
- 症状：改窗口尺寸时明显卡顿。
- 根因：年视图 12×42 个 `<button>` 各带 onClick，且每次渲染重新 `monthMatrix()`（造 504 个 Date）。
- 修法：容器级事件委托（`data-day` / `data-heat-day` / `data-month`）+ `useMemo` 缓存矩阵 + 模块级色阶常量 + `memo()` + `content-visibility:auto`。

## L15 · 对象字面量 prop 会废掉 memo
- 症状：日历明明 memo 了还是每次父组件渲染都重画。
- 根因：`filter={{...}}` 每次都是新对象。
- 修法：`useMemo` 固定对象、`useCallback` 固定回调。

## L16 · 同名 ref 冲突：`stateRef` 已被 RelaxState 占用
- 症状：TS 报"无法重新声明块级变量"，改完布局又报 `center does not exist on type RelaxState`。
- 根因：新加的视口状态复用了 `stateRef`。
- 修法：新状态换名 `viewRef`，并把相关读写一起改干净。

## L17 · 用 `indexOf("  return (")` 切文件会误伤缩进的 `return (`
- 症状：脚本"重写 return 之后的内容"把 effect 的 `return () => {...}` 一起截掉，文件语法崩。
- 根因：子串匹配不带行首锚点。
- 修法：带换行匹配（`"\n  return ("`）或按行号 splice，改完立刻看片段。

## L18 · 改了 CSS 却没落盘
- 症状：加了 `.filter-pop{position:absolute}` 但界面还在挤占布局。
- 根因：一次 `write` 静默失败（Windows 文件被占用），我只看了脚本输出的"已完成"。
- 修法/预防：写完 `grep` 验证关键选择器真的在文件里；同一选择器不要留两份定义。

## L19 · `window.confirm` 只能二选一
- 症状：逾期完成需要"按当前 / 按截止 / 干脆不完成"三选一，浏览器 confirm 做不到。
- 修法：自研 `ConfirmDialog`（标题 + 说明 + 任意个选项 + 取消）。

## L20 · 改列之后要全局搜一遍旧列
- 症状：合并字段后日历一直"载入中"。
- 根因：`dailyCompletedCounts` 还在用已删除的 `completed_at`，SQL 报错；同时 `listEntriesBetween` 的区间条件少了 `$`。
- 修法：查询层统一 try/catch/finally 收尾（出错显示"加载失败"而不是永远转圈）；改列后 `grep` 旧列名。

## L21 · 同类输入控件第二次出现就该抽组件
- 症状：标签输入在记录弹窗和批量修改里各写一遍；更早的主题筛选面板因为只改了一处仍是蓝底。
- 修法/预防：抽 `TagTokenInput` / `FilterPanel`，只留一份实现与一份解析口径（`parseTagText`）。
