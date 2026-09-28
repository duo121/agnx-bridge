import { resolveActiveTabId } from "../executors/page-agent"
import type {
  ConsoleCaptureAction,
  ConsoleCaptureFilter,
  ConsoleCaptureTarget,
  ConsoleLogEntry,
} from "../../types/console-capture"

type ConsoleCaptureResult = { result?: unknown; error?: string }

interface CreateConsoleCaptureRuntimeOptions {
  backgroundLog: (...args: unknown[]) => void
  backgroundError: (...args: unknown[]) => void
  originalConsole: {
    log: typeof console.log
    info: typeof console.info
    warn: typeof console.warn
    error: typeof console.error
    debug: typeof console.debug
  }
}

const CAPTURED_LOG_LIMIT = 1000
const CAPTURED_LOG_RETAIN = 500
const EXTENSION_CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const
const CDP_VERSION = "1.3"

function serializeConsoleValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (depth > 4) return "[max depth]"
  if (value === null) return null
  if (value === undefined) return "[undefined]"
  if (
    typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value
  }
  if (typeof value === "bigint") return `${value.toString()}n`
  if (typeof value === "symbol") return value.toString()
  if (typeof value === "function") return `[Function: ${value.name || "anonymous"}]`
  if (value instanceof Error) {
    return {
      _type: "Error",
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }
  if (value instanceof Date) {
    return {
      _type: "Date",
      value: value.toISOString(),
    }
  }
  if (value instanceof RegExp) {
    return {
      _type: "RegExp",
      value: value.toString(),
    }
  }
  if (value instanceof Map) {
    return {
      _type: "Map",
      entries: Array.from(value.entries())
        .slice(0, 50)
        .map(([entryKey, entryValue]) => ([
          serializeConsoleValue(entryKey, depth + 1, seen),
          serializeConsoleValue(entryValue, depth + 1, seen),
        ])),
    }
  }
  if (value instanceof Set) {
    return {
      _type: "Set",
      values: Array.from(value.values())
        .slice(0, 50)
        .map((item) => serializeConsoleValue(item, depth + 1, seen)),
    }
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => serializeConsoleValue(item, depth + 1, seen))
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    try {
      return Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .reduce<Record<string, unknown>>((acc, [entryKey, entryValue]) => {
          acc[entryKey] = serializeConsoleValue(entryValue, depth + 1, seen)
          return acc
        }, {})
    } finally {
      seen.delete(value)
    }
  }
  return String(value)
}

function appendCapturedLog(buffer: ConsoleLogEntry[], entry: ConsoleLogEntry): void {
  buffer.push(entry)
  if (buffer.length > CAPTURED_LOG_LIMIT) {
    buffer.splice(0, buffer.length - CAPTURED_LOG_RETAIN)
  }
}

function filterCapturedLogs(
  source: ConsoleLogEntry[],
  filter?: ConsoleCaptureFilter,
): ConsoleLogEntry[] {
  let logs = [...source]

  if (filter?.levels && filter.levels.length > 0) {
    logs = logs.filter((log) => filter.levels?.includes(log.type as "log" | "info" | "warn" | "error" | "debug"))
  }

  if (filter?.keyword) {
    const keyword = filter.keyword.toLowerCase()
    logs = logs.filter((log) => log.args.some((arg) => String(arg).toLowerCase().includes(keyword)))
  }

  const limit = filter?.limit ?? 100
  if (logs.length > limit) {
    logs = logs.slice(-limit)
  }

  return logs
}

export function createConsoleCaptureRuntime(options: CreateConsoleCaptureRuntimeOptions) {
  let pageCaptureTabId: number | null = null
  let pageCapturedLogs: ConsoleLogEntry[] = []
  let extensionCapturedLogs: ConsoleLogEntry[] = []
  let extensionConsoleHookInstalled = false
  let extensionConsoleCaptureEnabled = false

  function resolveConsoleCaptureTarget(value: unknown): ConsoleCaptureTarget | undefined {
    if (value === undefined || value === null || value === "") return "page"
    return value === "page" || value === "extension" ? value : undefined
  }

  function installExtensionConsoleCapture(): void {
    if (extensionConsoleHookInstalled) return

    for (const method of EXTENSION_CONSOLE_METHODS) {
      const originalMethod = options.originalConsole[method]
      console[method] = ((...args: unknown[]) => {
        if (extensionConsoleCaptureEnabled) {
          appendCapturedLog(extensionCapturedLogs, {
            type: method,
            args: args.map((arg) => serializeConsoleValue(arg)),
            timestamp: Date.now(),
          })
        }
        originalMethod(...args)
      }) as typeof console[typeof method]
    }

    extensionConsoleHookInstalled = true
  }

  async function startPageConsoleCapture(tabId: number): Promise<{ error?: string }> {
    if (pageCaptureTabId === tabId) {
      options.backgroundLog("[ConsoleCapture] Already capturing page tab", tabId)
      return {}
    }

    if (pageCaptureTabId !== null) {
      await stopPageConsoleCapture(pageCaptureTabId)
    }

    try {
      await chrome.debugger.attach({ tabId }, CDP_VERSION)
      await chrome.debugger.sendCommand({ tabId }, "Runtime.enable")
      pageCaptureTabId = tabId
      pageCapturedLogs = []
      options.backgroundLog("[ConsoleCapture] Page capture started", tabId)
      return {}
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      options.backgroundError("[ConsoleCapture] Failed to start page capture:", message)
      return { error: message }
    }
  }

  async function stopPageConsoleCapture(tabId: number): Promise<{ error?: string }> {
    if (pageCaptureTabId !== tabId) {
      return { error: `Not capturing tab ${tabId}` }
    }

    try {
      await chrome.debugger.detach({ tabId })
      pageCaptureTabId = null
      options.backgroundLog("[ConsoleCapture] Page capture stopped", tabId)
      return {}
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pageCaptureTabId = null
      options.backgroundError("[ConsoleCapture] Failed to stop page capture:", message)
      return { error: message }
    }
  }

  function startExtensionConsoleCapture(): void {
    extensionConsoleCaptureEnabled = true
    options.backgroundLog("[ConsoleCapture] Extension console capture enabled")
  }

  function stopExtensionConsoleCapture(): void {
    extensionConsoleCaptureEnabled = false
    options.backgroundLog("[ConsoleCapture] Extension console capture disabled")
  }

  async function executePageConsoleCaptureAction(
    action: ConsoleCaptureAction,
    tabId?: number,
    filter?: ConsoleCaptureFilter,
  ): Promise<ConsoleCaptureResult> {
    let resolvedTabId = tabId
    if (!resolvedTabId && (action === "start" || action === "stop")) {
      resolvedTabId = await resolveActiveTabId()
    }

    switch (action) {
      case "start":
        if (!resolvedTabId) return { error: "tabId is required for start action" }
        {
          const response = await startPageConsoleCapture(resolvedTabId)
          if (response.error) return { error: response.error }
          return { result: { target: "page", tabId: resolvedTabId, status: "capturing" } }
        }
      case "stop":
        if (!resolvedTabId) return { error: "tabId is required for stop action" }
        {
          const response = await stopPageConsoleCapture(resolvedTabId)
          if (response.error) return { error: response.error }
          return { result: { target: "page", tabId: resolvedTabId, status: "stopped" } }
        }
      case "get":
        return { result: filterCapturedLogs(pageCapturedLogs, filter) }
      case "clear":
        pageCapturedLogs = []
        return { result: { target: "page", status: "cleared" } }
      default:
        return { error: `Unknown action: ${String(action)}` }
    }
  }

  async function executeExtensionConsoleCaptureAction(
    action: ConsoleCaptureAction,
    filter?: ConsoleCaptureFilter,
  ): Promise<ConsoleCaptureResult> {
    switch (action) {
      case "start":
        startExtensionConsoleCapture()
        return { result: { target: "extension", status: "capturing" } }
      case "stop":
        stopExtensionConsoleCapture()
        return { result: { target: "extension", status: "stopped" } }
      case "get":
        return { result: filterCapturedLogs(extensionCapturedLogs, filter) }
      case "clear":
        extensionCapturedLogs = []
        return { result: { target: "extension", status: "cleared" } }
      default:
        return { error: `Unknown action: ${String(action)}` }
    }
  }

  async function executeConsoleCaptureAction(
    target: ConsoleCaptureTarget,
    action: ConsoleCaptureAction,
    tabId?: number,
    filter?: ConsoleCaptureFilter,
  ): Promise<ConsoleCaptureResult> {
    if (target === "page") {
      return executePageConsoleCaptureAction(action, tabId, filter)
    }
    return executeExtensionConsoleCaptureAction(action, filter)
  }

  function handleDebuggerEvent(
    source: chrome.debugger.Debuggee,
    method: string,
    params?: unknown,
  ) {
    if (source.tabId !== pageCaptureTabId) return
    if (method !== "Runtime.consoleAPICalled") return

    const payload = params as {
      type: string
      args: Array<{ type: string; value?: unknown; description?: string; preview?: unknown }>
      timestamp: number
      stackTrace?: {
        callFrames: Array<{
          functionName: string
          url: string
          lineNumber: number
          columnNumber: number
        }>
      }
    }

    const convertedArgs = payload.args.map((arg) => {
      if (arg.value !== undefined) return arg.value
      if (arg.description) return arg.description
      if (arg.preview) return arg.preview
      return `[${arg.type}]`
    })

    appendCapturedLog(pageCapturedLogs, {
      type: payload.type as ConsoleLogEntry["type"],
      args: convertedArgs,
      timestamp: payload.timestamp,
      stackTrace: payload.stackTrace,
    })
  }

  function handleDebuggerDetach(source: chrome.debugger.Debuggee, reason: string): void {
    if (source.tabId === pageCaptureTabId) {
      options.backgroundLog("[ConsoleCapture] Page debugger detached:", reason)
      pageCaptureTabId = null
    }
  }

  function handleTabRemoved(tabId: number): void {
    if (tabId === pageCaptureTabId) {
      options.backgroundLog("[ConsoleCapture] Captured page tab closed")
      pageCaptureTabId = null
    }
  }

  return {
    installExtensionConsoleCapture,
    resolveConsoleCaptureTarget,
    executeConsoleCaptureAction,
    handleDebuggerEvent,
    handleDebuggerDetach,
    handleTabRemoved,
  }
}
