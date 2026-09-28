import type {
  BridgeCommandHistoryEntry,
  BridgeControlMessage,
  BridgeControlResponse,
  BridgeRuntimeSnapshot,
} from "../../lib/types/bridge-control"

type PopupTab = "control" | "history"

const portInput = document.querySelector<HTMLInputElement>("#portInput")
const backendUrl = document.querySelector<HTMLElement>("#backendUrl")
const clientId = document.querySelector<HTMLElement>("#clientId")
const statusPill = document.querySelector<HTMLElement>("#statusPill")
const message = document.querySelector<HTMLElement>("#message")
const statusMeta = document.querySelector<HTMLElement>("#statusMeta")
const enableButton = document.querySelector<HTMLButtonElement>("#enableButton")
const disableButton = document.querySelector<HTMLButtonElement>("#disableButton")
const tabControlButton = document.querySelector<HTMLButtonElement>("#tabControlButton")
const tabHistoryButton = document.querySelector<HTMLButtonElement>("#tabHistoryButton")
const controlTabPanel = document.querySelector<HTMLElement>("#controlTabPanel")
const historyTabPanel = document.querySelector<HTMLElement>("#historyTabPanel")
const historyList = document.querySelector<HTMLElement>("#historyList")
const historyEmpty = document.querySelector<HTMLElement>("#historyEmpty")
const refreshHistoryButton = document.querySelector<HTMLButtonElement>("#refreshHistoryButton")
const copyAllCurlButton = document.querySelector<HTMLButtonElement>("#copyAllCurlButton")
const clearHistoryButton = document.querySelector<HTMLButtonElement>("#clearHistoryButton")

let busy = false
let refreshTimer: number | null = null
let portDraftDirty = false
let activeTab: PopupTab = "control"
let currentSnapshot: BridgeRuntimeSnapshot | null = null
let currentHistory: BridgeCommandHistoryEntry[] = []
let historyLoading = false
let lastHistoryRefreshAt = 0

const SNAPSHOT_REFRESH_MS = 1500
const HISTORY_REFRESH_MS = 3000
const HISTORY_LIMIT = 80

function requireElement<T extends HTMLElement>(element: T | null, id: string): T {
  if (!element) {
    throw new Error(`Missing popup element: ${id}`)
  }
  return element
}

const ui = {
  portInput: requireElement(portInput, "portInput"),
  backendUrl: requireElement(backendUrl, "backendUrl"),
  clientId: requireElement(clientId, "clientId"),
  statusPill: requireElement(statusPill, "statusPill"),
  message: requireElement(message, "message"),
  statusMeta: requireElement(statusMeta, "statusMeta"),
  enableButton: requireElement(enableButton, "enableButton"),
  disableButton: requireElement(disableButton, "disableButton"),
  tabControlButton: requireElement(tabControlButton, "tabControlButton"),
  tabHistoryButton: requireElement(tabHistoryButton, "tabHistoryButton"),
  controlTabPanel: requireElement(controlTabPanel, "controlTabPanel"),
  historyTabPanel: requireElement(historyTabPanel, "historyTabPanel"),
  historyList: requireElement(historyList, "historyList"),
  historyEmpty: requireElement(historyEmpty, "historyEmpty"),
  refreshHistoryButton: requireElement(refreshHistoryButton, "refreshHistoryButton"),
  copyAllCurlButton: requireElement(copyAllCurlButton, "copyAllCurlButton"),
  clearHistoryButton: requireElement(clearHistoryButton, "clearHistoryButton"),
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return "--:--:--"
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour12: false,
  })
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    hour12: false,
  })
}

function normalizePortInput(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    return null
  }
  return parsed
}

async function sendMessageToBackground(messagePayload: BridgeControlMessage): Promise<BridgeControlResponse> {
  return chrome.runtime.sendMessage(messagePayload) as Promise<BridgeControlResponse>
}

function setBusy(nextBusy: boolean): void {
  busy = nextBusy
  ui.enableButton.disabled = nextBusy
  ui.disableButton.disabled = nextBusy
  ui.portInput.disabled = nextBusy
}

function setHistoryButtonsBusy(nextBusy: boolean): void {
  historyLoading = nextBusy
  ui.refreshHistoryButton.disabled = nextBusy
  ui.clearHistoryButton.disabled = nextBusy
  ui.copyAllCurlButton.disabled = nextBusy
}

function setMessage(text: string, tone: "default" | "success" | "error" = "default"): void {
  ui.message.textContent = text
  if (tone === "default") {
    ui.message.removeAttribute("data-tone")
    return
  }
  ui.message.dataset.tone = tone
}

function syncPortInputValue(snapshotPort: number): void {
  const normalizedInput = normalizePortInput(ui.portInput.value)
  const matchesSnapshot = normalizedInput === snapshotPort && ui.portInput.value.trim().length > 0

  if (!portDraftDirty || matchesSnapshot) {
    ui.portInput.value = String(snapshotPort)
    portDraftDirty = false
  }
}

function renderSnapshot(snapshot: BridgeRuntimeSnapshot): void {
  currentSnapshot = snapshot
  syncPortInputValue(snapshot.config.port)
  ui.backendUrl.textContent = snapshot.status.backendUrl
  ui.clientId.textContent = snapshot.status.clientId || "未注册"

  if (!snapshot.config.enabled) {
    ui.statusPill.textContent = "已关闭"
    ui.statusPill.dataset.tone = "paused"
    setMessage("桥接服务已关闭。修改端口后点击开启即可自动拉起对应端口的本地服务。")
  } else if (snapshot.status.lastError) {
    ui.statusPill.textContent = "重试中"
    ui.statusPill.dataset.tone = "error"
    setMessage(`桥接连接失败：${snapshot.status.lastError}`, "error")
  } else if (snapshot.status.clientId) {
    ui.statusPill.textContent = "已连接"
    ui.statusPill.dataset.tone = "active"
    setMessage("桥接服务已开启，本地宿主已拉起对应端口的 bridge server。", "success")
  } else if (snapshot.status.running) {
    ui.statusPill.textContent = "启动中"
    ui.statusPill.dataset.tone = "paused"
    setMessage("桥接服务已开启，正在等待本地 bridge server 完成注册。")
  } else {
    ui.statusPill.textContent = "待命中"
    ui.statusPill.dataset.tone = "paused"
    setMessage("当前配置已保存，但桥接轮询还未进入运行态。")
  }

  const leaseText = snapshot.status.leaseExpiresAt
    ? `租约到期 ${formatTime(snapshot.status.leaseExpiresAt)}`
    : "尚未建立租约"

  ui.statusMeta.textContent = [
    `状态刷新 ${formatTime(snapshot.status.updatedAt)}`,
    `失败次数 ${snapshot.status.failureCount}`,
    leaseText,
  ].join("  ·  ")
}

async function copyText(content: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(content)
    return true
  } catch {
    try {
      const temp = document.createElement("textarea")
      temp.value = content
      temp.setAttribute("readonly", "true")
      temp.style.position = "absolute"
      temp.style.left = "-9999px"
      document.body.appendChild(temp)
      temp.select()
      document.execCommand("copy")
      temp.remove()
      return true
    } catch {
      return false
    }
  }
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function buildCurlForCommand(
  backendBaseUrl: string,
  command: Record<string, unknown>,
): string {
  const body = JSON.stringify(command)
  return [
    `curl -sS -X POST ${shellSingleQuote(`${backendBaseUrl}/api/agnx-bridge/exec`)}`,
    `  -H ${shellSingleQuote("Content-Type: application/json")}`,
    `  -d ${shellSingleQuote(body)}`,
  ].join(" \\\n")
}

function getHistoryTitle(entry: BridgeCommandHistoryEntry): string {
  const kind = typeof entry.command.kind === "string" ? entry.command.kind : "unknown"
  if (kind === "browser-agent" && typeof entry.command.method === "string") {
    return `${kind} · ${entry.command.method}`
  }
  if (kind === "console-capture" && typeof entry.command.action === "string") {
    return `${kind} · ${entry.command.action}`
  }
  return kind
}

function renderHistory(historyEntries: BridgeCommandHistoryEntry[]): void {
  currentHistory = historyEntries
  ui.historyList.replaceChildren()
  ui.historyList.dataset.empty = historyEntries.length === 0 ? "true" : "false"
  ui.historyEmpty.style.display = historyEntries.length === 0 ? "block" : "none"
  ui.copyAllCurlButton.disabled = historyLoading || historyEntries.length === 0
  ui.clearHistoryButton.disabled = historyLoading || historyEntries.length === 0

  for (const entry of historyEntries) {
    const item = document.createElement("article")
    item.className = "history-item"

    const head = document.createElement("div")
    head.className = "history-item-head"

    const title = document.createElement("strong")
    title.className = "history-item-title"
    title.textContent = getHistoryTitle(entry)

    const status = document.createElement("span")
    status.className = "history-item-status"
    status.dataset.tone = entry.success ? "success" : "error"
    status.textContent = entry.success ? "SUCCESS" : "FAILED"

    const meta = document.createElement("div")
    meta.className = "history-item-meta"
    meta.textContent = [
      `时间 ${formatDateTime(entry.completedAt)}`,
      `exec ${entry.execId}`,
      `client ${entry.clientId}`,
      entry.error ? `错误 ${entry.error}` : null,
    ].filter(Boolean).join("  ·  ")

    const actions = document.createElement("div")
    actions.className = "history-item-actions"

    const copyJsonButton = document.createElement("button")
    copyJsonButton.className = "action action-ghost"
    copyJsonButton.textContent = "复制 JSON"
    copyJsonButton.addEventListener("click", () => {
      void (async () => {
        const ok = await copyText(JSON.stringify(entry.command, null, 2))
        setMessage(ok ? "已复制 JSON 到剪贴板。" : "复制 JSON 失败，请检查剪贴板权限。", ok ? "success" : "error")
      })()
    })

    const copyCurlButton = document.createElement("button")
    copyCurlButton.className = "action action-ghost"
    copyCurlButton.textContent = "复制 curl"
    copyCurlButton.addEventListener("click", () => {
      void (async () => {
        const commandCurl = buildCurlForCommand(entry.backendUrl, entry.command)
        const ok = await copyText(commandCurl)
        setMessage(ok ? "已复制 curl 到剪贴板。" : "复制 curl 失败，请检查剪贴板权限。", ok ? "success" : "error")
      })()
    })

    head.append(title, status)
    actions.append(copyJsonButton, copyCurlButton)
    item.append(head, meta, actions)
    ui.historyList.append(item)
  }
}

function setActiveTab(tab: PopupTab): void {
  activeTab = tab
  const isControlTab = tab === "control"

  ui.tabControlButton.dataset.active = isControlTab ? "true" : "false"
  ui.tabHistoryButton.dataset.active = isControlTab ? "false" : "true"
  ui.controlTabPanel.classList.toggle("tab-panel-hidden", !isControlTab)
  ui.historyTabPanel.classList.toggle("tab-panel-hidden", isControlTab)
}

async function refreshSnapshot(showError = false): Promise<void> {
  try {
    const response = await sendMessageToBackground({ type: "BRIDGE_CONTROL_GET_STATE" })
    if (response.snapshot) {
      renderSnapshot(response.snapshot)
    }
    if (!response.success || !response.snapshot) {
      throw new Error(response.error || "读取桥接状态失败")
    }
  } catch (error) {
    if (showError) {
      setMessage(error instanceof Error ? error.message : String(error), "error")
    }
  }
}

async function refreshHistory(showError = false): Promise<void> {
  if (historyLoading) return

  setHistoryButtonsBusy(true)
  try {
    const response = await sendMessageToBackground({
      type: "BRIDGE_CONTROL_GET_HISTORY",
      limit: HISTORY_LIMIT,
    })
    if (!response.success) {
      throw new Error(response.error || "读取历史记录失败")
    }
    renderHistory(response.history ?? [])
    lastHistoryRefreshAt = Date.now()
  } catch (error) {
    if (showError) {
      setMessage(error instanceof Error ? error.message : String(error), "error")
    }
  } finally {
    setHistoryButtonsBusy(false)
  }
}

async function clearHistory(): Promise<void> {
  setHistoryButtonsBusy(true)
  try {
    const response = await sendMessageToBackground({
      type: "BRIDGE_CONTROL_CLEAR_HISTORY",
    })
    if (!response.success) {
      throw new Error(response.error || "清空历史记录失败")
    }
    renderHistory(response.history ?? [])
    setMessage("历史记录已清空。", "success")
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error")
  } finally {
    setHistoryButtonsBusy(false)
  }
}

async function copyAllCurls(): Promise<void> {
  if (currentHistory.length === 0) {
    setMessage("当前没有可复制的历史命令。", "error")
    return
  }

  const script = currentHistory
    .slice()
    .reverse()
    .map((entry) => buildCurlForCommand(entry.backendUrl, entry.command))
    .join("\n\n")
  const ok = await copyText(script)
  setMessage(ok ? `已复制 ${currentHistory.length} 条 curl。` : "复制失败，请检查剪贴板权限。", ok ? "success" : "error")
}

async function applyConfig(enabled: boolean): Promise<void> {
  const port = normalizePortInput(ui.portInput.value)
  if (port === null) {
    setMessage("请输入 1 到 65535 之间的有效端口。", "error")
    ui.portInput.focus()
    return
  }

  setBusy(true)
  try {
    const response = await sendMessageToBackground({
      type: "BRIDGE_CONTROL_SET_CONFIG",
      config: {
        enabled,
        port,
      },
    })

    if (response.snapshot) {
      renderSnapshot(response.snapshot)
    }
    if (!response.success || !response.snapshot) {
      throw new Error(response.error || "更新桥接配置失败")
    }

    portDraftDirty = false
    setMessage(
      enabled
        ? `桥接服务已开启，本地宿主正在拉起端口 ${port} 的 bridge server。`
        : `桥接服务已关闭，端口已保留为 ${port}。`,
      "success",
    )
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), "error")
  } finally {
    setBusy(false)
  }
}

ui.enableButton.addEventListener("click", () => {
  void applyConfig(true)
})

ui.disableButton.addEventListener("click", () => {
  void applyConfig(false)
})

ui.portInput.addEventListener("input", () => {
  portDraftDirty = true
})

ui.portInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !busy) {
    event.preventDefault()
    void applyConfig(true)
  }
})

ui.tabControlButton.addEventListener("click", () => {
  setActiveTab("control")
})

ui.tabHistoryButton.addEventListener("click", () => {
  setActiveTab("history")
  void refreshHistory(true)
})

ui.refreshHistoryButton.addEventListener("click", () => {
  void refreshHistory(true)
})

ui.clearHistoryButton.addEventListener("click", () => {
  void clearHistory()
})

ui.copyAllCurlButton.addEventListener("click", () => {
  void copyAllCurls()
})

refreshTimer = window.setInterval(() => {
  if (!busy) {
    void refreshSnapshot(false)
  }

  if (
    activeTab === "history"
    && !historyLoading
    && Date.now() - lastHistoryRefreshAt > HISTORY_REFRESH_MS
  ) {
    void refreshHistory(false)
  }
}, SNAPSHOT_REFRESH_MS)

window.addEventListener("unload", () => {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }
})

setActiveTab("control")
void refreshSnapshot(true)
void refreshHistory(false)
