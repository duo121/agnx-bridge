interface BrowserAgentExecutionResponse {
  result?: unknown
  error?: string
}

const ALLOWED_NAMESPACES = [
  "tabs",
  "windows",
  "tabGroups",
  "bookmarks",
  "history",
  "downloads",
  "storage",
  "sessions",
  "alarms",
  "notifications",
  "contextMenus",
  "debugger",
] as const

const DANGEROUS_APIS = [
  "management.uninstallSelf",
  "management.setEnabled",
  "runtime.reload",
  "runtime.restart",
] as const

export function summarizeValueForLog(value: unknown): string {
  if (typeof value === "string") return `string(len=${value.length})`
  if (Array.isArray(value)) return `array(len=${value.length})`
  if (value && typeof value === "object") {
    try {
      return `object(keys=${Object.keys(value as Record<string, unknown>).length})`
    } catch {
      return "object(keys=?)"
    }
  }
  return String(value)
}

function ensureHttpUrl(url: string): string {
  if (!url) return url
  const trimmed = url.trim()
  if (!trimmed) return trimmed
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export async function executeChromeApi(
  method: string,
  args: unknown[] = [],
): Promise<BrowserAgentExecutionResponse> {
  const parts = method.split(".")
  if (parts.length < 2) {
    return { error: `Invalid method format: ${method}. Expected: namespace.method` }
  }

  const namespace = parts[0]
  if (!ALLOWED_NAMESPACES.includes(namespace as (typeof ALLOWED_NAMESPACES)[number])) {
    return { error: `Unsupported namespace: ${namespace}. Allowed: ${ALLOWED_NAMESPACES.join(", ")}` }
  }

  if (DANGEROUS_APIS.some((api) => method.startsWith(api))) {
    return { error: `Forbidden API: ${method} is not allowed for security reasons` }
  }

  let target: unknown = chrome
  for (let index = 0; index < parts.length - 1; index += 1) {
    target = (target as Record<string, unknown> | undefined)?.[parts[index]]
    if (!target) {
      return { error: `chrome.${parts.slice(0, index + 1).join(".")} is undefined` }
    }
  }

  const fnName = parts[parts.length - 1]
  const fn = (target as Record<string, unknown> | undefined)?.[fnName]
  if (typeof fn !== "function") {
    return { error: `chrome.${method} is not a function` }
  }

  const normalizedArgs = [...args]
  try {
    if (namespace === "tabs" && fnName === "create") {
      if (normalizedArgs.length === 1 && typeof normalizedArgs[0] === "string") {
        normalizedArgs[0] = { url: ensureHttpUrl(normalizedArgs[0]) }
      } else if (
        normalizedArgs.length === 1
        && normalizedArgs[0]
        && typeof normalizedArgs[0] === "object"
        && typeof (normalizedArgs[0] as { url?: unknown }).url === "string"
      ) {
        normalizedArgs[0] = {
          ...(normalizedArgs[0] as Record<string, unknown>),
          url: ensureHttpUrl((normalizedArgs[0] as { url: string }).url),
        }
      }
    }

    if (namespace === "tabs" && fnName === "query" && normalizedArgs.length === 0) {
      normalizedArgs.push({})
    }

    if (namespace === "bookmarks" && fnName === "search" && typeof normalizedArgs[0] === "string") {
      normalizedArgs[0] = { query: normalizedArgs[0] }
    }

    if (namespace === "history" && fnName === "search" && typeof normalizedArgs[0] === "string") {
      normalizedArgs[0] = { text: normalizedArgs[0] }
    }
  } catch {}

  return new Promise((resolve) => {
    try {
      const callback = (result: unknown) => {
        const lastError = chrome.runtime.lastError
        if (lastError) {
          resolve({ error: lastError.message })
          return
        }
        resolve({ result })
      }

      ;(fn as (...callArgs: unknown[]) => void).apply(target, [...normalizedArgs, callback])
    } catch (error) {
      resolve({ error: error instanceof Error ? error.message : String(error) })
    }
  })
}
