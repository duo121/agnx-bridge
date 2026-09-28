interface PageAgentExecutionResponse {
  result?: unknown
  error?: string
  stack?: string
}

export async function resolveActiveTabId(): Promise<number | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab?.id
  } catch {
    return undefined
  }
}

export async function executePageAgent(
  code: string,
  options: {
    tabId?: number
    args?: unknown[]
    timeout?: number
  } = {},
): Promise<PageAgentExecutionResponse> {
  if (!code || typeof code !== "string") {
    return { error: "bridge page-agent code is required" }
  }

  const args = Array.isArray(options.args) ? options.args : []
  const timeout = typeof options.timeout === "number" && Number.isFinite(options.timeout)
    ? Math.max(0, Math.floor(options.timeout))
    : 30000

  let targetTabId = typeof options.tabId === "number" ? Math.floor(options.tabId) : undefined
  if (!targetTabId) {
    targetTabId = await resolveActiveTabId()
  }

  if (!targetTabId) {
    return { error: "No active tab found. Please specify a tabId or ensure a tab is active." }
  }

  try {
    const tab = await chrome.tabs.get(targetTabId)
    const url = tab.url || ""
    if (
      url.startsWith("chrome://")
      || url.startsWith("chrome-extension://")
      || url.startsWith("about:")
      || url.startsWith("edge://")
      || url.startsWith("brave://")
    ) {
      return { error: `Cannot execute scripts on ${url.split("/")[0]}// pages` }
    }
  } catch {
    return { error: `Tab ${targetTabId} not found or not accessible` }
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      world: "MAIN",
      func: async (userCode: string, userArgs: unknown[], timeoutMs: number) => {
        function serialize(value: unknown, depth = 0): unknown {
          if (depth > 5) return "[max depth]"
          if (value === null) return null
          if (value === undefined) return undefined
          if (typeof value === "function") return `[Function: ${value.name || "anonymous"}]`
          if (typeof value === "symbol") return value.toString()
          if (value instanceof Error) {
            return { _type: "Error", name: value.name, message: value.message, stack: value.stack }
          }
          if (value instanceof Date) {
            return { _type: "Date", value: value.toISOString() }
          }
          if (value instanceof RegExp) {
            return { _type: "RegExp", value: value.toString() }
          }
          if (value instanceof Element) {
            return {
              _type: "Element",
              tagName: value.tagName.toLowerCase(),
              id: value.id || undefined,
              className: value.className || undefined,
              textContent: value.textContent?.slice(0, 500),
              innerHTML: value.innerHTML?.slice(0, 1000),
              attributes: Array.from(value.attributes || []).reduce<Record<string, string>>((acc, attr) => {
                acc[attr.name] = attr.value
                return acc
              }, {}),
            }
          }
          if (value instanceof NodeList || value instanceof HTMLCollection) {
            return Array.from(value).slice(0, 100).map((item) => serialize(item, depth + 1))
          }
          if (Array.isArray(value)) {
            return value.slice(0, 100).map((item) => serialize(item, depth + 1))
          }
          if (typeof value === "object") {
            const result: Record<string, unknown> = {}
            for (const [key, entryValue] of Object.entries(value).slice(0, 100)) {
              try {
                result[key] = serialize(entryValue, depth + 1)
              } catch {
                result[key] = "[Unserializable]"
              }
            }
            return result
          }
          return value
        }

        let timeoutId: ReturnType<typeof setTimeout> | undefined

        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Script execution timed out after ${timeoutMs}ms`))
          }, timeoutMs)
        })

        const executionPromise = (async () => {
          try {
            const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
              ...fnArgs: string[]
            ) => (...invokeArgs: unknown[]) => Promise<unknown>
            const fn = new AsyncFunction("args", userCode)
            const result = await fn(userArgs)
            return { success: true, result: serialize(result) }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const stack = error instanceof Error ? error.stack : undefined
            return {
              success: false,
              error: message,
              stack,
            }
          }
        })()

        try {
          const result = await Promise.race([executionPromise, timeoutPromise]) as {
            success: boolean
            result?: unknown
            error?: string
            stack?: string
          }
          if (timeoutId) clearTimeout(timeoutId)
          return result
        } catch (error) {
          if (timeoutId) clearTimeout(timeoutId)
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      },
      args: [code, args, timeout],
    })

    const result = results[0]?.result as {
      success: boolean
      result?: unknown
      error?: string
      stack?: string
    } | undefined

    if (!result) {
      return { error: "Script execution returned no result" }
    }

    if (!result.success) {
      return {
        error: result.error || "Unknown error",
        stack: result.stack,
      }
    }

    return { result: result.result }
  } catch (error) {
    return {
      error: `Page agent execution failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
