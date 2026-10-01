/**
 * 在已打开的 CDP Chrome 上：打开 chrome://extensions，强制打开开发者模式，并读回开关状态。
 */
const CDP_PORT = Number(process.env.AGNX_BRIDGE_CDP_PORT || 9334)

function log(step, detail = "") {
  console.log(`[devmode] ${step}${detail ? ` — ${detail}` : ""}`)
}

async function attach(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve)
    ws.addEventListener("error", reject)
  })
  let nextId = 1
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 20000)
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
  return { ws, call }
}

const version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
log("cdp", version.Browser)
const { ws, call } = await attach(version.webSocketDebuggerUrl)

const created = await call("Target.createTarget", { url: "chrome://extensions/" })
const attached = await call("Target.attachToTarget", {
  targetId: created.targetId,
  flatten: true,
})
const sessionId = attached.sessionId
await call("Page.enable", {}, sessionId)
await call("Runtime.enable", {}, sessionId)
await new Promise((r) => setTimeout(r, 1200))

const setMode = await call("Runtime.evaluate", {
  expression: `(() => new Promise((resolve) => {
    try {
      chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, () => {
        const err = chrome.runtime.lastError;
        chrome.developerPrivate.getProfileConfiguration((cfg) => {
          const err2 = chrome.runtime.lastError;
          resolve({
            setOk: !err,
            setError: err ? err.message : null,
            getOk: !err2,
            getError: err2 ? err2.message : null,
            inDeveloperMode: !!(cfg && cfg.inDeveloperMode),
            cfg,
          });
        });
      });
    } catch (e) {
      resolve({ setOk: false, setError: String(e) });
    }
  }))()`,
  awaitPromise: true,
  returnByValue: true,
}, sessionId)

log("api", JSON.stringify(setMode?.result?.value))

// Also try flipping the visible toggle in the extensions manager UI (shadow DOM).
const uiFlip = await call("Runtime.evaluate", {
  expression: `(() => {
    const host = document.querySelector("extensions-manager");
    if (!host || !host.shadowRoot) {
      return { ok: false, error: "extensions-manager missing" };
    }
    const toolbar = host.shadowRoot.querySelector("extensions-toolbar");
    if (!toolbar || !toolbar.shadowRoot) {
      return { ok: false, error: "extensions-toolbar missing" };
    }
    const toggle = toolbar.shadowRoot.querySelector("#devMode");
    if (!toggle) {
      return {
        ok: false,
        error: "devMode toggle missing",
        toolbarHtml: toolbar.shadowRoot.innerHTML.slice(0, 500),
      };
    }
    const before = !!(toggle.checked || toggle.hasAttribute("checked"));
    if (!before) {
      toggle.click();
    }
    const after = !!(toggle.checked || toggle.hasAttribute("checked"));
    return { ok: true, before, after, tag: toggle.tagName };
  })()`,
  returnByValue: true,
}, sessionId)

log("uiToggle", JSON.stringify(uiFlip?.result?.value))

await new Promise((r) => setTimeout(r, 800))

const verify = await call("Runtime.evaluate", {
  expression: `(() => new Promise((resolve) => {
    chrome.developerPrivate.getProfileConfiguration((cfg) => {
      const host = document.querySelector("extensions-manager");
      const toolbar = host && host.shadowRoot && host.shadowRoot.querySelector("extensions-toolbar");
      const toggle = toolbar && toolbar.shadowRoot && toolbar.shadowRoot.querySelector("#devMode");
      resolve({
        apiDeveloperMode: !!(cfg && cfg.inDeveloperMode),
        uiChecked: toggle ? !!(toggle.checked || toggle.hasAttribute("checked")) : null,
        hasLoadUnpackedButton: !!(toolbar && toolbar.shadowRoot && toolbar.shadowRoot.querySelector("#loadUnpacked")),
      });
    });
  }))()`,
  awaitPromise: true,
  returnByValue: true,
}, sessionId)

const value = verify?.result?.value
log("verify", JSON.stringify(value))
ws.close()

if (!value?.apiDeveloperMode && !value?.uiChecked) {
  console.log("DEVMODE_FAIL")
  process.exit(1)
}
console.log("DEVMODE_ON")
if (value?.hasLoadUnpackedButton) {
  console.log("LOAD_UNPACKED_BUTTON_VISIBLE")
}
