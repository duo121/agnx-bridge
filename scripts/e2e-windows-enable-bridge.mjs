/**
 * Windows 可见桌面 E2E：等 CDP → 打开扩展 popup → 点「开启桥接」→ 等 health.online>=1
 * 前置：已用 launch-chrome-interactive.ps1 在 console 会话打开 Chrome
 */
import { setTimeout as sleep } from "node:timers/promises"

const CDP_PORT = Number(process.env.AGNX_BRIDGE_CDP_PORT || 9334)
const EXTENSION_ID = process.env.AGNX_BRIDGE_EXTENSION_ID || "eppdcemdgahndmmnnfhmgpcagpjiclcp"
const BRIDGE_PORT = Number(process.env.AGNX_BRIDGE_PORT || 3054)
const POPUP_URL = `chrome-extension://${EXTENSION_ID}/popup.html`

function log(step, detail = "") {
  console.log(`[e2e] ${step}${detail ? ` — ${detail}` : ""}`)
}

async function waitForCdp(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (res.ok) {
        const body = await res.json()
        return body
      }
    } catch {}
    await sleep(500)
  }
  throw new Error(`CDP not ready on :${CDP_PORT} — Chrome may not be on the interactive desktop`)
}

function cdpCall(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMessage)
      reject(new Error(`CDP timeout: ${method}`))
    }, 20000)

    function onMessage(event) {
      let msg
      try {
        msg = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (msg.id !== id) return
      clearTimeout(timer)
      ws.removeEventListener("message", onMessage)
      if (msg.error) {
        reject(new Error(`${method}: ${JSON.stringify(msg.error)}`))
        return
      }
      resolve(msg.result)
    }

    ws.addEventListener("message", onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function openPopupAndEnable(browserWsUrl) {
  const ws = new WebSocket(browserWsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve)
    ws.addEventListener("error", reject)
  })

  let nextId = 1
  const call = (method, params) => cdpCall(ws, nextId++, method, params)

  const created = await call("Target.createTarget", { url: POPUP_URL })
  const targetId = created.targetId
  log("opened popup target", targetId)

  const attached = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  })
  const sessionId = attached.sessionId

  const sessionCall = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        ws.removeEventListener("message", onMessage)
        reject(new Error(`session CDP timeout: ${method}`))
      }, 20000)

      function onMessage(event) {
        let msg
        try {
          msg = JSON.parse(String(event.data))
        } catch {
          return
        }
        if (msg.id !== id) return
        clearTimeout(timer)
        ws.removeEventListener("message", onMessage)
        if (msg.error) {
          reject(new Error(`${method}: ${JSON.stringify(msg.error)}`))
          return
        }
        resolve(msg.result)
      }

      ws.addEventListener("message", onMessage)
      ws.send(JSON.stringify({
        id,
        method,
        params,
        sessionId,
      }))
    })

  await sessionCall("Page.enable")
  await sessionCall("Runtime.enable")
  await sleep(1500)

  const clickResult = await sessionCall("Runtime.evaluate", {
    expression: `(() => {
      const btn = document.querySelector("#enableButton");
      if (!btn) return { ok: false, error: "enableButton missing", html: document.body?.innerText?.slice(0, 200) };
      btn.click();
      return { ok: true, text: btn.textContent || "" };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  })

  const value = clickResult?.result?.value
  log("clicked enable", JSON.stringify(value))
  if (!value?.ok) {
    ws.close()
    throw new Error(`Failed to click enable: ${JSON.stringify(value)}`)
  }

  await sleep(2500)
  const status = await sessionCall("Runtime.evaluate", {
    expression: `(() => {
      const pill = document.querySelector("#statusPill");
      const sub = document.querySelector("#statusSub");
      const alert = document.querySelector("#alertLine");
      return {
        pill: pill?.textContent || "",
        sub: sub?.textContent || "",
        alert: alert?.hidden ? "" : (alert?.textContent || ""),
        button: document.querySelector("#enableButton")?.textContent || "",
      };
    })()`,
    returnByValue: true,
  })
  log("popup status after click", JSON.stringify(status?.result?.value))

  ws.close()
  return status?.result?.value
}

async function waitForOnline(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let last = ""
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/api/agnx-bridge/health`)
      last = await res.text()
      const json = JSON.parse(last)
      const online = json?.data?.clients?.online ?? 0
      log("health", `online=${online}`)
      if (online >= 1) return json
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
      log("health wait", last)
    }
    await sleep(1000)
  }
  throw new Error(`clients.online never reached 1; last=${last}`)
}

const version = await waitForCdp()
log("cdp ready", version.Browser || JSON.stringify(version))
if (!version.webSocketDebuggerUrl) {
  throw new Error("Missing webSocketDebuggerUrl")
}

const popupStatus = await openPopupAndEnable(version.webSocketDebuggerUrl)
const health = await waitForOnline()
console.log("E2E_PASS")
console.log(JSON.stringify({ popupStatus, health }, null, 2))
