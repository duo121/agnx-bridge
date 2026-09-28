import {
  getBridgeBackendBaseUrl,
  normalizeBridgeRuntimeConfig,
  readBridgeRuntimeConfig,
  writeBridgeRuntimeConfig,
} from "../../bridge-config"
import type {
  BridgeCommandHistoryEntry,
  BridgeRuntimeConfig,
  BridgeRuntimeSnapshot,
} from "../../types/bridge-control"
import type {
  BridgeClientState,
  BridgeCommandResult,
  BridgePullResponse,
  BridgeRegisterResponse,
} from "../../types/bridge"
import { ensureNativeBridgeServer, stopNativeBridgeServer } from "../native-host"

interface CreateWebextBridgePollingControllerOptions {
  executeCommand: (command: Record<string, unknown>) => Promise<BridgeCommandResult>
  log?: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
}

const BRIDGE_STORAGE_KEY = "agnx-webext-bridge-client"
const BRIDGE_HISTORY_STORAGE_KEY = "agnx-webext-bridge-command-history"
const DEFAULT_PULL_WAIT_MS = 25000
const DEFAULT_ACTIVE_RETRY_MS = 350
const BRIDGE_ERROR_RETRY_MS = 3000
const BRIDGE_ERROR_RETRY_MAX_MS = 30000
const BRIDGE_ERROR_RETRY_JITTER_RATIO = 0.2
const BRIDGE_ERROR_LOG_MAX_LENGTH = 320
const BRIDGE_HISTORY_MAX_LENGTH = 200
const BRIDGE_HISTORY_DEFAULT_LIMIT = 40

let bridgeClientState: BridgeClientState | null = null
let bridgePollTimer: ReturnType<typeof setTimeout> | null = null
let bridgePollingStarted = false
let bridgePollInFlight = false
let bridgePollFailureCount = 0
let bridgePollLastLoggedBackoffMs = 0
let bridgePullWaitMs = DEFAULT_PULL_WAIT_MS
let bridgeActiveRetryMs = DEFAULT_ACTIVE_RETRY_MS
let bridgeRuntimeConfig: BridgeRuntimeConfig = {
  enabled: true,
  port: 3002,
}
let bridgeCommandHistory: BridgeCommandHistoryEntry[] = []
let bridgeLastError: string | undefined
let bridgeStatusUpdatedAt = Date.now()
let bridgeAbortController: AbortController | null = null
let bridgeInitPromise: Promise<void> | null = null

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function markBridgeStatusUpdated(): void {
  bridgeStatusUpdatedAt = Date.now()
}

function summarizeBridgePollErrorMessage(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim()
  const htmlIndex = normalized.indexOf("<!DOCTYPE html>")
  const withoutHtml = htmlIndex >= 0
    ? `${normalized.slice(0, htmlIndex).trim()} [html omitted]`
    : normalized

  if (withoutHtml.length <= BRIDGE_ERROR_LOG_MAX_LENGTH) {
    return withoutHtml
  }

  return `${withoutHtml.slice(0, BRIDGE_ERROR_LOG_MAX_LENGTH)}...`
}

function getBridgeBackoffBaseDelay(failureCount: number): number {
  const exponent = Math.max(0, failureCount - 1)
  return Math.min(BRIDGE_ERROR_RETRY_MAX_MS, BRIDGE_ERROR_RETRY_MS * (2 ** exponent))
}

function applyBridgeRetryJitter(delayMs: number): number {
  const jitterOffset = (Math.random() - 0.5) * 2 * BRIDGE_ERROR_RETRY_JITTER_RATIO
  return Math.max(BRIDGE_ERROR_RETRY_MS, Math.round(delayMs * (1 + jitterOffset)))
}

function getBridgeErrorRetryDelay(failureCount: number): {
  delayMs: number
  backoffBaseDelayMs: number
} {
  const backoffBaseDelayMs = getBridgeBackoffBaseDelay(failureCount)
  return {
    delayMs: applyBridgeRetryJitter(backoffBaseDelayMs),
    backoffBaseDelayMs,
  }
}

function resetBridgePollFailures(log: (...args: unknown[]) => void): void {
  if (bridgePollFailureCount > 0) {
    log(`[Bridge] Poll recovered after ${bridgePollFailureCount} failure(s)`)
  }
  bridgePollFailureCount = 0
  bridgePollLastLoggedBackoffMs = 0
}

function registerBridgePollFailure(
  message: string,
  warn: (...args: unknown[]) => void,
): number {
  bridgePollFailureCount += 1
  const { delayMs, backoffBaseDelayMs } = getBridgeErrorRetryDelay(bridgePollFailureCount)

  if (
    bridgePollFailureCount === 1
    || bridgePollLastLoggedBackoffMs !== backoffBaseDelayMs
  ) {
    warn(
      `[Bridge] Poll failed (attempt ${bridgePollFailureCount}, retry in ${delayMs}ms):`,
      summarizeBridgePollErrorMessage(message),
    )
    bridgePollLastLoggedBackoffMs = backoffBaseDelayMs
  }

  return delayMs
}

async function readBridgeStateFromStorage(): Promise<BridgeClientState | null> {
  try {
    const raw = await chrome.storage.local.get(BRIDGE_STORAGE_KEY)
    const value = raw?.[BRIDGE_STORAGE_KEY]
    if (!value || typeof value !== "object") return null
    const record = value as Record<string, unknown>
    if (
      typeof record.clientId !== "string"
      || typeof record.token !== "string"
      || typeof record.leaseExpiresAt !== "number"
    ) {
      return null
    }
    return {
      clientId: record.clientId,
      token: record.token,
      leaseExpiresAt: record.leaseExpiresAt,
    }
  } catch {
    return null
  }
}

async function persistBridgeState(state: BridgeClientState | null): Promise<void> {
  try {
    if (!state) {
      await chrome.storage.local.remove(BRIDGE_STORAGE_KEY)
      return
    }
    await chrome.storage.local.set({ [BRIDGE_STORAGE_KEY]: state })
  } catch {}
}

function cloneBridgeCommand(command: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(command)) as Record<string, unknown>
  } catch {
    return {
      kind: "unknown",
      note: "command serialization failed",
    }
  }
}

function normalizeHistoryLimit(limit?: number): number {
  if (typeof limit === "number" && Number.isFinite(limit)) {
    return clamp(Math.floor(limit), 1, BRIDGE_HISTORY_MAX_LENGTH)
  }
  return BRIDGE_HISTORY_DEFAULT_LIMIT
}

async function readBridgeHistoryFromStorage(): Promise<BridgeCommandHistoryEntry[]> {
  try {
    const raw = await chrome.storage.local.get(BRIDGE_HISTORY_STORAGE_KEY)
    const value = raw?.[BRIDGE_HISTORY_STORAGE_KEY]
    if (!Array.isArray(value)) return []

    return value
      .filter((item) => item && typeof item === "object")
      .map((item) => item as Partial<BridgeCommandHistoryEntry>)
      .filter((item) => (
        typeof item.id === "string"
        && typeof item.execId === "string"
        && typeof item.clientId === "string"
        && typeof item.backendUrl === "string"
        && item.command
        && typeof item.command === "object"
        && typeof item.receivedAt === "number"
        && typeof item.completedAt === "number"
        && typeof item.success === "boolean"
      ))
      .map((item) => ({
        id: item.id as string,
        execId: item.execId as string,
        clientId: item.clientId as string,
        backendUrl: item.backendUrl as string,
        command: item.command as Record<string, unknown>,
        receivedAt: item.receivedAt as number,
        completedAt: item.completedAt as number,
        success: item.success as boolean,
        ...(typeof item.error === "string" ? { error: item.error } : {}),
      }))
  } catch {
    return []
  }
}

async function persistBridgeHistory(): Promise<void> {
  try {
    await chrome.storage.local.set({
      [BRIDGE_HISTORY_STORAGE_KEY]: bridgeCommandHistory,
    })
  } catch {}
}

async function appendBridgeHistory(
  item: Omit<BridgeCommandHistoryEntry, "id">,
): Promise<void> {
  const historyItem: BridgeCommandHistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    ...item,
  }

  bridgeCommandHistory.unshift(historyItem)
  if (bridgeCommandHistory.length > BRIDGE_HISTORY_MAX_LENGTH) {
    bridgeCommandHistory = bridgeCommandHistory.slice(0, BRIDGE_HISTORY_MAX_LENGTH)
  }
  await persistBridgeHistory()
}

function getBridgeHistory(limit?: number): BridgeCommandHistoryEntry[] {
  const normalizedLimit = normalizeHistoryLimit(limit)
  return bridgeCommandHistory.slice(0, normalizedLimit)
}

async function clearBridgeHistory(): Promise<void> {
  bridgeCommandHistory = []
  await persistBridgeHistory()
}

function updatePollingHints(data: BridgeRegisterResponse["data"]): void {
  if (!data) return
  if (typeof data.pullWaitMs === "number" && Number.isFinite(data.pullWaitMs)) {
    bridgePullWaitMs = clamp(Math.floor(data.pullWaitMs), 1000, 30000)
  }
  if (typeof data.pollIntervalMs === "number" && Number.isFinite(data.pollIntervalMs)) {
    bridgeActiveRetryMs = clamp(Math.floor(data.pollIntervalMs), 100, 10000)
  }
}

async function ensureBridgeClient(force = false, signal?: AbortSignal): Promise<BridgeClientState | null> {
  if (!bridgeRuntimeConfig.enabled) return null

  if (!bridgeClientState) {
    bridgeClientState = await readBridgeStateFromStorage()
  }

  if (
    !force
    && bridgeClientState
    && bridgeClientState.leaseExpiresAt > Date.now() + 5000
  ) {
    return bridgeClientState
  }

  const response = await fetch(`${getBridgeBackendBaseUrl(bridgeRuntimeConfig)}/api/webext-bridge/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      clientId: bridgeClientState?.clientId,
      name: "agnx-webext-bridge-plugin",
      version: chrome.runtime.getManifest().version,
      extensionId: chrome.runtime.id,
    }),
  })

  const result = await response.json() as BridgeRegisterResponse
  if (!response.ok || !result?.success) {
    throw new Error(result?.error || "webext bridge register failed")
  }

  if (
    typeof result.data?.clientId !== "string"
    || typeof result.data?.token !== "string"
    || typeof result.data?.leaseExpiresAt !== "number"
  ) {
    throw new Error("Invalid bridge register response")
  }

  updatePollingHints(result.data)
  bridgeClientState = {
    clientId: result.data.clientId,
    token: result.data.token,
    leaseExpiresAt: result.data.leaseExpiresAt,
  }
  await persistBridgeState(bridgeClientState)
  markBridgeStatusUpdated()
  return bridgeClientState
}

async function reportBridgeResult(
  state: BridgeClientState,
  execId: string,
  output: BridgeCommandResult,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${getBridgeBackendBaseUrl(bridgeRuntimeConfig)}/api/webext-bridge/result`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webext-bridge-token": state.token,
    },
    signal,
    body: JSON.stringify({
      clientId: state.clientId,
      execId,
      success: output.success,
      result: output.result,
      error: output.error,
    }),
  })

  if (response.status === 401) {
    bridgeClientState = null
    await persistBridgeState(null)
    markBridgeStatusUpdated()
    return
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`webext bridge result failed: ${response.status} ${text}`)
  }
}

async function bridgePollOnce(
  options: CreateWebextBridgePollingControllerOptions,
  signal?: AbortSignal,
): Promise<void> {
  const state = await ensureBridgeClient(false, signal)
  if (!state) return

  const pullUrl = new URL(`${getBridgeBackendBaseUrl(bridgeRuntimeConfig)}/api/webext-bridge/pull`)
  pullUrl.searchParams.set("clientId", state.clientId)
  pullUrl.searchParams.set("waitMs", String(bridgePullWaitMs))

  const response = await fetch(pullUrl.toString(), {
    method: "GET",
    headers: {
      "x-webext-bridge-token": state.token,
    },
    signal,
  })

  if (response.status === 401) {
    bridgeClientState = null
    await persistBridgeState(null)
    markBridgeStatusUpdated()
    return
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`webext bridge pull failed: ${response.status} ${text}`)
  }

  const payload = await response.json() as BridgePullResponse
  if (!payload?.success) {
    throw new Error(payload?.error || "webext bridge pull failed")
  }

  const command = payload.data?.command
  if (!command) {
    resetBridgePollFailures(options.log ?? console.log)
    return
  }

  const receivedAt = Date.now()
  const commandRecord = cloneBridgeCommand(command.command)
  let output: BridgeCommandResult
  let reportError: string | undefined
  try {
    output = await options.executeCommand(command.command)
  } catch (error) {
    output = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  try {
    await reportBridgeResult(state, command.execId, output, signal)
  } catch (error) {
    reportError = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    await appendBridgeHistory({
      execId: command.execId,
      clientId: state.clientId,
      backendUrl: getBridgeBackendBaseUrl(bridgeRuntimeConfig),
      command: commandRecord,
      receivedAt,
      completedAt: Date.now(),
      success: output.success && !reportError,
      ...(output.error || reportError
        ? { error: output.error ?? reportError }
        : {}),
    })
  }

  resetBridgePollFailures(options.log ?? console.log)
  bridgeLastError = undefined
  markBridgeStatusUpdated()
}

function scheduleNextBridgePoll(
  options: CreateWebextBridgePollingControllerOptions,
  delayMs: number,
): void {
  if (!bridgeRuntimeConfig.enabled || !bridgePollingStarted) return
  if (bridgePollTimer) {
    clearTimeout(bridgePollTimer)
  }

  bridgePollTimer = setTimeout(() => {
    void runBridgePollLoop(options)
  }, delayMs)
}

async function runBridgePollLoop(options: CreateWebextBridgePollingControllerOptions): Promise<void> {
  if (!bridgeRuntimeConfig.enabled || !bridgePollingStarted || bridgePollInFlight) return
  bridgePollInFlight = true
  bridgeAbortController = new AbortController()
  markBridgeStatusUpdated()

  try {
    await bridgePollOnce(options, bridgeAbortController.signal)
    scheduleNextBridgePoll(options, bridgeActiveRetryMs)
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    bridgeLastError = message
    markBridgeStatusUpdated()
    const retryMs = registerBridgePollFailure(message, options.warn ?? console.warn)
    scheduleNextBridgePoll(options, retryMs)
  } finally {
    bridgePollInFlight = false
    bridgeAbortController = null
    markBridgeStatusUpdated()
  }
}

function resetBridgeRuntimeState(): void {
  bridgeClientState = null
  bridgeLastError = undefined
  bridgePullWaitMs = DEFAULT_PULL_WAIT_MS
  bridgeActiveRetryMs = DEFAULT_ACTIVE_RETRY_MS
  bridgePollFailureCount = 0
  bridgePollLastLoggedBackoffMs = 0
  markBridgeStatusUpdated()
}

function setBridgeRuntimeError(error: unknown): void {
  bridgeLastError = error instanceof Error ? error.message : String(error)
  markBridgeStatusUpdated()
}

async function stopBridgePolling(): Promise<void> {
  bridgePollingStarted = false

  if (bridgePollTimer) {
    clearTimeout(bridgePollTimer)
    bridgePollTimer = null
  }

  if (bridgeAbortController) {
    bridgeAbortController.abort()
    bridgeAbortController = null
  }

  await persistBridgeState(null)
  resetBridgeRuntimeState()
}

function startBridgePolling(options: CreateWebextBridgePollingControllerOptions): void {
  if (!bridgeRuntimeConfig.enabled || bridgePollingStarted) return
  bridgePollingStarted = true
  bridgeLastError = undefined
  markBridgeStatusUpdated()
  void runBridgePollLoop(options)
}

function getBridgeRuntimeSnapshot(): BridgeRuntimeSnapshot {
  return {
    config: { ...bridgeRuntimeConfig },
    status: {
      running: bridgePollingStarted,
      inFlight: bridgePollInFlight,
      backendUrl: getBridgeBackendBaseUrl(bridgeRuntimeConfig),
      clientId: bridgeClientState?.clientId,
      leaseExpiresAt: bridgeClientState?.leaseExpiresAt,
      lastError: bridgeLastError,
      failureCount: bridgePollFailureCount,
      updatedAt: bridgeStatusUpdatedAt,
    },
  }
}

export interface WebextBridgePollingController {
  ensureInitialized: () => Promise<void>
  getSnapshot: () => BridgeRuntimeSnapshot
  setConfig: (config: BridgeRuntimeConfig) => Promise<BridgeRuntimeSnapshot>
  requestImmediatePoll: () => Promise<void>
  getHistory: (limit?: number) => BridgeCommandHistoryEntry[]
  clearHistory: () => Promise<BridgeCommandHistoryEntry[]>
}

export function createWebextBridgePollingController(
  options: CreateWebextBridgePollingControllerOptions,
): WebextBridgePollingController {
  async function syncBridgePollingToConfig(rethrow = false): Promise<void> {
    try {
      await stopBridgePolling()

      if (!bridgeRuntimeConfig.enabled) {
        await stopNativeBridgeServer()
        bridgeLastError = undefined
        markBridgeStatusUpdated()
        return
      }

      await ensureNativeBridgeServer(bridgeRuntimeConfig.port)
      bridgeLastError = undefined
      markBridgeStatusUpdated()
      startBridgePolling(options)
    } catch (error) {
      setBridgeRuntimeError(error)
      if (rethrow) {
        throw error
      }
    }
  }

  async function ensureInitialized(): Promise<void> {
    if (!bridgeInitPromise) {
      bridgeInitPromise = (async () => {
        bridgeRuntimeConfig = await readBridgeRuntimeConfig()
        bridgeCommandHistory = await readBridgeHistoryFromStorage()
        markBridgeStatusUpdated()
        await syncBridgePollingToConfig(false)
      })()
    }

    try {
      await bridgeInitPromise
    } catch (error) {
      bridgeInitPromise = null
      throw error
    }
  }

  async function setConfig(config: BridgeRuntimeConfig): Promise<BridgeRuntimeSnapshot> {
    await ensureInitialized()
    bridgeRuntimeConfig = normalizeBridgeRuntimeConfig(config, bridgeRuntimeConfig)
    await writeBridgeRuntimeConfig(bridgeRuntimeConfig)
    markBridgeStatusUpdated()
    await syncBridgePollingToConfig(true)
    return getBridgeRuntimeSnapshot()
  }

  async function requestImmediatePoll(): Promise<void> {
    await ensureInitialized()
    if (!bridgeRuntimeConfig.enabled) return

    startBridgePolling(options)

    if (bridgePollTimer) {
      clearTimeout(bridgePollTimer)
      bridgePollTimer = null
    }

    if (bridgePollInFlight) return
    void runBridgePollLoop(options)
  }

  return {
    ensureInitialized,
    getSnapshot: getBridgeRuntimeSnapshot,
    setConfig,
    requestImmediatePoll,
    getHistory: getBridgeHistory,
    clearHistory: async () => {
      await clearBridgeHistory()
      return getBridgeHistory(BRIDGE_HISTORY_MAX_LENGTH)
    },
  }
}
