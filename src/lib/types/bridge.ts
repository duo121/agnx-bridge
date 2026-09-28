import type {
  ConsoleCaptureAction,
  ConsoleCaptureFilter,
  ConsoleCaptureTarget,
} from "./console-capture"

export interface BridgeClientState {
  clientId: string
  token: string
  leaseExpiresAt: number
}

export interface BridgePullCommand {
  execId: string
  command: Record<string, unknown>
}

export interface BridgePullResponse {
  success?: boolean
  data?: {
    command?: BridgePullCommand | null
  }
  error?: string
}

export interface BridgeRegisterResponse {
  success?: boolean
  data?: {
    clientId?: string
    token?: string
    leaseExpiresAt?: number
    pullWaitMs?: number
    pollIntervalMs?: number
  }
  error?: string
}

export interface BridgeCommandResult {
  success: boolean
  result?: unknown
  error?: string
}

export interface BrowserAgentBridgeCommand {
  kind: "browser-agent"
  method: string
  args?: unknown[]
}

export interface PageAgentBridgeCommand {
  kind: "page-agent"
  code: string
  tabId?: number
  args?: unknown[]
  timeout?: number
}

export interface ConsoleCaptureBridgeCommand {
  kind: "console-capture"
  target: ConsoleCaptureTarget
  action: ConsoleCaptureAction
  tabId?: number
  filter?: ConsoleCaptureFilter
}

export type BridgeCommand =
  | BrowserAgentBridgeCommand
  | PageAgentBridgeCommand
  | ConsoleCaptureBridgeCommand
