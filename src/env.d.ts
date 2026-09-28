interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string
  readonly VITE_BRIDGE_DISCOVERY_PORT?: string
  readonly VITE_AGNX_BRIDGE_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
