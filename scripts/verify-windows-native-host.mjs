import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { ensureServer, stopServer } from "../native-host/launcher-core.mjs"

const runtimeRoot = resolve(
  process.env.LOCALAPPDATA || "",
  "AGNX",
  "agnx-bridge-native-host",
)

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) process.exitCode = 1
}

const reg = spawnSync(
  "reg",
  ["query", "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.agnx.bridge", "/ve"],
  { encoding: "utf8", windowsHide: true },
)
check("registry key", reg.status === 0, (reg.stdout || "").replace(/\s+/g, " ").trim())

const manifestPath = resolve(runtimeRoot, "com.agnx.bridge.json")
let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  check("manifest json", manifest.name === "com.agnx.bridge", manifestPath)
  check("launcher path in manifest", typeof manifest.path === "string" && manifest.path.endsWith(".cmd"), manifest.path)
} catch (error) {
  check("manifest json", false, error instanceof Error ? error.message : String(error))
}

const result = await ensureServer(3054)
check("ensureServer", Boolean(result?.success), JSON.stringify(result))

const health = await fetch("http://localhost:3054/api/agnx-bridge/health")
const body = await health.text()
check("GET /health", health.ok, body.slice(0, 200))

await stopServer()
check("stopServer", true)

if (process.exitCode) {
  process.exit(process.exitCode)
}
console.log("ALL CHECKS PASSED")
