/**
 * Google Chrome 品牌包禁止 --load-extension。改走 chrome://extensions 的 developerPrivate.loadUnpacked。
 */
const CDP_PORT = Number(process.env.AGNX_BRIDGE_CDP_PORT || 9334)
const EXT_PATH = process.env.AGNX_BRIDGE_EXT_PATH
  || "C:\\Users\\jianduo\\Documents\\github\\agnx-bridge\\.winduo-e2e\\chrome-mv3"
const EXTENSION_ID = process.env.AGNX_BRIDGE_EXTENSION_ID || "eppdcemdgahndmmnnfhmgpcagpjiclcp"
const BRIDGE_PORT = Number(process.env.AGNX_BRIDGE_PORT || 3054)

function log(step, detail = "") {
  console.log(`[e2e] ${step}${detail ? ` — ${detail}` : ""}`)
}

async function wait(ms) {
  await new Promise((r) => setTimeout(r, ms))
}

async function getVersion() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
  if (!res.ok) throw new Error(`CDP version HTTP ${res.status}`)
  return res.json()
}

function attachWs(url) {
  const ws = new WebSocket(url)
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(ws))
    ws.addEventListener("error", reject)
  })
}

function makeCaller(ws, getSessionId = () => undefined) {
  let nextId = 1
  return function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        ws.removeEventListener("message", onMessage)
        reject(new Error(`CDP timeout ${method}`))
      }, 30000)
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
        if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`))
        else resolve(msg.result)
      }
      ws.addEventListener("message", onMessage)
      const payload = { id, method, params }
      const sessionId = getSessionId()
      if (sessionId) payload.sessionId = sessionId
      ws.send(JSON.stringify(payload))
    })
  }
}

async function openExtensionsPage(browserWs) {
  const call = makeCaller(browserWs)
  const created = await call("Target.createTarget", { url: "chrome://extensions/" })
  const attached = await call("Target.attachToTarget", {
    targetId: created.targetId,
    flatten: true,
  })
  return { targetId: created.targetId, sessionId: attached.sessionId, call }
}

async function loadUnpacked(browserWs) {
  const { sessionId } = await openExtensionsPage(browserWs)
  const call = makeCaller(browserWs, () => sessionId)
  await call("Page.enable")
  await call("Runtime.enable")
  await wait(1500)

  const enableDev = await call("Runtime.evaluate", {
    expression: `(() => new Promise((resolve) => {
      try {
        chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, () => {
          const err = chrome.runtime.lastError;
          resolve({ ok: !err, error: err ? err.message : null });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    }))()`,
    awaitPromise: true,
    returnByValue: true,
  })
  log("developerMode", JSON.stringify(enableDev?.result?.value))

  const load = await call("Runtime.evaluate", {
    expression: `(() => new Promise((resolve) => {
      try {
        chrome.developerPrivate.loadUnpacked(${JSON.stringify(EXT_PATH)}, (result) => {
          const err = chrome.runtime.lastError;
          resolve({
            ok: !err,
            error: err ? err.message : null,
            result: result || null,
          });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    }))()`,
    awaitPromise: true,
    returnByValue: true,
  })
  log("loadUnpacked", JSON.stringify(load?.result?.value))
  if (!load?.result?.value?.ok) {
    throw new Error(`loadUnpacked failed: ${JSON.stringify(load?.result?.value)}`)
  }
  return load.result.value
}

async function clickEnable(browserWs) {
  const call = makeCaller(browserWs)
  const popupUrl = `chrome-extension://${EXTENSION_ID}/popup.html`
  const created = await call("Target.createTarget", { url: popupUrl })
  const attached = await call("Target.attachToTarget", {
    targetId: created.targetId,
    flatten: true,
  })
  const sessionCall = makeCaller(browserWs, () => attached.sessionId)
  await sessionCall("Page.enable")
  await sessionCall("Runtime.enable")
  await wait(1500)

  const click = await sessionCall("Runtime.evaluate", {
    expression: `(() => {
      const btn = document.querySelector("#enableButton");
      if (!btn) {
        return {
          ok: false,
          error: "enableButton missing",
          html: (document.body && document.body.innerText || "").slice(0, 300),
        };
      }
      btn.click();
      return { ok: true, text: btn.textContent || "" };
    })()`,
    returnByValue: true,
  })
  log("clickEnable", JSON.stringify(click?.result?.value))
  if (!click?.result?.value?.ok) {
    throw new Error(`clickEnable failed: ${JSON.stringify(click?.result?.value)}`)
  }

  await wait(2500)
  const status = await sessionCall("Runtime.evaluate", {
    expression: `(() => ({
      pill: document.querySelector("#statusPill")?.textContent || "",
      sub: document.querySelector("#statusSub")?.textContent || "",
      alert: document.querySelector("#alertLine")?.hidden ? "" : (document.querySelector("#alertLine")?.textContent || ""),
    }))()`,
    returnByValue: true,
  })
  log("popupStatus", JSON.stringify(status?.result?.value))
  return status?.result?.value
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
    await wait(1000)
  }
  throw new Error(`clients.online never >= 1; last=${last}`)
}

const version = await getVersion()
log("cdp", version.Browser)
const browserWs = await attachWs(version.webSocketDebuggerUrl)
await loadUnpacked(browserWs)
const popupStatus = await clickEnable(browserWs)
const health = await waitOnline()
browserWs.close()
console.log("E2E_PASS")
console.log(JSON.stringify({ popupStatus, health }, null, 2))
