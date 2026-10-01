/**
 * Windows 实机验收：经 AGNX Bridge 打开百度，并核对标签 URL/标题。
 * 前置：本机 Google Chrome 扩展已 online（clients.online >= 1）
 */
const BASE = process.env.AGNX_BRIDGE_BASE || "http://127.0.0.1:3054/api/agnx-bridge"
const BAIDU = process.env.AGNX_BRIDGE_BAIDU_URL || "https://www.baidu.com/"

function log(step, detail = "") {
  console.log(`[baidu] ${step}${detail ? ` — ${detail}` : ""}`)
}

async function getJson(url, init) {
  const res = await fetch(url, init)
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`non-json ${res.status}: ${text.slice(0, 300)}`)
  }
  return json
}

async function execCommand(command, waitMs = 30000) {
  const posted = await getJson(`${BASE}/exec`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ waitMs, command }),
  })
  if (!posted.success) {
    throw new Error(`exec post failed: ${JSON.stringify(posted)}`)
  }

  let exec = posted.data?.exec
  const execId = exec?.execId
  if (!execId) throw new Error(`missing execId: ${JSON.stringify(posted)}`)

  const deadline = Date.now() + waitMs + 5000
  while (exec && !["succeeded", "failed", "timeout"].includes(exec.status)) {
    if (Date.now() > deadline) throw new Error(`poll timeout for ${execId}`)
    await new Promise((r) => setTimeout(r, 500))
    const polled = await getJson(`${BASE}/exec/${encodeURIComponent(execId)}`)
    if (!polled.success) throw new Error(`poll failed: ${JSON.stringify(polled)}`)
    exec = polled.data?.exec || polled.data
  }

  if (exec.status !== "succeeded") {
    throw new Error(`exec ${exec.status}: ${JSON.stringify(exec)}`)
  }
  return exec
}

const health = await getJson(`${BASE}/health`)
const online = health?.data?.clients?.online ?? 0
log("health", `online=${online}`)
if (online < 1) {
  throw new Error("bridge client not online")
}

const created = await execCommand({
  kind: "browser-agent",
  method: "tabs.create",
  args: [{ url: BAIDU, active: true }],
})
const tab = created.result
log("tabs.create", JSON.stringify(tab))

const tabId = tab?.id
if (!tabId) throw new Error("tabs.create returned no tab id")

// Wait a bit for navigation, then re-read the tab.
await new Promise((r) => setTimeout(r, 2500))
const queried = await execCommand({
  kind: "browser-agent",
  method: "tabs.get",
  args: [tabId],
})
const latest = queried.result
log("tabs.get", JSON.stringify(latest))

const url = String(latest?.url || tab?.url || "")
const title = String(latest?.title || tab?.title || "")
const urlOk = /baidu\.com/i.test(url)
const titleOk = /百度|baidu/i.test(title) || urlOk

if (!urlOk) {
  throw new Error(`URL not baidu: ${url}`)
}

console.log("BAIDU_PASS")
console.log(JSON.stringify({
  tabId,
  url,
  title,
  titleOk,
  client: health.data.clients.items?.[0]?.clientId,
}, null, 2))
