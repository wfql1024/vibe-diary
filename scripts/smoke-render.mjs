#!/usr/bin/env node
// 渲染冒烟：把 App 和标签画布组件用 SSR 渲染一遍，抓"渲染期崩溃"（TDZ、undefined、hooks 顺序等）。
// tsc / vite build 都不会报这类问题，但界面上就是整页空白。
// 用法：node scripts/smoke-render.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`\n[smoke] 上一步失败：${cmd} ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
};

run("npx", ["vite", "build", "--config", "scripts/smoke-render/vite.config.mjs"]);

for (const name of ["app", "graph", "calendar", "dialog"]) {
  const file = path.join(root, "tmp", "smoke-dist", `${name}.js`);
  if (!fs.existsSync(file)) {
    console.error(`[smoke] 没找到构建产物 ${file}`);
    process.exit(1);
  }
  run("node", [file]);
}

console.log("\n[smoke] 渲染冒烟通过：App 与标签画布都能正常渲染");