#!/usr/bin/env bash
# 将 AGNX Bridge skill 安装到 Cursor / Claude Code / Codex 个人目录。
# 用法（仓库根目录）:
#   ./scripts/install-skill.sh
# 或开源后:
#   curl -fsSL https://raw.githubusercontent.com/<owner>/agnx-bridge/main/scripts/install-skill.sh | bash
set -euo pipefail

REPO_OWNER="${AGNX_BRIDGE_GITHUB_OWNER:-}"
REPO_NAME="${AGNX_BRIDGE_GITHUB_REPO:-agnx-bridge}"
BRANCH="${AGNX_BRIDGE_GITHUB_BRANCH:-main}"
SKILL_NAME="agnx-bridge"

resolve_skill_src() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  if [[ -f "$here/skills/${SKILL_NAME}/SKILL.md" ]]; then
    echo "$here/skills/${SKILL_NAME}"
    return 0
  fi
  return 1
}

install_from_dir() {
  local src="$1"
  local targets=(
    "${HOME}/.cursor/skills/${SKILL_NAME}"
    "${HOME}/.claude/skills/${SKILL_NAME}"
    "${HOME}/.codex/skills/${SKILL_NAME}"
  )

  for dest in "${targets[@]}"; do
    mkdir -p "$(dirname "$dest")"
    rm -rf "$dest"
    mkdir -p "$dest"
    # 兼容 macOS / Linux：优先 rsync，否则 cp
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --delete "$src/" "$dest/"
    else
      cp -R "$src"/. "$dest"/
    fi
    echo "[ok] installed → $dest"
  done

  # 移除旧品牌 skill，避免 Agent 仍命中 webext-bridge
  local legacy_names=("webext-bridge")
  for legacy in "${legacy_names[@]}"; do
    for base in "${HOME}/.cursor/skills" "${HOME}/.claude/skills" "${HOME}/.codex/skills"; do
      local legacy_path="${base}/${legacy}"
      if [[ -e "$legacy_path" || -L "$legacy_path" ]]; then
        rm -rf "$legacy_path"
        echo "[ok] removed legacy skill → $legacy_path"
      fi
    done
  done
}

TMP=""
cleanup() {
  if [[ -n "${TMP}" && -d "${TMP}" ]]; then
    rm -rf "${TMP}"
  fi
}
trap cleanup EXIT

SRC=""
if SRC="$(resolve_skill_src)"; then
  echo "[info] using local skill: $SRC"
  install_from_dir "$SRC"
else
  if [[ -z "$REPO_OWNER" ]]; then
    echo "[error] 未在仓库内运行，且未设置 AGNX_BRIDGE_GITHUB_OWNER。" >&2
    echo "示例: AGNX_BRIDGE_GITHUB_OWNER=yourname curl -fsSL .../install-skill.sh | bash" >&2
    echo "或: npx skills add <owner>/agnx-bridge -g -y" >&2
    exit 1
  fi
  TMP="$(mktemp -d)"
  ARCHIVE_URL="https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/${BRANCH}"
  echo "[info] downloading ${ARCHIVE_URL}"
  curl -fsSL "$ARCHIVE_URL" | tar -xz -C "$TMP"
  SRC="$(find "$TMP" -type f -path "*/skills/${SKILL_NAME}/SKILL.md" | head -1 | xargs dirname)"
  if [[ -z "$SRC" || ! -f "$SRC/SKILL.md" ]]; then
    echo "[error] archive 里找不到 skills/${SKILL_NAME}/SKILL.md" >&2
    exit 1
  fi
  install_from_dir "$SRC"
fi

echo
echo "下一步："
echo "  1. 确认 Chrome 已加载 AGNX Bridge 扩展，并在 popup 里开启桥接"
echo "  2. curl -sS http://localhost:3054/api/agnx-bridge/health"
echo "  3. 在 Cursor / Claude / Codex 里让 Agent 使用 agnx-bridge skill"
