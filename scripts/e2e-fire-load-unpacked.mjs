/**
 * Trigger chrome.developerPrivate.loadUnpacked folder picker, then exit.
 * Pair with scripts/winduo-click-folder-dialog.ps1
 */
const CDP_PORT = Number(process.env.AGNX_BRIDGE_CDP_PORT || 9334)

const version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve)
  ws.addEventListener("error", reject)
})

let nextId = 1
const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++
  const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 20000)
  const onMessage = (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id !== id) return
    clearTimeout(timer)
    ws.removeEventListener("message", onMessage)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
  }
  ws.addEventListener("message", onMessage)
  const payload = { id, method, params }
  if (sessionId) payload.sessionId = sessionId
  ws.send(JSON.stringify(payload))
})

await call("Runtime.evaluate", {
  expression: `chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true})`,
}, undefined).catch(() => {})

const created = await call("Target.createTarget", { url: "chrome://extensions/" })
const attached = await call("Target.attachToTarget", { targetId: created.targetId, flatten: true })
const sessionId = attached.sessionId
await call("Page.enable", {}, sessionId)
await call("Runtime.enable", {}, sessionId)
await new Promise((r) => setTimeout(r, 1000))

// Fire-and-forget: opens Windows folder picker; do not await callback.
const fired = await call("Runtime.evaluate", {
  expression: `(() => {
    try {
      chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
      chrome.developerPrivate.loadUnpacked({});
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  })()`,
  returnByValue: true,
}, sessionId)

console.log("FIRE_LOAD_UNPACKED", JSON.stringify(fired?.result?.value))
console.log("DIALOG_SHOULD_BE_OPEN")
// keep process alive briefly so extension page stays up
await new Promise((r) => setTimeout(r, 2000))
ws.close()
