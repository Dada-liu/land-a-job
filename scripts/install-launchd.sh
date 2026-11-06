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
NODE_BIN="$(command -v node || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "找不到 node，请先安装 Node 22+ 并确保它在 PATH 里" >&2
  exit 1
fi

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
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "已安装：$PLIST"
echo "日志：$LOG_DIR/launchd.out.log"
echo "打开 http://127.0.0.1:4399 （端口见 data/.port）"
echo "卸载：bash scripts/install-launchd.sh --uninstall"
