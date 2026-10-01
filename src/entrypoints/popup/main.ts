import type {
  BridgeCommandHistoryEntry,
  BridgeControlMessage,
  BridgeControlResponse,
  BridgeRuntimeSnapshot,
} from "../../lib/types/bridge-control"

type PopupTab = "control" | "history"

const portInput = document.querySelector<HTMLInputElement>("#portInput")
const backendUrl = document.querySelector<HTMLElement>("#backendUrl")
const clientSummary = document.querySelector<HTMLElement>("#clientSummary")
const clientId = document.querySelector<HTMLElement>("#clientId")
const clientIdToggle = document.querySelector<HTMLButtonElement>("#clientIdToggle")
const copyUrlButton = document.querySelector<HTMLButtonElement>("#copyUrlButton")
const statusPill = document.querySelector<HTMLElement>("#statusPill")
const statusSub = document.querySelector<HTMLElement>("#statusSub")
const statusCluster = document.querySelector<HTMLElement>("#statusCluster")
const alertLine = document.querySelector<HTMLElement>("#alertLine")
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
let clientIdExpanded = false
let activeTab: PopupTab = "control"
let currentSnapshot: BridgeRuntimeSnapshot | null = null
let currentHistory: BridgeCommandHistoryEntry[] = []
let historyLoading = false
let lastHistoryRefreshAt = 0
let alertClearTimer: number | null = null

const SNAPSHOT_REFRESH_MS = 1500
const HISTORY_REFRESH_MS = 3000
const HISTORY_LIMIT = 80
const FLASH_ALERT_MS = 2200

function requireElement<T extends HTMLElement>(element: T | null, id: string): T {
  if (!element) {
    throw new Error(`Missing popup element: ${id}`)
  }
  return element
}

const ui = {
  portInput: requireElement(portInput, "portInput"),
  backendUrl: requireElement(backendUrl, "backendUrl"),
  clientSummary: requireElement(clientSummary, "clientSummary"),
  clientId: requireElement(clientId, "clientId"),
  clientIdToggle: requireElement(clientIdToggle, "clientIdToggle"),
  copyUrlButton: requireElement(copyUrlButton, "copyUrlButton"),
  statusPill: requireElement(statusPill, "statusPill"),
  statusSub: requireElement(statusSub, "statusSub"),
  statusCluster: requireElement(statusCluster, "statusCluster"),
  alertLine: requireElement(alertLine, "alertLine"),
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

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    hour12: false,
  })
}

function formatHeartbeatAge(updatedAt?: number): string {
  if (!updatedAt) return "尚无心跳"
  const ageSec = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000))
  if (ageSec < 5) return "刚刚"
  if (ageSec < 60) return `${ageSec} 秒前`
  const ageMin = Math.floor(ageSec / 60)
  if (ageMin < 60) return `${ageMin} 分钟前`
  return formatDateTime(updatedAt)
}

function syncActionButtons(snapshot: BridgeRuntimeSnapshot): void {
  const enabled = snapshot.config.enabled
  const connected = Boolean(enabled && snapshot.status.clientId && !snapshot.status.lastError)
  const retrying = Boolean(enabled && snapshot.status.lastError)

  ui.enableButton.classList.remove("action-primary", "action-secondary")
  ui.disableButton.classList.remove("action-primary", "action-secondary", "action-danger")

  if (!enabled) {
    ui.enableButton.textContent = "开启桥接"
    ui.enableButton.classList.add("action-primary")
    ui.disableButton.textContent = "关闭桥接"
    ui.disableButton.classList.add("action-secondary")
    ui.disableButton.disabled = true
    return
  }

  ui.enableButton.textContent = retrying ? "重试连接" : "重新连接"
  ui.enableButton.classList.add("action-secondary")
  ui.disableButton.textContent = "关闭桥接"
  ui.disableButton.classList.add(connected || retrying ? "action-danger" : "action-primary")
  ui.disableButton.disabled = busy
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
  ui.copyUrlButton.disabled = nextBusy
  if (currentSnapshot) {
    syncActionButtons(currentSnapshot)
  }
}

function setHistoryButtonsBusy(nextBusy: boolean): void {
  historyLoading = nextBusy
  ui.refreshHistoryButton.disabled = nextBusy
  ui.clearHistoryButton.disabled = nextBusy
  ui.copyAllCurlButton.disabled = nextBusy
}

function clearAlertTimer(): void {
  if (alertClearTimer !== null) {
    window.clearTimeout(alertClearTimer)
    alertClearTimer = null
  }
}

function setAlert(
  text: string,
  tone: "default" | "success" | "error" = "default",
  options?: { sticky?: boolean },
): void {
  clearAlertTimer()
  const trimmed = text.trim()
  if (!trimmed) {
    ui.alertLine.hidden = true
    ui.alertLine.textContent = ""
    ui.alertLine.removeAttribute("data-tone")
    return
  }

  ui.alertLine.hidden = false
  ui.alertLine.textContent = trimmed
  if (tone === "default") {
    ui.alertLine.removeAttribute("data-tone")
  } else {
    ui.alertLine.dataset.tone = tone
  }

  if (!options?.sticky && tone !== "error") {
    alertClearTimer = window.setTimeout(() => {
      if (ui.alertLine.dataset.tone === "error") return
      setAlert("")
    }, FLASH_ALERT_MS)
  }
}

function setMessage(text: string, tone: "default" | "success" | "error" = "default"): void {
  setAlert(text, tone, { sticky: tone === "error" })
}

function syncPortInputValue(snapshotPort: number): void {
  const normalizedInput = normalizePortInput(ui.portInput.value)
  const matchesSnapshot = normalizedInput === snapshotPort && ui.portInput.value.trim().length > 0

  if (!portDraftDirty || matchesSnapshot) {
    ui.portInput.value = String(snapshotPort)
    portDraftDirty = false
  }
}

function renderClientRegistration(clientIdValue?: string): void {
  if (!clientIdValue) {
    clientIdExpanded = false
    ui.clientSummary.textContent = "未注册"
    ui.clientId.textContent = ""
    ui.clientId.hidden = true
    ui.clientIdToggle.hidden = true
    return
  }

  ui.clientSummary.textContent = "本机已注册"
  ui.clientId.textContent = clientIdValue
  ui.clientIdToggle.hidden = false
  ui.clientId.hidden = !clientIdExpanded
  ui.clientIdToggle.textContent = clientIdExpanded ? "收起 Client ID" : "查看 Client ID"
}

function buildStatusSub(snapshot: BridgeRuntimeSnapshot, fallback: string): string {
  if (!snapshot.config.enabled) return fallback

  const parts = [`心跳 ${formatHeartbeatAge(snapshot.status.updatedAt)}`]
  if (snapshot.status.failureCount > 0) {
    parts.push(`失败 ${snapshot.status.failureCount}`)
  }
  if (snapshot.status.clientId && snapshot.status.leaseExpiresAt) {
    const leaseLeftSec = Math.max(
      0,
      Math.floor((snapshot.status.leaseExpiresAt - Date.now()) / 1000),
    )
    if (leaseLeftSec <= 30) {
      parts.push(`租约 ${leaseLeftSec}s`)
    }
  }
  return parts.join(" · ")
}

function renderSnapshot(snapshot: BridgeRuntimeSnapshot): void {
  currentSnapshot = snapshot
  syncPortInputValue(snapshot.config.port)
  ui.backendUrl.textContent = snapshot.status.backendUrl
  renderClientRegistration(snapshot.status.clientId)
  syncActionButtons(snapshot)

  const portLabel = String(snapshot.config.port)

  if (!snapshot.config.enabled) {
    ui.statusPill.textContent = "已关闭"
    ui.statusPill.dataset.tone = "paused"
    ui.statusSub.textContent = "改端口后点开启"
    if (ui.alertLine.dataset.tone === "error") setAlert("")
  } else if (snapshot.status.lastError) {
    ui.statusPill.textContent = `重试中 · ${portLabel}`
    ui.statusPill.dataset.tone = "error"
    ui.statusSub.textContent = buildStatusSub(snapshot, "连接异常")
    setAlert(`连接失败：${snapshot.status.lastError}`, "error", { sticky: true })
  } else if (snapshot.status.clientId) {
    ui.statusPill.textContent = `已连接 · ${portLabel}`
    ui.statusPill.dataset.tone = "active"
    ui.statusSub.textContent = buildStatusSub(snapshot, "连接正常")
    if (ui.alertLine.dataset.tone === "error") setAlert("")
  } else if (snapshot.status.running) {
    ui.statusPill.textContent = `启动中 · ${portLabel}`
    ui.statusPill.dataset.tone = "paused"
    ui.statusSub.textContent = "等待本机注册…"
    if (ui.alertLine.dataset.tone === "error") setAlert("")
  } else {
    ui.statusPill.textContent = `待命中 · ${portLabel}`
    ui.statusPill.dataset.tone = "paused"
    ui.statusSub.textContent = "轮询尚未运行"
    if (ui.alertLine.dataset.tone === "error") setAlert("")
  }

  ui.statusCluster.title = [
    `backend ${snapshot.status.backendUrl}`,
    snapshot.status.clientId ? `client ${snapshot.status.clientId}` : null,
    snapshot.status.leaseExpiresAt
      ? `lease ${formatDateTime(snapshot.status.leaseExpiresAt)}`
      : null,
    `failures ${snapshot.status.failureCount}`,
    `updated ${formatDateTime(snapshot.status.updatedAt)}`,
  ].filter(Boolean).join("\n")
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
      enabled ? `正在连接端口 ${port}…` : `已关闭 · 端口保留 ${port}`,
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

ui.copyUrlButton.addEventListener("click", () => {
  void (async () => {
    const url = ui.backendUrl.textContent?.trim() || ""
    if (!url) {
      setMessage("暂无服务地址可复制。", "error")
      return
    }
    const ok = await copyText(url)
    setMessage(ok ? "已复制服务地址。" : "复制失败，请检查剪贴板权限。", ok ? "success" : "error")
  })()
})

ui.clientIdToggle.addEventListener("click", () => {
  clientIdExpanded = !clientIdExpanded
  renderClientRegistration(currentSnapshot?.status.clientId)
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
