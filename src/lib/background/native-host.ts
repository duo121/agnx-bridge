const BRIDGE_NATIVE_HOST_NAME = "com.agnx.bridge"
const NATIVE_HOST_REQUEST_TIMEOUT_MS = 15_000
const NATIVE_HOST_RECONNECT_DELAY_MS = 1_000

interface EnsureServerRequest {
  type: "ensure_server"
  port: number
}

interface StopServerRequest {
  type: "stop_server"
}

interface GetStatusRequest {
  type: "get_status"
}

interface PingRequest {
  type: "ping"
}

type BridgeNativeHostRequest =
  | EnsureServerRequest
  | StopServerRequest
  | GetStatusRequest
  | PingRequest

interface BridgeNativeHostResponse {
  success: boolean
  requestId?: string
  port?: number
  pid?: number
  baseUrl?: string
  running?: boolean
  pong?: boolean
  error?: string
}

interface PendingNativeHostRequest {
  reject: (error: Error) => void
  resolve: (response: BridgeNativeHostResponse) => void
  timeoutId: ReturnType<typeof setTimeout>
}

interface SendNativeHostRequestOptions {
  keepAlive?: boolean
  timeoutMs?: number
}

interface NativeHostPortListeners {
  onDisconnect: () => void
  onMessage: (message: unknown) => void
}

let nativeHostPort: chrome.runtime.Port | null = null
let nativeHostConnectPromise: Promise<chrome.runtime.Port> | null = null
let nativeHostReconnectTimer: ReturnType<typeof setTimeout> | null = null
let nativeHostPendingRequests = new Map<string, PendingNativeHostRequest>()
let nativeHostRequestSequence = 0
let nativeHostKeepAlive = false
let nativeHostDesiredPort: number | null = null

const nativeHostPortListeners = new WeakMap<chrome.runtime.Port, NativeHostPortListeners>()

function normalizeNativeHostError(message: string): string {
  if (message.includes("Specified native messaging host not found")) {
    return "本地宿主未安装，请先执行 native host 安装脚本。"
  }
  if (message.includes("Access to the specified native messaging host is forbidden")) {
    return "本地宿主已安装，但当前扩展 ID 未被授权，请重新安装 native host。"
  }
  return message
}

function nextNativeHostRequestId(): string {
  nativeHostRequestSequence += 1
  return `native-host-${Date.now()}-${nativeHostRequestSequence}`
}

function clearNativeHostReconnectTimer(): void {
  if (!nativeHostReconnectTimer) return
  clearTimeout(nativeHostReconnectTimer)
  nativeHostReconnectTimer = null
}

function rejectAllPendingNativeHostRequests(message: string): void {
  for (const pending of nativeHostPendingRequests.values()) {
    clearTimeout(pending.timeoutId)
    pending.reject(new Error(message))
  }
  nativeHostPendingRequests = new Map()
}

function resolveNativeHostRequest(
  requestId: string,
  handler: (pending: PendingNativeHostRequest) => void,
): void {
  const pending = nativeHostPendingRequests.get(requestId)
  if (!pending) return
  nativeHostPendingRequests.delete(requestId)
  clearTimeout(pending.timeoutId)
  handler(pending)
}

function cleanupNativeHostPort(port: chrome.runtime.Port): void {
  const listeners = nativeHostPortListeners.get(port)
  if (listeners) {
    port.onMessage.removeListener(listeners.onMessage)
    port.onDisconnect.removeListener(listeners.onDisconnect)
    nativeHostPortListeners.delete(port)
  }

  if (nativeHostPort === port) {
    nativeHostPort = null
  }
}

function disconnectNativeHostPort(): void {
  clearNativeHostReconnectTimer()
  const port = nativeHostPort
  nativeHostConnectPromise = null
  if (!port) return

  cleanupNativeHostPort(port)
  try {
    port.disconnect()
  } catch {}
}

function maybeReleaseNativeHostPort(): void {
  if (nativeHostKeepAlive) return
  if (nativeHostPendingRequests.size > 0) return
  disconnectNativeHostPort()
}

async function reconnectNativeHostPort(): Promise<void> {
  if (!nativeHostKeepAlive || nativeHostDesiredPort === null) return

  await connectNativeHostPort()
  await sendNativeHostRequest(
    {
      type: "ensure_server",
      port: nativeHostDesiredPort,
    },
    {
      keepAlive: true,
      timeoutMs: 8_000,
    },
  )
}

function scheduleNativeHostReconnect(): void {
  if (!nativeHostKeepAlive || nativeHostReconnectTimer) return

  nativeHostReconnectTimer = setTimeout(() => {
    nativeHostReconnectTimer = null
    void reconnectNativeHostPort().catch(() => {
      scheduleNativeHostReconnect()
    })
  }, NATIVE_HOST_RECONNECT_DELAY_MS)
}

function handleNativeHostPortMessage(
  port: chrome.runtime.Port,
  message: unknown,
): void {
  if (port !== nativeHostPort) return

  const response = (message ?? {}) as Partial<BridgeNativeHostResponse>
  const requestId = typeof response.requestId === "string" ? response.requestId : ""
  if (!requestId) return

  resolveNativeHostRequest(requestId, (pending) => {
    if (!response.success) {
      pending.reject(new Error(normalizeNativeHostError(response.error || "本地宿主执行失败")))
      return
    }

    pending.resolve(response as BridgeNativeHostResponse)
  })
}

function handleNativeHostPortDisconnect(port: chrome.runtime.Port): void {
  const runtimeError = chrome.runtime.lastError
  const message = normalizeNativeHostError(
    runtimeError?.message || "native host 连接已断开",
  )

  cleanupNativeHostPort(port)
  nativeHostConnectPromise = null
  rejectAllPendingNativeHostRequests(message)

  if (!nativeHostKeepAlive) return

  void reconnectNativeHostPort().catch(() => {
    scheduleNativeHostReconnect()
  })
}

function attachNativeHostPort(port: chrome.runtime.Port): void {
  const listeners: NativeHostPortListeners = {
    onMessage: (message) => {
      handleNativeHostPortMessage(port, message)
    },
    onDisconnect: () => {
      handleNativeHostPortDisconnect(port)
    },
  }

  nativeHostPortListeners.set(port, listeners)
  port.onMessage.addListener(listeners.onMessage)
  port.onDisconnect.addListener(listeners.onDisconnect)
  nativeHostPort = port
}

async function connectNativeHostPort(): Promise<chrome.runtime.Port> {
  if (nativeHostPort) return nativeHostPort
  if (nativeHostConnectPromise) return nativeHostConnectPromise

  clearNativeHostReconnectTimer()

  const connectPromise = new Promise<chrome.runtime.Port>((resolve, reject) => {
    let port: chrome.runtime.Port

    try {
      port = chrome.runtime.connectNative(BRIDGE_NATIVE_HOST_NAME)
    } catch (error) {
      reject(
        new Error(
          normalizeNativeHostError(
            error instanceof Error ? error.message : String(error),
          ),
        ),
      )
      return
    }

    attachNativeHostPort(port)

    const handshakeId = nextNativeHostRequestId()
    const timeoutMessage = "native host 握手超时"
    const timeoutId = setTimeout(() => {
      resolveNativeHostRequest(handshakeId, (pending) => {
        pending.reject(new Error(timeoutMessage))
      })

      if (nativeHostPort === port) {
        disconnectNativeHostPort()
        rejectAllPendingNativeHostRequests(timeoutMessage)
        if (nativeHostKeepAlive) {
          scheduleNativeHostReconnect()
        }
      }
    }, NATIVE_HOST_REQUEST_TIMEOUT_MS)

    nativeHostPendingRequests.set(handshakeId, {
      timeoutId,
      reject: (error) => {
        if (nativeHostPort === port) {
          disconnectNativeHostPort()
          if (nativeHostKeepAlive) {
            scheduleNativeHostReconnect()
          }
        }
        reject(error)
      },
      resolve: (response) => {
        if (!response.pong) {
          if (nativeHostPort === port) {
            disconnectNativeHostPort()
            if (nativeHostKeepAlive) {
              scheduleNativeHostReconnect()
            }
          }
          reject(new Error("native host 握手失败"))
          return
        }

        resolve(port)
      },
    })

    try {
      port.postMessage({
        requestId: handshakeId,
        type: "ping",
      } satisfies PingRequest & { requestId: string })
    } catch (error) {
      resolveNativeHostRequest(handshakeId, (pending) => {
        pending.reject(
          new Error(
            normalizeNativeHostError(
              error instanceof Error ? error.message : String(error),
            ),
          ),
        )
      })
    }
  }).finally(() => {
    if (nativeHostConnectPromise === connectPromise) {
      nativeHostConnectPromise = null
    }
  })

  nativeHostConnectPromise = connectPromise
  return connectPromise
}

async function sendNativeHostRequest(
  payload: BridgeNativeHostRequest,
  options: SendNativeHostRequestOptions = {},
): Promise<BridgeNativeHostResponse> {
  if (options.keepAlive) {
    nativeHostKeepAlive = true
  }

  const port = await connectNativeHostPort()
  const requestId = nextNativeHostRequestId()
  const timeoutMs = options.timeoutMs ?? NATIVE_HOST_REQUEST_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    const timeoutMessage = "native host 请求超时"
    const timeoutId = setTimeout(() => {
      resolveNativeHostRequest(requestId, (pending) => {
        pending.reject(new Error(timeoutMessage))
      })

      if (nativeHostPort === port) {
        disconnectNativeHostPort()
        rejectAllPendingNativeHostRequests(timeoutMessage)
        if (nativeHostKeepAlive) {
          scheduleNativeHostReconnect()
        }
      }
    }, timeoutMs)

    nativeHostPendingRequests.set(requestId, {
      timeoutId,
      reject: (error) => {
        reject(error)
        maybeReleaseNativeHostPort()
      },
      resolve: (response) => {
        resolve(response)
        maybeReleaseNativeHostPort()
      },
    })

    try {
      port.postMessage({
        ...payload,
        requestId,
      })
    } catch (error) {
      resolveNativeHostRequest(requestId, (pending) => {
        pending.reject(
          new Error(
            normalizeNativeHostError(
              error instanceof Error ? error.message : String(error),
            ),
          ),
        )
      })
    }
  })
}

export async function ensureNativeBridgeServer(port: number): Promise<BridgeNativeHostResponse> {
  nativeHostDesiredPort = port
  nativeHostKeepAlive = true

  return sendNativeHostRequest(
    {
      type: "ensure_server",
      port,
    },
    { keepAlive: true },
  )
}

export async function stopNativeBridgeServer(): Promise<void> {
  nativeHostKeepAlive = false
  nativeHostDesiredPort = null
  clearNativeHostReconnectTimer()

  try {
    await sendNativeHostRequest(
      { type: "stop_server" },
      { timeoutMs: 8_000 },
    )
  } catch {}

  disconnectNativeHostPort()
}

export async function getNativeBridgeServerStatus(): Promise<BridgeNativeHostResponse> {
  return sendNativeHostRequest({ type: "get_status" }, { timeoutMs: 8_000 })
}
