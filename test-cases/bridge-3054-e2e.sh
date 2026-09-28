#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3054/api/agnx-bridge}"
RESULT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/results"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
PREFIX="$RESULT_DIR/bridge-e2e-$TIMESTAMP"
mkdir -p "$RESULT_DIR"

health_json="$(curl -sS "$BASE/health")"
printf '%s\n' "$health_json" > "${PREFIX}-health.json"

ONLINE_COUNT="$(python3 - <<'PY' "$health_json"
import json,sys
payload=json.loads(sys.argv[1])
print(payload.get('data',{}).get('clients',{}).get('online',0))
PY
)"
if [[ "$ONLINE_COUNT" -lt 1 ]]; then
  echo "[FAIL] No online bridge client"
  exit 1
fi

echo "[PASS] Bridge online clients: $ONLINE_COUNT"

tabs_json="$(curl -sS -X POST "$BASE/exec" -H 'Content-Type: application/json' -d '{"command":{"kind":"browser-agent","method":"tabs.query","args":[{"active":true,"currentWindow":true}]},"waitMs":20000}')"
printf '%s\n' "$tabs_json" > "${PREFIX}-tabs-query.json"

ACTIVE_TAB_ID="$(python3 - <<'PY' "$tabs_json"
import json,sys
payload=json.loads(sys.argv[1])
items=payload.get('data',{}).get('exec',{}).get('result') or []
if not items:
  raise SystemExit(1)
print(items[0]['id'])
PY
)"

echo "[PASS] Active tab id: $ACTIVE_TAB_ID"

page_check_payload="$(python3 - "$ACTIVE_TAB_ID" <<'PY'
import json
import sys

tab_id = int(sys.argv[1])
payload = {
    "command": {
        "kind": "page-agent",
        "tabId": tab_id,
        "timeout": 20000,
        "code": "return { title: document.title, url: location.href, readyState: document.readyState, hasTextarea: !!document.querySelector('textarea'), hasContentEditable: !!document.querySelector('[contenteditable=\\\"true\\\"]') };",
    },
    "waitMs": 20000,
}
print(json.dumps(payload, ensure_ascii=False))
PY
)"

page_check_json="$(curl -sS -X POST "$BASE/exec" -H 'Content-Type: application/json' -d "$page_check_payload")"
printf '%s\n' "$page_check_json" > "${PREFIX}-page-check.json"

READY_STATE="$(python3 - <<'PY' "$page_check_json"
import json,sys
payload=json.loads(sys.argv[1])
result=payload.get('data',{}).get('exec',{}).get('result') or {}
print(result.get('readyState',''))
PY
)"
if [[ "$READY_STATE" != "complete" ]]; then
  echo "[FAIL] Page not ready, readyState=$READY_STATE"
  exit 1
fi

echo "[PASS] Page readyState complete"

start_capture_json="$(curl -sS -X POST "$BASE/exec" -H 'Content-Type: application/json' -d "{\"command\":{\"kind\":\"console-capture\",\"target\":\"page\",\"action\":\"start\",\"tabId\":$ACTIVE_TAB_ID},\"waitMs\":20000}")"
printf '%s\n' "$start_capture_json" > "${PREFIX}-capture-start.json"

echo "[PASS] Console capture started"

marker="bridge-e2e-marker:${TIMESTAMP}"
emit_log_payload="$(python3 - "$ACTIVE_TAB_ID" "$marker" <<'PY'
import json
import sys

tab_id = int(sys.argv[1])
marker = sys.argv[2]
payload = {
    "command": {
        "kind": "page-agent",
        "tabId": tab_id,
        "timeout": 20000,
        "code": f"console.log({marker!r}); return {{ ok: true }};",
    },
    "waitMs": 20000,
}
print(json.dumps(payload, ensure_ascii=False))
PY
)"
emit_log_json="$(curl -sS -X POST "$BASE/exec" -H 'Content-Type: application/json' -d "$emit_log_payload")"
printf '%s\n' "$emit_log_json" > "${PREFIX}-marker-emit.json"

echo "[PASS] Marker log emitted: $marker"

get_log_payload="$(python3 - "$ACTIVE_TAB_ID" "$marker" <<'PY'
import json
import sys

tab_id = int(sys.argv[1])
marker = sys.argv[2]
payload = {
    "command": {
        "kind": "console-capture",
        "target": "page",
        "action": "get",
        "tabId": tab_id,
        "filter": {"keyword": marker, "limit": 20},
    },
    "waitMs": 20000,
}
print(json.dumps(payload, ensure_ascii=False))
PY
)"
get_log_json="$(curl -sS -X POST "$BASE/exec" -H 'Content-Type: application/json' -d "$get_log_payload")"
printf '%s\n' "$get_log_json" > "${PREFIX}-capture-get.json"

LOG_COUNT="$(python3 - <<'PY' "$get_log_json"
import json,sys
payload=json.loads(sys.argv[1])
result=payload.get('data',{}).get('exec',{}).get('result') or []
print(len(result))
PY
)"
if [[ "$LOG_COUNT" -lt 1 ]]; then
  echo "[FAIL] No marker logs captured"
  exit 1
fi

echo "[PASS] Marker logs captured: $LOG_COUNT"

stop_capture_json="$(curl -sS -X POST "$BASE/exec" -H 'Content-Type: application/json' -d "{\"command\":{\"kind\":\"console-capture\",\"target\":\"page\",\"action\":\"stop\",\"tabId\":$ACTIVE_TAB_ID},\"waitMs\":20000}")"
printf '%s\n' "$stop_capture_json" > "${PREFIX}-capture-stop.json"

echo "[PASS] Console capture stopped"
echo "[PASS] Bridge E2E completed. Result prefix: $PREFIX"
