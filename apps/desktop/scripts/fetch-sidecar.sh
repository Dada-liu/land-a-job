#!/usr/bin/env bash
# 下载官方 Node 运行时作为后端 sidecar，按 Tauri externalBin 约定命名：
#   binaries/land-server-<target triple>(.exe)
# 用法：bash scripts/fetch-sidecar.sh [target triple]
#   缺省按当前机器推断（darwin/arm64 → aarch64-apple-darwin，win32/x64 → x86_64-pc-windows-msvc）
#
# 版本固定在 v24.19.0：v22 及更早的 Node 在本机 macOS 26 上加载 N-API 原生模块会 segfault
# （better-sqlite3 必现），v24 正常；不要降回 v22。
set -euo pipefail

NODE_VERSION="24.19.0"
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="$HERE/../src-tauri/binaries"
mkdir -p "$BIN_DIR"

TRIPLE="${1:-}"
if [ -z "$TRIPLE" ]; then
  case "$(uname -s)/$(uname -m)" in
    Darwin/arm64) TRIPLE="aarch64-apple-darwin" ;;
    Darwin/x86_64) TRIPLE="x86_64-apple-darwin" ;;
    MINGW*|MSYS*|CYGWIN*/x86_64) TRIPLE="x86_64-pc-windows-msvc" ;;
    Linux/x86_64) TRIPLE="x86_64-unknown-linux-gnu" ;;
    *) echo "无法推断 target triple，请显式传入" >&2; exit 1 ;;
  esac
fi

case "$TRIPLE" in
  *-apple-darwin) DIST="node-v${NODE_VERSION}-darwin-$([ "${TRIPLE%%-*}" = "aarch64" ] && echo arm64 || echo x64)"; EXT="tar.gz"; BIN="node" ;;
  *-pc-windows-msvc) DIST="node-v${NODE_VERSION}-win-x64"; EXT="zip"; BIN="node.exe" ;;
  *) echo "未支持的 target triple：$TRIPLE" >&2; exit 1 ;;
esac

case "$TRIPLE" in
  *-apple-darwin) SUFFIX="" ;;
  *-pc-windows-msvc) SUFFIX=".exe" ;;
esac

OUT="$BIN_DIR/land-server-${TRIPLE}${SUFFIX}"
URL="https://nodejs.org/dist/v${NODE_VERSION}/${DIST}.${EXT}"

if [ -x "$OUT" ]; then
  echo "[sidecar] 已存在 $OUT"
  exit 0
fi

TMP="$(mktemp -d)"
echo "[sidecar] 下载 $URL"
# nodejs.org 在国内网络可能极慢，失败或超时时回退 npmmirror 镜像
if ! curl -fsSL --connect-timeout 15 "$URL" -o "$TMP/dist.$EXT"; then
  MIRROR="https://registry.npmmirror.com/-/binary/node/v${NODE_VERSION}/${DIST}.${EXT}"
  echo "[sidecar] nodejs.org 下载失败，改用镜像 $MIRROR"
  curl -fsSL "$MIRROR" -o "$TMP/dist.$EXT"
fi
if [ "$EXT" = "tar.gz" ]; then
  tar -xzf "$TMP/dist.$EXT" -C "$TMP"
else
  unzip -q "$TMP/dist.$EXT" -d "$TMP"
fi
cp "$TMP/$DIST/$BIN" "$OUT"
chmod +x "$OUT"
rm -rf "$TMP"
echo "[sidecar] 完成 $OUT"
