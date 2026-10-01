/**
 * Inspect whether AGNX Bridge extension actually loaded in the CDP Chrome profile.
 */
const CDP_PORT = Number(process.env.AGNX_BRIDGE_CDP_PORT || 9334)

async function cdpEvalOnUrl(pageWsUrl, expression) {
  const ws = new WebSocket(pageWsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve)
    ws.addEventListener("error", reject)
  })
  let id = 1
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const thisId = id++
    const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 15000)
    const onMessage = (event) => {
      const msg = JSON.parse(String(event.data))
      if (msg.id !== thisId) return
      clearTimeout(timer)
      ws.removeEventListener("message", onMessage)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
    ws.addEventListener("message", onMessage)
    ws.send(JSON.stringify({ id: thisId, method, params }))
  })
  await call("Runtime.enable")
  const result = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  ws.close()
  return result?.result?.value
}

const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
console.log("TARGETS", JSON.stringify(list.map((t) => ({
  type: t.type,
  title: t.title,
  url: t.url,
})), null, 2))

const extensionsPage = list.find((t) => t.url?.startsWith("chrome://extensions"))
  || list.find((t) => t.type === "page" && t.url?.includes("extensions"))

if (!extensionsPage) {
  // open it
  const version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()
  const ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve)
    ws.addEventListener("error", reject)
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("createTarget timeout")), 10000)
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data))
      if (msg.id === 1) {
        clearTimeout(timer)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    })
    ws.send(JSON.stringify({
      id: 1,
      method: "Target.createTarget",
      params: { url: "chrome://extensions/" },
    }))
  })
  ws.close()
  await new Promise((r) => setTimeout(r, 1500))
}

const list2 = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
const page = list2.find((t) => t.url?.startsWith("chrome://extensions"))
if (!page) {
  console.log("NO_EXTENSIONS_PAGE", list2.map((t) => t.url))
  process.exit(1)
}

const info = await cdpEvalOnUrl(page.webSocketDebuggerUrl, `(() => {
  const text = document.body?.innerText || "";
  return {
    text: text.slice(0, 2500),
    hasAgnx: /AGNX|agnx|Bridge/i.test(text),
    hasDeveloper: /开发者模式|Developer mode/i.test(text),
  };
})()`)
console.log("EXTENSIONS_PAGE", JSON.stringify(info, null, 2))
