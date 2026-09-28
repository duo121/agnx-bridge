#!/bin/sh
set -eu

# 可通过环境变量覆盖：
#   BASE=http://localhost:3054/api/agnx-bridge sh .../test-login.sh
#   LOGIN_URL=... sh .../test-login.sh
BASE="${BASE:-http://localhost:3054/api/agnx-bridge}"
LOGIN_URL="${LOGIN_URL:-https://practicetestautomation.com/practice-test-login/}"
OUTPUT_FILE="${OUTPUT_FILE:-/tmp/pta-login-capture.json}"
LOGIN_USERNAME="${LOGIN_USERNAME:-student}"
LOGIN_PASSWORD="${LOGIN_PASSWORD:-Password123}"

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUILD_CAPTURE_SCRIPT="$SCRIPT_DIR/build-network-capture-command.mjs"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[ERR] 缺少命令: $1" >&2
    exit 127
  fi
}

need_cmd curl
need_cmd jq
need_cmd node

if [ ! -f "$BUILD_CAPTURE_SCRIPT" ]; then
  echo "[ERR] 未找到脚本: $BUILD_CAPTURE_SCRIPT" >&2
  exit 1
fi

exec_bridge_payload() {
  payload="$1"
  resp=$(curl -sS -X POST "$BASE/exec" \
    -H 'Content-Type: application/json' \
    -d "$payload")

  success=$(printf "%s" "$resp" | jq -r '.success // false')
  if [ "$success" != "true" ]; then
    err=$(printf "%s" "$resp" | jq -r '.error // "bridge exec 失败"')
    echo "[ERR] $err" >&2
    return 1
  fi

  exec_id=$(printf "%s" "$resp" | jq -r '.data.exec.execId // empty')
  status=$(printf "%s" "$resp" | jq -r '.data.exec.status // empty')

  case "$status" in
    succeeded|failed|timeout)
      printf "%s" "$resp"
      return 0
      ;;
  esac

  if [ -z "$exec_id" ]; then
    echo "[ERR] bridge exec 缺少 execId" >&2
    return 1
  fi

  i=0
  while [ "$i" -lt 140 ]; do
    i=$((i + 1))
    sleep 1
    polled=$(curl -sS "$BASE/exec/$exec_id")
    pstatus=$(printf "%s" "$polled" | jq -r '.data.exec.status // empty')
    case "$pstatus" in
      succeeded|failed|timeout)
        printf "%s" "$polled"
        return 0
        ;;
    esac
  done

  echo "[ERR] exec 轮询超时: $exec_id" >&2
  return 1
}

exec_bridge_payload_retry() {
  payload="$1"
  label="$2"
  max_try="${3:-3}"

  try=1
  while [ "$try" -le "$max_try" ]; do
    output=$(exec_bridge_payload "$payload" 2>&1) && {
      printf "%s" "$output"
      return 0
    }

    echo "[WARN] $label 第${try}次失败：$output" >&2
    if [ "$try" -lt "$max_try" ]; then
      sleep 2
    fi
    try=$((try + 1))
  done

  echo "[ERR] $label 重试失败" >&2
  return 1
}

echo "[INFO] BASE=$BASE"
echo "[INFO] LOGIN_URL=$LOGIN_URL"
echo "[INFO] LOGIN_USERNAME=$LOGIN_USERNAME"

i=0
ONLINE=0
while [ "$i" -lt 20 ]; do
  i=$((i + 1))
  health=$(curl -sS "$BASE/health" || true)
  ONLINE=$(printf "%s" "$health" | jq -r '.data.clients.online // 0' 2>/dev/null || echo 0)
  if [ "$ONLINE" -gt 0 ]; then
    break
  fi
  sleep 2
done

if [ "$ONLINE" -le 0 ]; then
  echo "[ERR] 当前没有在线 AGNX Bridge client，请先确保插件连接到 $BASE" >&2
  exit 1
fi

echo "[INFO] 在线客户端数量: $ONLINE"

open_payload=$(jq -nc --arg url "$LOGIN_URL" '{
  waitMs: 30000,
  command: {
    kind: "browser-agent",
    method: "tabs.create",
    args: [{ url: $url }]
  }
}')
open_resp=$(exec_bridge_payload_retry "$open_payload" "打开登录页" 5)
TAB_ID=$(printf "%s" "$open_resp" | jq -r '.data.exec.result.id // empty')
if [ -z "$TAB_ID" ] || [ "$TAB_ID" = "null" ]; then
  echo "[ERR] 打开页面失败，未拿到 tabId" >&2
  exit 1
fi
echo "[INFO] TAB_ID=$TAB_ID"

ready_code='return { readyState: document.readyState, hasUsername: !!document.querySelector("#username"), hasPassword: !!document.querySelector("#password"), hasSubmit: !!document.querySelector("#submit") };'
j=0
READY=false
while [ "$j" -lt 20 ]; do
  j=$((j + 1))
  ready_payload=$(jq -nc --argjson tab "$TAB_ID" --arg code "$ready_code" '{
    waitMs: 20000,
    command: {
      kind: "page-agent",
      tabId: $tab,
      timeout: 8000,
      code: $code
    }
  }')
  ready_resp=$(exec_bridge_payload_retry "$ready_payload" "检查页面就绪" 3)
  READY=$(printf "%s" "$ready_resp" | jq -r '.data.exec.result.hasUsername and .data.exec.result.hasPassword and .data.exec.result.hasSubmit')
  if [ "$READY" = "true" ]; then
    break
  fi
  sleep 1
done

if [ "$READY" != "true" ]; then
  echo "[ERR] 登录页元素未就绪（#username/#password/#submit）" >&2
  exit 1
fi

fill_code='const [u,p]=args; const ue=document.querySelector("#username"); const pe=document.querySelector("#password"); if(!ue||!pe){ throw new Error("login inputs missing"); } ue.value=String(u); ue.dispatchEvent(new Event("input",{bubbles:true})); ue.dispatchEvent(new Event("change",{bubbles:true})); pe.value=String(p); pe.dispatchEvent(new Event("input",{bubbles:true})); pe.dispatchEvent(new Event("change",{bubbles:true})); return { username: ue.value, passwordLen: pe.value.length };'
fill_payload=$(jq -nc \
  --argjson tab "$TAB_ID" \
  --arg code "$fill_code" \
  --arg login_user "$LOGIN_USERNAME" \
  --arg login_pass "$LOGIN_PASSWORD" \
  '{
  waitMs: 20000,
  command: {
    kind: "page-agent",
    tabId: $tab,
    timeout: 10000,
    args: [$login_user, $login_pass],
    code: $code
  }
}')
fill_resp=$(exec_bridge_payload_retry "$fill_payload" "填写账号密码" 5)
echo "[INFO] 已填充账号密码:"
printf "%s" "$fill_resp" | jq '.data.exec.result'

CAPTURE_PAYLOAD=$(node "$BUILD_CAPTURE_SCRIPT" \
  --tab-id "$TAB_ID" \
  --click-selector '#submit' \
  --methods 'POST' \
  --capture-timeout-ms 12000 \
  --capture-all true \
  --include-body-preview true \
  --body-preview-bytes 600 \
  --output payload \
  --pretty false)

capture_resp=$(exec_bridge_payload_retry "$CAPTURE_PAYLOAD" "执行网络采集" 5)
printf "%s" "$capture_resp" > "$OUTPUT_FILE"

status=$(printf "%s" "$capture_resp" | jq -r '.data.exec.status // "unknown"')
if [ "$status" != "succeeded" ]; then
  echo "[ERR] 抓包执行未成功，status=$status" >&2
  printf "%s" "$capture_resp" | jq '.data.exec | {status,error,completedAt}'
  exit 1
fi

echo "[INFO] 抓包完成，结果文件: $OUTPUT_FILE"
printf "%s" "$capture_resp" | jq '.data.exec.result | { meta, requestsCount:(.requests|length), responsesCount:(.responses|length), errors }'

echo "[INFO] 说明：该测试页登录是前端本地校验 + 页面跳转，不会发起 xhr/fetch 登录请求，因此 requests/responses 可能为 0。"
