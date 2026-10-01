const list = await (await fetch("http://127.0.0.1:9334/json/list")).json()
const page = list.find((t) => t.url && t.url.startsWith("chrome://extensions"))
if (!page) {
  console.log("NO_EXT_PAGE")
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve)
  ws.addEventListener("error", reject)
})
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 1e9)
  const timer = setTimeout(() => reject(new Error(method)), 15000)
  const onMessage = (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id !== id) return
    clearTimeout(timer)
    ws.removeEventListener("message", onMessage)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
  }
  ws.addEventListener("message", onMessage)
  ws.send(JSON.stringify({ id, method, params }))
})
await call("Runtime.enable")
const result = await call("Runtime.evaluate", {
  returnByValue: true,
  expression: `(() => {
    const host = document.querySelector("extensions-manager");
    const items = host && host.shadowRoot && [...host.shadowRoot.querySelectorAll("extensions-item")];
    const names = (items || []).map((it) => {
      const sr = it.shadowRoot;
      const name = sr && (sr.querySelector("#name")?.textContent || "");
      const id = it.getAttribute("id") || "";
      return { id, name: (name || "").trim() };
    });
    const toolbar = host && host.shadowRoot && host.shadowRoot.querySelector("extensions-toolbar");
    const toggle = toolbar && toolbar.shadowRoot && toolbar.shadowRoot.querySelector("#devMode");
    const loadBtn = toolbar && toolbar.shadowRoot && toolbar.shadowRoot.querySelector("#loadUnpacked");
    return {
      developerMode: !!(toggle && (toggle.checked || toggle.hasAttribute("checked"))),
      hasLoadUnpacked: !!loadBtn,
      extensions: names,
      bodyText: (document.body?.innerText || "").slice(0, 200),
    };
  })()`,
})
console.log(JSON.stringify(result.result.value, null, 2))
ws.close()
