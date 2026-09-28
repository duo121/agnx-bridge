interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string
  readonly VITE_BRIDGE_DISCOVERY_PORT?: string
  readonly VITE_AGNX_BRIDGE_ENABLED?: string
  /** @deprecated 使用 VITE_AGNX_BRIDGE_ENABLED */
  readonly VITE_WEBEXT_BRIDGE_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
