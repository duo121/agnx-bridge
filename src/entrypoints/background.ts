import { defineBackground } from "wxt/utils/define-background"
import { createBridgeCommandExecutor } from "../lib/background/bridge/command-executor"
import { createWebextBridgePollingController } from "../lib/background/bridge/polling"
import { createConsoleCaptureRuntime } from "../lib/background/console-capture/runtime"
import { registerBridgeControlMessageRouter } from "../lib/background/control-router"
import { executeChromeApi, summarizeValueForLog } from "../lib/background/executors/chrome-api"
import { executePageAgent } from "../lib/background/executors/page-agent"
import { createBackgroundLogging } from "../lib/background/logging"

export default defineBackground(() => {
  const { originalConsole, backgroundLog, backgroundError } = createBackgroundLogging()
  const consoleCaptureRuntime = createConsoleCaptureRuntime({
    backgroundLog,
    backgroundError,
    originalConsole,
  })

  consoleCaptureRuntime.installExtensionConsoleCapture()

  const executeBridgeCommand = createBridgeCommandExecutor({
    executeChromeApi,
    executePageAgent,
    resolveConsoleCaptureTarget: consoleCaptureRuntime.resolveConsoleCaptureTarget,
    executeConsoleCaptureAction: consoleCaptureRuntime.executeConsoleCaptureAction,
  })
  const bridgeController = createWebextBridgePollingController({
    executeCommand: executeBridgeCommand,
    log: backgroundLog,
    warn: originalConsole.warn,
  })

  chrome.debugger.onEvent.addListener(consoleCaptureRuntime.handleDebuggerEvent)
  chrome.debugger.onDetach.addListener(consoleCaptureRuntime.handleDebuggerDetach)
  chrome.tabs.onRemoved.addListener(consoleCaptureRuntime.handleTabRemoved)

  registerBridgeControlMessageRouter({
    controller: bridgeController,
    log: backgroundLog,
  })

  void bridgeController.ensureInitialized().catch((error) => {
    originalConsole.warn("[Bridge] Failed to initialize polling controller", error)
  })

  backgroundLog("[Background] AGNX Bridge started", summarizeValueForLog({
    version: chrome.runtime.getManifest().version,
    extensionId: chrome.runtime.id,
  }))
})
