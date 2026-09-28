import type {
  BridgeCommandResult,
} from "../../types/bridge"
import type {
  ConsoleCaptureAction,
  ConsoleCaptureFilter,
  ConsoleCaptureTarget,
} from "../../types/console-capture"

type ConsoleCaptureResult = { result?: unknown; error?: string }

interface CreateBridgeCommandExecutorOptions {
  executeChromeApi: (method: string, args: unknown[]) => Promise<{ result?: unknown; error?: string }>
  executePageAgent: (
    code: string,
    options: {
      tabId?: number
      args?: unknown[]
      timeout?: number
    },
  ) => Promise<{ result?: unknown; error?: string }>
  resolveConsoleCaptureTarget: (value: unknown) => ConsoleCaptureTarget | undefined
  executeConsoleCaptureAction: (
    target: ConsoleCaptureTarget,
    action: ConsoleCaptureAction,
    tabId?: number,
    filter?: ConsoleCaptureFilter,
  ) => Promise<ConsoleCaptureResult>
}

export function createBridgeCommandExecutor(options: CreateBridgeCommandExecutorOptions) {
  return async function executeBridgeCommand(
    command: Record<string, unknown>,
  ): Promise<BridgeCommandResult> {
    const kindRaw = typeof command.kind === "string" ? command.kind : ""
    const kind = kindRaw || (typeof command.method === "string"
      ? "browser-agent"
      : (typeof command.code === "string"
        ? "page-agent"
        : (typeof command.action === "string" ? "console-capture" : ""))
    )

    if (kind === "browser-agent") {
      const method = typeof command.method === "string" ? command.method : ""
      const args = Array.isArray(command.args) ? command.args : []
      if (!method) {
        return { success: false, error: "bridge browser-agent method is required" }
      }

      const response = await options.executeChromeApi(method, args)
      if (response.error) return { success: false, error: response.error }
      return { success: true, result: response.result }
    }

    if (kind === "page-agent") {
      const code = typeof command.code === "string" ? command.code : ""
      const tabId = typeof command.tabId === "number" ? Math.floor(command.tabId) : undefined
      const args = Array.isArray(command.args) ? command.args : []
      const timeout = typeof command.timeout === "number" ? Math.floor(command.timeout) : undefined

      if (!code) {
        return { success: false, error: "bridge page-agent code is required" }
      }

      const response = await options.executePageAgent(code, { tabId, args, timeout })
      if (response.error) return { success: false, error: response.error }
      return { success: true, result: response.result }
    }

    if (kind === "console-capture") {
      const action = typeof command.action === "string"
        ? command.action as ConsoleCaptureAction
        : undefined
      if (!action) {
        return { success: false, error: "bridge console-capture action is required" }
      }

      const target = options.resolveConsoleCaptureTarget(command.target)
      if (!target) {
        return { success: false, error: "bridge console-capture target must be page or extension" }
      }

      const tabId = typeof command.tabId === "number" ? Math.floor(command.tabId) : undefined
      const filter = (
        command.filter && typeof command.filter === "object" && !Array.isArray(command.filter)
          ? command.filter as ConsoleCaptureFilter
          : undefined
      )

      const response = await options.executeConsoleCaptureAction(target, action, tabId, filter)
      if (response.error) return { success: false, error: response.error }
      return { success: true, result: response.result }
    }

    return { success: false, error: "Unknown bridge command kind" }
  }
}
