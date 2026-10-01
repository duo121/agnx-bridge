/**
 * 开发者模式已开前提：点「加载已解压的扩展程序」，再交给文件夹对话框脚本填路径。
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

const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
let page = list.find((t) => t.url && t.url.startsWith("chrome://extensions"))
let sessionId
if (page) {
  const attached = await call("Target.attachToTarget", { targetId: page.id, flatten: true })
  sessionId = attached.sessionId
} else {
  const created = await call("Target.createTarget", { url: "chrome://extensions/" })
  const attached = await call("Target.attachToTarget", { targetId: created.targetId, flatten: true })
  sessionId = attached.sessionId
}

await call("Page.enable", {}, sessionId)
await call("Runtime.enable", {}, sessionId)
await new Promise((r) => setTimeout(r, 500))

const clicked = await call("Runtime.evaluate", {
  expression: `(() => {
    const host = document.querySelector("extensions-manager");
    const toolbar = host && host.shadowRoot && host.shadowRoot.querySelector("extensions-toolbar");
    const btn = toolbar && toolbar.shadowRoot && toolbar.shadowRoot.querySelector("#loadUnpacked");
    if (!btn) return { ok: false, error: "loadUnpacked button missing" };
    btn.click();
    return { ok: true, text: btn.textContent || "" };
  })()`,
  returnByValue: true,
}, sessionId)

console.log("CLICK_LOAD_UNPACKED", JSON.stringify(clicked?.result?.value))
if (!clicked?.result?.value?.ok) {
  process.exit(1)
}
console.log("FOLDER_DIALOG_SHOULD_OPEN")
await new Promise((r) => setTimeout(r, 1500))
ws.close()
