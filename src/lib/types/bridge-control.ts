export interface BridgeRuntimeConfig {
  enabled: boolean
  port: number
}

export interface BridgeCommandHistoryEntry {
  id: string
  execId: string
  clientId: string
  backendUrl: string
  command: Record<string, unknown>
  receivedAt: number
  completedAt: number
  success: boolean
  error?: string
}

export interface BridgeRuntimeSnapshot {
  config: BridgeRuntimeConfig
  status: {
    running: boolean
    inFlight: boolean
    backendUrl: string
    clientId?: string
    leaseExpiresAt?: number
    lastError?: string
    failureCount: number
    updatedAt: number
  }
}

export interface BridgeControlGetStateMessage {
  type: "BRIDGE_CONTROL_GET_STATE"
}

export interface BridgeControlSetConfigMessage {
  type: "BRIDGE_CONTROL_SET_CONFIG"
  config: BridgeRuntimeConfig
}

export interface BridgeControlGetHistoryMessage {
  type: "BRIDGE_CONTROL_GET_HISTORY"
  limit?: number
}

export interface BridgeControlClearHistoryMessage {
  type: "BRIDGE_CONTROL_CLEAR_HISTORY"
}

export type BridgeControlMessage =
  | BridgeControlGetStateMessage
  | BridgeControlSetConfigMessage
  | BridgeControlGetHistoryMessage
  | BridgeControlClearHistoryMessage

export interface BridgeControlResponse {
  success: boolean
  snapshot?: BridgeRuntimeSnapshot
  history?: BridgeCommandHistoryEntry[]
  error?: string
}
