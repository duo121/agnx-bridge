import type {
  BridgeControlMessage,
  BridgeControlResponse,
} from "../types/bridge-control"
import type { WebextBridgePollingController } from "./bridge/polling"

interface RegisterBridgeControlRouterOptions {
  controller: WebextBridgePollingController
  log?: (...args: unknown[]) => void
}

export function registerBridgeControlMessageRouter(
  options: RegisterBridgeControlRouterOptions,
): void {
  chrome.runtime.onMessage.addListener((message: BridgeControlMessage, _sender, sendResponse) => {
    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      return undefined
    }

    if (
      message.type !== "BRIDGE_CONTROL_GET_STATE"
      && message.type !== "BRIDGE_CONTROL_SET_CONFIG"
      && message.type !== "BRIDGE_CONTROL_GET_HISTORY"
      && message.type !== "BRIDGE_CONTROL_CLEAR_HISTORY"
    ) {
      return undefined
    }

    void (async () => {
      try {
        await options.controller.ensureInitialized()

        if (message.type === "BRIDGE_CONTROL_GET_STATE") {
          const response: BridgeControlResponse = {
            success: true,
            snapshot: options.controller.getSnapshot(),
          }
          sendResponse(response)
          return
        }

        if (message.type === "BRIDGE_CONTROL_GET_HISTORY") {
          sendResponse({
            success: true,
            history: options.controller.getHistory(message.limit),
          } satisfies BridgeControlResponse)
          return
        }

        if (message.type === "BRIDGE_CONTROL_CLEAR_HISTORY") {
          sendResponse({
            success: true,
            history: await options.controller.clearHistory(),
          } satisfies BridgeControlResponse)
          return
        }

        const snapshot = await options.controller.setConfig(message.config)
        options.log?.("[BridgeControl] Config updated", snapshot)
        sendResponse({
          success: true,
          snapshot,
        } satisfies BridgeControlResponse)
      } catch (error) {
        sendResponse({
          success: false,
          snapshot: options.controller.getSnapshot(),
          error: error instanceof Error ? error.message : String(error),
        } satisfies BridgeControlResponse)
      }
    })()

    return true
  })
}
