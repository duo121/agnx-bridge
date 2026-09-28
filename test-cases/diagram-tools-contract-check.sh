#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DRAWIO_TOOLS="$ROOT_DIR/packages/server/src/diagram-engines/drawio/tools.ts"
EXCALIDRAW_TOOLS="$ROOT_DIR/packages/server/src/diagram-engines/excalidraw/tools.ts"
TOOL_FACADE="$ROOT_DIR/packages/components/src/panes/board-pane/tool-facade.ts"

PASS_COUNT=0

assert_contains() {
  local file="$1"
  local pattern="$2"
  local message="$3"
  if rg -q "$pattern" "$file"; then
    echo "[PASS] $message"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "[FAIL] $message"
    exit 1
  fi
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  local message="$3"
  if rg -q "$pattern" "$file"; then
    echo "[FAIL] $message"
    exit 1
  else
    echo "[PASS] $message"
    PASS_COUNT=$((PASS_COUNT + 1))
  fi
}

assert_save_history_default_false() {
  local file="$1"
  local message="$2"
  if python3 - "$file" <<'PY'
import pathlib
import re
import sys

text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
match = re.search(r"saveHistory\s*:\s*z\s*\.\s*boolean\(\)", text)
if not match:
    raise SystemExit(1)
window = text[match.start():match.start() + 320]
if ".default(false)" not in window:
    raise SystemExit(1)
PY
  then
    echo "[PASS] $message"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "[FAIL] $message"
    exit 1
  fi
}

# Tool names merged to 2 canonical entries
assert_contains "$DRAWIO_TOOLS" '^\s*drawio:\s*\{' 'Drawio tool key exists'
assert_not_contains "$DRAWIO_TOOLS" '^\s*(display_drawio|edit_drawio|convert_plantuml_to_drawio):\s*\{' 'No legacy drawio tool keys exported'

assert_contains "$EXCALIDRAW_TOOLS" '^\s*excalidraw:\s*\{' 'Excalidraw tool key exists'
assert_not_contains "$EXCALIDRAW_TOOLS" '^\s*(display_excalidraw|edit_excalidraw|convert_mermaid_to_excalidraw):\s*\{' 'No legacy excalidraw tool keys exported'

# saveHistory default false in both tool schemas
assert_save_history_default_false "$DRAWIO_TOOLS" 'Drawio saveHistory defaults to false'
assert_save_history_default_false "$EXCALIDRAW_TOOLS" 'Excalidraw saveHistory defaults to false'

# Auto history removed from tool facade (must be gated by saveHistory flag and include explicit false/manual arg)
assert_not_contains "$TOOL_FACADE" 'pushExcalidrawHistory\("AI 生成"\)' 'No unconditional excalidraw generate history push'
assert_not_contains "$TOOL_FACADE" 'pushExcalidrawHistory\("AI 编辑"\)' 'No unconditional excalidraw edit history push'

# Thumbnail closed-loop output
assert_contains "$TOOL_FACADE" 'thumbnailDataUrl' 'Tool facade writes thumbnailDataUrl into tool outputs'

echo "[PASS] Contract checks passed: $PASS_COUNT"
