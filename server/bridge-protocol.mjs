import { randomUUID } from "node:crypto"
import { BRIDGE_CONSTANTS, BridgeStore } from "./bridge-store.mjs"

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const RESULT_LIMITS = {
  maxStringLength: 512,
  maxDepth: 6,
  maxArrayLength: 50,
  maxObjectKeys: 50,
  maxTruncatedItems: 200,
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeOptionalString(value, maxLength) {
  if (typeof value !== "string") return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  return normalized.slice(0, maxLength)
}

function ensureValidClientId(candidate) {
  const normalized = typeof candidate === "string" ? candidate.trim() : ""
  if (!CLIENT_ID_PATTERN.test(normalized)) {
    throw new Error("clientId 非法")
  }
  return normalized
}

function parseWaitMs(value, fallback, max) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clamp(Math.floor(value), 0, max)
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(parsed)) {
      return clamp(parsed, 0, max)
    }
  }
  return fallback
}

function pushTruncation(items, item) {
  if (items.length < RESULT_LIMITS.maxTruncatedItems) {
    items.push(item)
  }
}

function sanitizeResultValue(value, path, depth, items) {
  if (typeof value === "string") {
    if (value.length <= RESULT_LIMITS.maxStringLength) return value
    pushTruncation(items, {
      path,
      reason: "string_length",
      originalLength: value.length,
    })
    return `${value.slice(0, RESULT_LIMITS.maxStringLength)}...`
  }

  if (
    value === null
    || value === undefined
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value
  }

  if (typeof value === "bigint") {
    pushTruncation(items, { path, reason: "bigint" })
    return value.toString()
  }

  if (typeof value === "function") {
    pushTruncation(items, { path, reason: "function" })
    return "[Function]"
  }

  if (typeof value !== "object") {
    return String(value)
  }

  if (depth >= RESULT_LIMITS.maxDepth) {
    pushTruncation(items, { path, reason: "depth" })
    return "[Truncated: max depth reached]"
  }

  if (Array.isArray(value)) {
    const result = value
      .slice(0, RESULT_LIMITS.maxArrayLength)
      .map((item, index) => sanitizeResultValue(item, `${path}[${index}]`, depth + 1, items))
    if (value.length > RESULT_LIMITS.maxArrayLength) {
      pushTruncation(items, {
        path,
        reason: "array_length",
        originalLength: value.length,
      })
    }
    return result
  }

  const entries = Object.entries(value)
  const limitedEntries = entries.slice(0, RESULT_LIMITS.maxObjectKeys)
  if (entries.length > RESULT_LIMITS.maxObjectKeys) {
    pushTruncation(items, {
      path,
      reason: "object_keys",
      originalLength: entries.length,
    })
  }

  const output = {}
  for (const [key, child] of limitedEntries) {
    output[key] = sanitizeResultValue(child, `${path}.${key}`, depth + 1, items)
  }
  return output
}

function sanitizeResultPayload(input) {
  const items = []
  const value = sanitizeResultValue(input, "$", 0, items)
  return items.length > 0
    ? {
        value,
        truncation: {
          total: items.length,
          truncatedAt: Date.now(),
          items,
        },
      }
    : { value }
}

export function readBridgeAuthToken(headers) {
  const agnxToken = headers["x-agnx-bridge-token"]
  if (typeof agnxToken === "string" && agnxToken.trim()) {
    return agnxToken.trim()
  }

  // 兼容旧扩展头
  const legacyToken = headers["x-webext-bridge-token"]
  if (typeof legacyToken === "string" && legacyToken.trim()) {
    return legacyToken.trim()
  }

  const authHeader = typeof headers.authorization === "string" ? headers.authorization : ""
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim()
  }

  return ""
}

export function parseBridgeCommand(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("command 必须是对象")
  }

  const record = input
  const kindRaw = typeof record.kind === "string" ? record.kind.trim() : ""

  const parseBrowserAgent = () => {
    const method = typeof record.method === "string" ? record.method.trim() : ""
    if (!method) {
      throw new Error("browser-agent command.method 不能为空")
    }

    if (record.args !== undefined && !Array.isArray(record.args)) {
      throw new Error("browser-agent command.args 必须是数组")
    }

    return {
      kind: "browser-agent",
      method,
      ...(record.args ? { args: record.args } : {}),
      ...(normalizeOptionalString(record.listenerId, 256)
        ? { listenerId: normalizeOptionalString(record.listenerId, 256) }
        : {}),
    }
  }

  const parsePageAgent = () => {
    const code = typeof record.code === "string" ? record.code.trim() : ""
    if (!code) {
      throw new Error("page-agent command.code 不能为空")
    }

    if (record.args !== undefined && !Array.isArray(record.args)) {
      throw new Error("page-agent command.args 必须是数组")
    }

    if (
      record.tabId !== undefined
      && (typeof record.tabId !== "number" || !Number.isFinite(record.tabId))
    ) {
      throw new Error("page-agent command.tabId 必须是数字")
    }

    if (
      record.timeout !== undefined
      && (typeof record.timeout !== "number" || !Number.isFinite(record.timeout))
    ) {
      throw new Error("page-agent command.timeout 必须是数字")
    }

    return {
      kind: "page-agent",
      code,
      ...(record.tabId !== undefined ? { tabId: Math.floor(record.tabId) } : {}),
      ...(record.args ? { args: record.args } : {}),
      ...(record.timeout !== undefined
        ? { timeout: clamp(Math.floor(record.timeout), 0, 120_000) }
        : {}),
    }
  }

  const parseConsoleCapture = () => {
    const targetRaw = typeof record.target === "string" ? record.target.trim() : ""
    const target = targetRaw || "page"
    if (target !== "page" && target !== "extension") {
      throw new Error("console-capture command.target 非法，仅支持 page / extension")
    }

    const action = typeof record.action === "string" ? record.action.trim() : ""
    if (!["start", "stop", "get", "clear"].includes(action)) {
      throw new Error("console-capture command.action 非法")
    }

    if (
      record.tabId !== undefined
      && (typeof record.tabId !== "number" || !Number.isFinite(record.tabId))
    ) {
      throw new Error("console-capture command.tabId 必须是数字")
    }

    if (target === "extension" && record.tabId !== undefined) {
      throw new Error("console-capture target=extension 时不支持 tabId")
    }

    let filter
    if (record.filter !== undefined) {
      if (!record.filter || typeof record.filter !== "object" || Array.isArray(record.filter)) {
        throw new Error("console-capture command.filter 必须是对象")
      }

      const rawFilter = record.filter
      let levels
      if (rawFilter.levels !== undefined) {
        if (!Array.isArray(rawFilter.levels)) {
          throw new Error("console-capture command.filter.levels 必须是数组")
        }

        const normalizedLevels = rawFilter.levels
          .filter((item) => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => ["log", "info", "warn", "error", "debug"].includes(item))

        levels = normalizedLevels.length > 0 ? normalizedLevels : undefined
      }

      let limit
      if (rawFilter.limit !== undefined) {
        if (typeof rawFilter.limit !== "number" || !Number.isFinite(rawFilter.limit)) {
          throw new Error("console-capture command.filter.limit 必须是数字")
        }
        limit = clamp(Math.floor(rawFilter.limit), 1, 1000)
      }

      filter = {
        ...(levels ? { levels } : {}),
        ...(normalizeOptionalString(rawFilter.keyword, 256)
          ? { keyword: normalizeOptionalString(rawFilter.keyword, 256) }
          : {}),
        ...(limit !== undefined ? { limit } : {}),
      }
    }

    return {
      kind: "console-capture",
      target,
      action,
      ...(record.tabId !== undefined ? { tabId: Math.floor(record.tabId) } : {}),
      ...(filter ? { filter } : {}),
    }
  }

  if (kindRaw === "browser-agent") return parseBrowserAgent()
  if (kindRaw === "page-agent") return parsePageAgent()
  if (kindRaw === "console-capture") return parseConsoleCapture()

  if (typeof record.method === "string") return parseBrowserAgent()
  if (typeof record.code === "string") return parsePageAgent()
  if (typeof record.action === "string") return parseConsoleCapture()

  throw new Error("无法识别的 bridge command，仅支持 browser-agent / page-agent / console-capture")
}

function toBridgeClientView(store, record) {
  return {
    clientId: record.clientId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    leaseExpiresAt: record.leaseExpiresAt,
    online: store.isClientOnline(record),
    meta: { ...record.meta },
  }
}

function toBridgeExecView(record) {
  return {
    execId: record.execId,
    clientId: record.clientId,
    source: record.source,
    command: record.command,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    dispatchedAt: record.dispatchedAt,
    completedAt: record.completedAt,
    result: record.result,
    resultTruncation: record.resultTruncation,
    error: record.error,
  }
}

export function createBridgeProtocol({ store = new BridgeStore() } = {}) {
  function cleanup() {
    store.cleanup()
  }

  function resolveTargetClient(preferredClientId) {
    cleanup()

    if (preferredClientId) {
      const normalized = ensureValidClientId(preferredClientId)
      const record = store.clients.get(normalized)
      if (!record) {
        throw new Error("指定 clientId 不存在")
      }
      if (!store.isClientOnline(record)) {
        throw new Error("指定 clientId 当前离线")
      }
      return record
    }

    const online = [...store.clients.values()]
      .filter((client) => store.isClientOnline(client))
      .sort((a, b) => b.updatedAt - a.updatedAt)

    if (online.length === 0) {
      throw new Error("暂无在线 AGNX Bridge 客户端")
    }

    return online[0]
  }

  function dequeuePendingExec(clientId) {
    const queue = store.ensureQueue(clientId)

    while (queue.length > 0) {
      const execId = queue.shift()
      const record = store.execs.get(execId)
      if (!record || record.clientId !== clientId || record.status !== "pending") {
        continue
      }

      const current = Date.now()
      record.status = "dispatched"
      record.dispatchedAt = current
      record.updatedAt = current
      return record
    }

    return null
  }

  return {
    constants: BRIDGE_CONSTANTS,

    registerClient(input) {
      cleanup()
      const current = Date.now()
      const preferredId = input.clientId ? ensureValidClientId(input.clientId) : undefined
      const clientId = preferredId || `agnx-${randomUUID().slice(0, 8)}`
      const existing = store.clients.get(clientId)
      const token = randomUUID().replace(/-/g, "")

      const record = {
        clientId,
        token,
        createdAt: existing?.createdAt || current,
        updatedAt: current,
        leaseExpiresAt: current + BRIDGE_CONSTANTS.clientLeaseMs,
        meta: {
          name: normalizeOptionalString(input.name, 120),
          version: normalizeOptionalString(input.version, 64),
          extensionId: normalizeOptionalString(input.extensionId, 120),
          userAgent: normalizeOptionalString(input.userAgent, 256),
        },
      }

      store.clients.set(clientId, record)
      store.ensureQueue(clientId)

      return {
        clientId,
        token,
        leaseExpiresAt: record.leaseExpiresAt,
        pullWaitMs: BRIDGE_CONSTANTS.defaultPullWaitMs,
        pollIntervalMs: 350,
      }
    },

    authenticateClient(clientId, token) {
      cleanup()
      const normalizedId = ensureValidClientId(clientId)
      const normalizedToken = typeof token === "string" ? token.trim() : ""

      if (!normalizedToken) {
        throw new Error("缺少 bridge token")
      }

      const record = store.clients.get(normalizedId)
      if (!record) {
        throw new Error("bridge client 不存在")
      }

      if (record.token !== normalizedToken) {
        throw new Error("bridge token 无效")
      }

      const current = Date.now()
      record.updatedAt = current
      record.leaseExpiresAt = current + BRIDGE_CONSTANTS.clientLeaseMs
      return record
    },

    async pullCommand(clientId, waitMsInput) {
      const normalizedId = ensureValidClientId(clientId)
      const waitMs = parseWaitMs(
        waitMsInput,
        BRIDGE_CONSTANTS.defaultPullWaitMs,
        BRIDGE_CONSTANTS.maxPullWaitMs,
      )

      cleanup()

      const immediate = dequeuePendingExec(normalizedId)
      if (immediate) {
        return immediate
      }

      await store.waitForPullSignal(normalizedId, waitMs)
      cleanup()
      return dequeuePendingExec(normalizedId)
    },

    enqueueExec(input) {
      cleanup()

      const client = resolveTargetClient(input.clientId)
      const current = Date.now()
      const record = {
        execId: randomUUID(),
        clientId: client.clientId,
        command: input.command,
        source: normalizeOptionalString(input.source, 120),
        status: "pending",
        createdAt: current,
        updatedAt: current,
      }

      store.execs.set(record.execId, record)
      store.ensureQueue(record.clientId).push(record.execId)
      store.signalPullClient(record.clientId)
      return record
    },

    submitExecResult(input) {
      cleanup()

      const normalizedClientId = ensureValidClientId(input.clientId)
      const normalizedExecId = typeof input.execId === "string" ? input.execId.trim() : ""
      if (!normalizedExecId) {
        throw new Error("execId 不能为空")
      }

      const record = store.execs.get(normalizedExecId)
      if (!record) {
        throw new Error("execId 不存在")
      }

      if (record.clientId !== normalizedClientId) {
        throw new Error("execId 与 clientId 不匹配")
      }

      if (["succeeded", "failed", "timeout"].includes(record.status)) {
        return record
      }

      const current = Date.now()
      record.status = input.success ? "succeeded" : "failed"
      record.updatedAt = current
      record.completedAt = current

      const sanitizedResult = sanitizeResultPayload(input.result)
      record.result = sanitizedResult.value
      record.resultTruncation = sanitizedResult.truncation

      if (!input.success) {
        record.error = normalizeOptionalString(input.error, 1024) || "Bridge command failed"
      }

      store.signalExec(record.execId)
      return record
    },

    async waitForExec(execId, waitMsInput) {
      const normalizedExecId = typeof execId === "string" ? execId.trim() : ""
      if (!normalizedExecId) {
        throw new Error("execId 不能为空")
      }

      const waitMs = parseWaitMs(
        waitMsInput,
        BRIDGE_CONSTANTS.defaultExecWaitMs,
        BRIDGE_CONSTANTS.maxExecWaitMs,
      )

      cleanup()
      const current = store.execs.get(normalizedExecId)
      if (!current) {
        throw new Error("execId 不存在")
      }

      if (["succeeded", "failed", "timeout"].includes(current.status)) {
        return current
      }

      await store.waitForExecSignal(normalizedExecId, waitMs)
      cleanup()

      const latest = store.execs.get(normalizedExecId)
      if (!latest) {
        throw new Error("execId 不存在")
      }

      return latest
    },

    getExec(execId) {
      cleanup()
      const normalizedExecId = typeof execId === "string" ? execId.trim() : ""
      if (!normalizedExecId) return null
      return store.execs.get(normalizedExecId) || null
    },

    getHealth() {
      cleanup()

      const clients = [...store.clients.values()]
      const clientViews = clients.map((client) => toBridgeClientView(store, client))
      const onlineCount = clients.filter((client) => store.isClientOnline(client)).length

      const queueByClient = [...store.queues.entries()].map(([clientId, queue]) => {
        const pending = queue.reduce((count, execId) => {
          const exec = store.execs.get(execId)
          return exec && exec.status === "pending" ? count + 1 : count
        }, 0)
        return { clientId, pending }
      })
      const totalPending = queueByClient.reduce((sum, item) => sum + item.pending, 0)

      const executions = [...store.execs.values()]
      const statusCounter = {
        pending: 0,
        dispatched: 0,
        succeeded: 0,
        failed: 0,
        timeout: 0,
      }

      for (const exec of executions) {
        statusCounter[exec.status] += 1
      }

      return {
        checkedAt: Date.now(),
        clients: {
          total: clients.length,
          online: onlineCount,
          offline: clients.length - onlineCount,
          items: clientViews,
        },
        queues: {
          totalPending,
          byClient: queueByClient.sort((a, b) => a.clientId.localeCompare(b.clientId)),
        },
        executions: {
          total: executions.length,
          ...statusCounter,
        },
      }
    },

    toExecView(record) {
      return toBridgeExecView(record)
    },
  }
}
