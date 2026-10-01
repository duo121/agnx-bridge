/**
 * 仅用本机 Google Chrome：CDP Extensions.loadUnpacked 加载扩展，再点开启桥接。
 * 需要 Chrome 以 --enable-unsafe-extension-debugging + remote-debugging 启动。
 */
const CDP_PORT = Number(process.env.AGNX_BRIDGE_CDP_PORT || 9334)
const EXT_PATH = process.env.AGNX_BRIDGE_EXT_PATH
  || "C:\\Users\\jianduo\\Documents\\github\\agnx-bridge\\.winduo-e2e\\chrome-mv3"
const EXTENSION_ID = process.env.AGNX_BRIDGE_EXTENSION_ID || "eppdcemdgahndmmnnfhmgpcagpjiclcp"
const BRIDGE_PORT = Number(process.env.AGNX_BRIDGE_PORT || 3054)

function log(step, detail = "") {
  console.log(`[e2e] ${step}${detail ? ` — ${detail}` : ""}`)
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

async function waitCdp(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (res.ok) return res.json()
    } catch {}
    await sleep(400)
  }
  throw new Error("CDP not ready")
}

function attach(url) {
  const ws = new WebSocket(url)
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(ws))
    ws.addEventListener("error", reject)
  })
}

function makeCaller(ws) {
  let nextId = 1
  return function call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 30000)
      const onMessage = (event) => {
        const msg = JSON.parse(String(event.data))
        if (msg.id !== id) return
        clearTimeout(timer)
        ws.removeEventListener("message", onMessage)
        if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`))
        else resolve(msg.result)
      }
      ws.addEventListener("message", onMessage)
      const payload = { id, method, params }
      if (sessionId) payload.sessionId = sessionId
      ws.send(JSON.stringify(payload))
    })
  }
}

async function loadExtension(ws) {
  const call = makeCaller(ws)
  // Prefer CDP Extensions domain (Chrome with --enable-unsafe-extension-debugging).
  try {
    const result = await call("Extensions.loadUnpacked", { path: EXT_PATH })
    log("Extensions.loadUnpacked", JSON.stringify(result))
    return result
  } catch (error) {
    log("Extensions.loadUnpacked failed", error instanceof Error ? error.message : String(error))
  }

  // Fallback: developerPrivate on chrome://extensions (may open dialog — last resort).
  const created = await call("Target.createTarget", { url: "chrome://extensions/" })
  const attached = await call("Target.attachToTarget", { targetId: created.targetId, flatten: true })
  const sessionId = attached.sessionId
  await call("Runtime.enable", {}, sessionId)
  await call("Runtime.evaluate", {
    expression: `chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true})`,
  }, sessionId)
  throw new Error("CDP Extensions.loadUnpacked unavailable; cannot continue without folder dialog")
}

async function clickEnable(ws) {
  const call = makeCaller(ws)
  const created = await call("Target.createTarget", {
    url: `chrome-extension://${EXTENSION_ID}/popup.html`,
  })
  const attached = await call("Target.attachToTarget", {
    targetId: created.targetId,
    flatten: true,
  })
  const sessionId = attached.sessionId
  await call("Page.enable", {}, sessionId)
  await call("Runtime.enable", {}, sessionId)
  await sleep(1500)

  for (let i = 0; i < 10; i++) {
    const click = await call("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        const btn = document.querySelector("#enableButton");
        if (!btn) {
          return {
            ok: false,
            html: (document.body && document.body.innerText || "").slice(0, 300),
          };
        }
        btn.click();
        return { ok: true, text: btn.textContent || "" };
      })()`,
    }, sessionId)
    log("clickEnable try", JSON.stringify(click?.result?.value))
    if (click?.result?.value?.ok) {
      await sleep(2500)
      const status = await call("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => ({
          pill: document.querySelector("#statusPill")?.textContent || "",
          sub: document.querySelector("#statusSub")?.textContent || "",
          alert: document.querySelector("#alertLine")?.hidden ? "" : (document.querySelector("#alertLine")?.textContent || ""),
        }))()`,
      }, sessionId)
      return status?.result?.value
    }
    await sleep(1000)
  }
  throw new Error("enableButton never appeared — extension likely not loaded")
}

async function waitOnline(timeoutMs = 45000) {
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
  throw new Error(`clients.online never >= 1; last=${last}`)
}

const version = await waitCdp()
log("cdp", version.Browser)
const ws = await attach(version.webSocketDebuggerUrl)
const loaded = await loadExtension(ws)
await sleep(2000)
const popupStatus = await clickEnable(ws)
const health = await waitOnline()
ws.close()
console.log("E2E_PASS")
console.log(JSON.stringify({ loaded, popupStatus, health }, null, 2))
