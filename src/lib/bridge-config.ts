import type { BridgeRuntimeConfig } from "./types/bridge-control"

export const BRIDGE_CONFIG_STORAGE_KEY = "agnx-bridge-config"
const DEFAULT_ENABLED = (import.meta.env.VITE_AGNX_BRIDGE_ENABLED
  ?? import.meta.env.VITE_WEBEXT_BRIDGE_ENABLED
  ?? "0") === "1"
const DEFAULT_PORT = resolveDefaultPort()

/** 与文档 / Skill 默认端口一致 */
export const AGNX_BRIDGE_DEFAULT_PORT = 3054

function resolveDefaultPort(): number {
  const fallback = AGNX_BRIDGE_DEFAULT_PORT
  const raw = import.meta.env.VITE_BACKEND_URL
  if (!raw) return fallback

  try {
    const url = new URL(raw)
    if (url.port) {
      return normalizeBridgePort(Number.parseInt(url.port, 10), fallback)
    }
  } catch {}

  return fallback
}

export function getDefaultBridgeConfig(): BridgeRuntimeConfig {
  return {
    enabled: DEFAULT_ENABLED,
    port: DEFAULT_PORT,
  }
}

export function normalizeBridgePort(input: unknown, fallback = DEFAULT_PORT): number {
  if (typeof input === "number" && Number.isFinite(input)) {
    const normalized = Math.floor(input)
    if (normalized >= 1 && normalized <= 65535) return normalized
  }

  if (typeof input === "string" && input.trim()) {
    const parsed = Number.parseInt(input.trim(), 10)
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
      return parsed
    }
  }

  return fallback
}

export function normalizeBridgeRuntimeConfig(
  input: Partial<BridgeRuntimeConfig> | null | undefined,
  fallback = getDefaultBridgeConfig(),
): BridgeRuntimeConfig {
  return {
    enabled: typeof input?.enabled === "boolean" ? input.enabled : fallback.enabled,
    port: normalizeBridgePort(input?.port, fallback.port),
  }
}

export function getBridgeBackendBaseUrl(config: BridgeRuntimeConfig): string {
  return `http://localhost:${config.port}`
}

export async function readBridgeRuntimeConfig(): Promise<BridgeRuntimeConfig> {
  const fallback = getDefaultBridgeConfig()

  try {
    const raw = await chrome.storage.local.get(BRIDGE_CONFIG_STORAGE_KEY)
    const value = raw?.[BRIDGE_CONFIG_STORAGE_KEY]
    if (!value || typeof value !== "object") return fallback
    return normalizeBridgeRuntimeConfig(value as Partial<BridgeRuntimeConfig>, fallback)
  } catch {
    return fallback
  }
}

export async function writeBridgeRuntimeConfig(config: BridgeRuntimeConfig): Promise<void> {
  await chrome.storage.local.set({
    [BRIDGE_CONFIG_STORAGE_KEY]: normalizeBridgeRuntimeConfig(config),
  })
}
