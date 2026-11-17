#!/usr/bin/env bash
# 把本地服务注册成 launchd 常驻任务（P7-7）。
#
# 为什么不让用户每次开终端：这个应用的定位是「关掉终端也能用」。
# launchd 负责开机自启 + 进程退出后拉起，日志落在 data/logs/，出问题能回看。
#
# 用法：
#   bash scripts/install-launchd.sh            # 安装并立即启动
#   bash scripts/install-launchd.sh --uninstall
#   bash scripts/install-launchd.sh --status
set -euo pipefail

LABEL="cn.landajob.server"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$ROOT/data/logs"

# 选 node：只认「版本够 + 真能加载本项目的两个硬依赖」的候选。
#
# 两个坑都是实测出来的，光看版本号会踩：
# 1. 22.12 以下 `require()` 不能加载 ESM 包，`@fastify/static` 直接抛 ERR_REQUIRE_ESM；
# 2. **本机 v22.12.0 / v22.13.1 打开 better-sqlite3 会静默段错误（exit 139）**，
#    v22.22.2 与 v24.19.0 正常。所以每个候选都真跑一次 require + 开库。
pick_node() {
  local candidate ver major minor
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node "$(command -v node || true)"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    ver="$("$candidate" -p 'process.versions.node' 2>/dev/null || true)"
    [ -n "$ver" ] || continue
    major="${ver%%.*}"
    minor="${ver#*.}"
    minor="${minor%%.*}"
    # 22.0–22.21 的 22.x 在本机会段错误，先按版本挡掉，省得逐个跑出 core dump
    [ "${major:-0}" -ge 22 ] 2>/dev/null || continue
    if [ "$major" = "22" ] && [ "${minor:-0}" -lt 22 ] 2>/dev/null; then continue; fi
    ( cd "$ROOT" && "$candidate" -e \
        "require('@fastify/static'); const D=require('better-sqlite3'); const db=new D(':memory:'); db.prepare('select 1').get(); db.close()" \
        >/dev/null 2>&1 ) || continue
    echo "$candidate"
    return 0
  done
  return 1
}
NODE_BIN="$(pick_node || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "找不到能同时加载 @fastify/static 与 better-sqlite3 的 Node 22+。" >&2
  echo "先在某个 22.x 上执行 npm rebuild better-sqlite3，或用你跑通 npm run dev 的那个 node。" >&2
  exit 1
fi
echo "使用 node：${NODE_BIN}（$("${NODE_BIN}" -v)）"

if [[ "${1:-}" == "--status" ]]; then
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    launchctl print "gui/$(id -u)/$LABEL" | sed -n '1,12p'
  else
    echo "未安装（找不到 $LABEL）"
  fi
  exit 0
fi

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "已卸载 $LABEL（数据目录 data/ 未删除）"
  exit 0
fi

# 先确保有构建产物：launchd 拉起的是 dist，不是 dev server
if [[ ! -f "$ROOT/apps/server/dist/index.js" ]]; then
  echo "缺少构建产物，先跑一次 npm run build" >&2
  exit 1
fi

# 扩展的 CORS 白名单必须写进 plist：launchd 的进程不会继承你终端的 env，
# 只 export 一下是没用的，重装后扩展会直接 401（预检被鉴权钩子拦掉）。
# 重装时若没显式给值，就沿用上一次 plist 里的，避免「重装一次白名单就没了」。
EXT_ORIGINS="${LAND_EXTENSION_ORIGINS:-}"
if [[ -z "$EXT_ORIGINS" && -f "$PLIST" ]]; then
  EXT_ORIGINS="$(plutil -extract EnvironmentVariables.LAND_EXTENSION_ORIGINS raw -o - "$PLIST" 2>/dev/null || true)"
fi
EXT_ENV_BLOCK=""
if [[ -n "$EXT_ORIGINS" ]]; then
  EXT_ENV_BLOCK="    <key>LAND_EXTENSION_ORIGINS</key>
    <string>$EXT_ORIGINS</string>"
fi

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$ROOT/apps/server/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <!-- launchd 的 PATH 很短，不补上的话任何子进程调用（如 Chrome、git）都会失败 -->
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
$EXT_ENV_BLOCK
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/launchd.err.log</string>
</dict>
</plist>
PLIST_EOF

# 已存在就先卸掉，否则 bootstrap 会因「service already loaded」失败
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
# 沙箱化的宿主（IDE / 编辑器内置终端）没有向 launchd 注册服务的权限，
# 连一个 /bin/sleep 的最小 plist 也会报 `Bootstrap failed: 5: Input/output error`。
# 这种情况不是脚本或 plist 的问题，换到「终端」App 执行即可。
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST"; then
  echo "" >&2
  echo "注册失败：当前会话可能没有 launchd 权限（常见于 IDE/应用的沙箱终端）。" >&2
  echo "plist 已经写好，换到「终端」App 执行下面任意一条即可：" >&2
  echo "  LAND_EXTENSION_ORIGINS=$EXT_ORIGINS bash $ROOT/scripts/install-launchd.sh" >&2
  echo "  launchctl bootstrap gui/$(id -u) $PLIST" >&2
  exit 1
fi
launchctl enable "gui/$(id -u)/$LABEL"

echo "已安装：$PLIST"
echo "日志：$LOG_DIR/launchd.out.log"
if [[ -n "$EXT_ORIGINS" ]]; then
  echo "扩展白名单：$EXT_ORIGINS"
else
  echo "扩展白名单：未设置（扩展调本地 API 会 401）；重装时带上 LAND_EXTENSION_ORIGINS=<扩展ID>"
fi
echo "打开 http://127.0.0.1:4399 （端口见 data/.port）"
echo "卸载：bash scripts/install-launchd.sh --uninstall"
