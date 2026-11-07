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
