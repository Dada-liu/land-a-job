#!/usr/bin/env bash
#
# 把仓库里的 skills/ 链到本机 Agent 的 Skill 目录。
#
# 用 symlink 而不是复制：仓库更新即生效，不会出现「装的是上一版」这种最难查的问题。
# 只处理已经装了的 Agent（靠父目录是否存在判断），不在用户机器上凭空造目录。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGETS=("$HOME/.claude/skills" "$HOME/.workbuddy/skills")
LINKED=0

for target in "${TARGETS[@]}"; do
  parent="$(dirname "$target")"
  if [ ! -d "$parent" ]; then
    echo "skip  $(basename "$parent") 未安装（$parent 不存在）"
    continue
  fi
  mkdir -p "$target"
  for skill in "$ROOT"/skills/*/; do
    name="$(basename "$skill")"
    [ -f "${skill}SKILL.md" ] || { echo "skip  $name 缺 SKILL.md"; continue; }
    ln -sfn "${skill%/}" "$target/$name"
    echo "linked $name -> $target/$name"
    LINKED=$((LINKED + 1))
  done
done

if [ "$LINKED" -eq 0 ]; then
  echo "没有安装任何 Skill：请确认 Claude Code 或 WorkBuddy 已安装" >&2
  exit 1
fi

echo
echo "完成。重启 Agent 后生效；versions 必须与 packages/core/src/skills.ts 的 SKILL_REGISTRY 一致。"
