#!/usr/bin/env bash
# AGNX Bridge 一键安装：native-host + Skill
#
# 在仓库根目录：
#   ./scripts/install.sh
#
# 仓库公开后（不克隆源码，只拉安装脚本 + runtime）：
#   AGNX_BRIDGE_GITHUB_OWNER=<owner> \
#     curl -fsSL https://raw.githubusercontent.com/<owner>/agnx-bridge/main/scripts/install.sh | bash
#
# 可选环境变量：
#   AGNX_BRIDGE_GITHUB_OWNER / AGNX_BRIDGE_GITHUB_REPO / AGNX_BRIDGE_GITHUB_BRANCH
#   AGNX_BRIDGE_SKIP_SKILL=1     # 只装 native-host
#   NATIVE_HOST_BROWSER=chrome|edge|brave|chromium
set -euo pipefail

REPO_OWNER="${AGNX_BRIDGE_GITHUB_OWNER:-}"
REPO_NAME="${AGNX_BRIDGE_GITHUB_REPO:-agnx-bridge}"
BRANCH="${AGNX_BRIDGE_GITHUB_BRANCH:-main}"
SKIP_SKILL="${AGNX_BRIDGE_SKIP_SKILL:-0}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[error] 需要命令: $1" >&2
    exit 1
  }
}

need_cmd node
need_cmd curl
need_cmd tar

ROOT=""
TMP=""
cleanup() {
  if [[ -n "${TMP}" && -d "${TMP}" ]]; then
    rm -rf "${TMP}"
  fi
}
trap cleanup EXIT

resolve_local_root() {
  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd 2>/dev/null || true)"
  if [[ -n "$here" && -f "$here/scripts/install-native-host.mjs" && -d "$here/server" && -d "$here/native-host" ]]; then
    echo "$here"
    return 0
  fi
  return 1
}

download_repo_snapshot() {
  if [[ -z "$REPO_OWNER" ]]; then
    echo "[error] 未在仓库内运行，且未设置 AGNX_BRIDGE_GITHUB_OWNER。" >&2
    echo "示例: AGNX_BRIDGE_GITHUB_OWNER=yourname curl -fsSL .../install.sh | bash" >&2
    exit 1
  fi

  need_cmd mktemp
  TMP="$(mktemp -d)"
  local url="https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/${BRANCH}"
  echo "[info] downloading ${url}"
  curl -fsSL "$url" | tar -xz -C "$TMP"
  local found_script
  found_script="$(find "$TMP" -type f -name "install-native-host.mjs" | head -1)"
  if [[ -z "$found_script" ]]; then
    echo "[error] 下载的归档里找不到 install-native-host.mjs" >&2
    exit 1
  fi
  local found
  found="$(cd "$(dirname "$found_script")/.." && pwd)"
  if [[ ! -f "$found/scripts/install-native-host.mjs" ]]; then
    echo "[error] 下载的归档里找不到 AGNX Bridge 源码布局" >&2
    exit 1
  fi
  echo "$found"
}

if ROOT="$(resolve_local_root)"; then
  echo "[info] using local repo: $ROOT"
else
  ROOT="$(download_repo_snapshot)"
  echo "[info] using downloaded snapshot: $ROOT"
fi

echo "[info] installing native-host…"
(
  cd "$ROOT"
  node ./scripts/install-native-host.mjs
)

if [[ "$SKIP_SKILL" != "1" ]]; then
  echo "[info] installing skill…"
  bash "$ROOT/scripts/install-skill.sh"
fi

echo
echo "========== AGNX Bridge 安装完成 =========="
echo "接下来："
echo "  1. 从 GitHub Releases 下载 chrome-mv3 zip，或在本仓库执行: pnpm build"
echo "  2. Chrome → chrome://extensions → 开发者模式 → 加载已解压扩展"
echo "     目录: <解压后>/chrome-mv3  或  仓库内 .output/chrome-mv3"
echo "  3. 打开扩展 popup → 端口确认 3054 → 开启桥接"
echo "  4. curl -sS http://localhost:3054/api/agnx-bridge/health"
echo "  5. 在 Cursor / Claude / Codex 里使用 agnx-bridge skill"
echo "=========================================="
