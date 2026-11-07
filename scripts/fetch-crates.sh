#!/usr/bin/env bash
# 本机 cargo 直连 https://static.crates.io 会被 TLS 重置（curl 正常），
# 所以用 curl 把 Cargo.lock 里的 .crate 预下载进 cargo 缓存目录，之后 cargo build --offline 即可编译。
#
# 用法（在项目根执行）：
#   bash scripts/fetch-crates.sh            # 补齐缺失的 crate
#   cd src-tauri && cargo build --offline   # 离线编译

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CARGO_HOME_DIR="${CARGO_HOME:-D:/SpaceDev/Env/Infrastructure/runtime/rust/cargo}"
LOCK="$ROOT/src-tauri/Cargo.lock"

if [ ! -f "$LOCK" ]; then
  echo "缺少 $LOCK，先生成："
  echo "  (cd src-tauri && cargo generate-lockfile)"
  exit 1
fi

# 选缓存目录：优先用 registry/cache 下已有的（镜像名-哈希），没有就按 index 目录名推导
CACHE=$(ls -d "$CARGO_HOME_DIR"/registry/cache/*/ 2>/dev/null | head -1)
if [ -z "$CACHE" ]; then
  INDEX=$(basename "$(ls -d "$CARGO_HOME_DIR"/registry/index/*/ 2>/dev/null | head -1)")
  CACHE="$CARGO_HOME_DIR/registry/cache/$INDEX/"
fi
mkdir -p "$CACHE"
echo "cache dir: $CACHE"

LIST=$(mktemp)
node -e '
const fs = require("node:fs");
const txt = fs.readFileSync(process.argv[1], "utf8");
const out = [];
for (const block of txt.split("[[package]]").slice(1)) {
  const name = /name = "([^"]+)"/.exec(block)?.[1];
  const version = /version = "([^"]+)"/.exec(block)?.[1];
  if (name && version && /source = "/.test(block)) out.push(name + " " + version);
}
console.log(out.join("\n"));' "$LOCK" > "$LIST"
echo "crates: $(wc -l < "$LIST")"

fetch_one() {
  set -- $1
  local name=$1 version=$2
  local f="$CACHE/$name-$version.crate"
  [ -s "$f" ] && return 0
  curl -fsSL --retry 6 --retry-delay 2 --max-time 300 -C - -o "$f.part" \
    "https://static.crates.io/crates/$name/$version/download" && mv "$f.part" "$f" || echo "FAIL $name $version"
}
export CACHE
export -f fetch_one

xargs -P 8 -I{} bash -c 'fetch_one "{}"' < "$LIST"
rm -f "$LIST"
echo "done: $(ls "$CACHE" | grep -c "\.crate$") crates cached"
