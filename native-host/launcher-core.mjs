import { appendFileSync, existsSync, openSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, "..")

const outputDir = resolve(projectRoot, ".output")
const stateFile = resolve(outputDir, "native-host-state.json")
const serverEntry = resolve(projectRoot, "server/index.mjs")
const nativeHostLogFile = resolve(outputDir, "native-host.log")
const serverStdoutLogFile = resolve(outputDir, "bridge-server.stdout.log")
const serverStderrLogFile = resolve(outputDir, "bridge-server.stderr.log")

function logLauncher(event, data) {
  try {
    appendFileSync(
      nativeHostLogFile,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        pid: process.pid,
        event,
        data,
      })}\n`,
      "utf8",
    )
  } catch {}
}

function normalizePort(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.floor(value)
    if (normalized >= 1 && normalized <= 65535) return normalized
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
      return parsed
    }
  }
  throw new Error("port 必须是 1 到 65535 之间的整数")
}

async function readState() {
  if (!existsSync(stateFile)) return null
  try {
    return JSON.parse(await readFile(stateFile, "utf8"))
  } catch {
    return null
  }
}

async function writeState(state) {
  await mkdir(outputDir, { recursive: true })
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8")
}

async function clearState() {
  await rm(stateFile, { force: true })
}

function isPidRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForExit(pid, timeoutMs = 4000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (!isPidRunning(pid)) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
}

async function stopPid(pid) {
  if (!pid || !isPidRunning(pid)) return
  try {
    process.kill(pid, "SIGTERM")
  } catch {}
  await waitForExit(pid)
  if (isPidRunning(pid)) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {}
  }
}

async function probeServer(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  const url = `http://localhost:${port}/api/agnx-bridge/health`

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return {
          port,
          baseUrl: `http://localhost:${port}`,
        }
      }
    } catch {}

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
  }

  throw new Error(`bridge server 未能在端口 ${port} 上及时启动`)
}

export async function getServerStatus() {
  const state = await readState()
  if (!state?.pid || !state?.port) {
    return {
      running: false,
    }
  }

  if (!isPidRunning(state.pid)) {
    await clearState()
    return {
      running: false,
    }
  }

  return {
    running: true,
    pid: state.pid,
    port: state.port,
    baseUrl: `http://localhost:${state.port}`,
  }
}

export async function ensureServer(portInput) {
  const port = normalizePort(portInput)
  const current = await getServerStatus()
  logLauncher("ensure_server", { requestedPort: port, current })

  if (current.running && current.port === port) {
    return {
      success: true,
      ...current,
    }
  }

  if (current.running && current.pid) {
    await stopPid(current.pid)
    await clearState()
  }

  await mkdir(outputDir, { recursive: true })
  const child = spawn(process.execPath, [serverEntry], {
    cwd: projectRoot,
    detached: true,
    windowsHide: true,
    stdio: [
      "ignore",
      openSync(serverStdoutLogFile, "a"),
      openSync(serverStderrLogFile, "a"),
    ],
    env: {
      ...process.env,
      BRIDGE_PORT: String(port),
      BRIDGE_DISCOVERY_PORT: "0",
    },
  })

  child.unref()
  logLauncher("spawn_server", {
    port,
    pid: child.pid,
    serverEntry,
  })
  await writeState({
    pid: child.pid,
    port,
    updatedAt: Date.now(),
  })

  try {
    const result = await probeServer(port)
    logLauncher("probe_server_ok", result)
    await writeState({
      pid: child.pid,
      port,
      updatedAt: Date.now(),
    })
    return {
      success: true,
      pid: child.pid,
      ...result,
    }
  } catch (error) {
    logLauncher("probe_server_failed", error instanceof Error ? {
      message: error.message,
      stack: error.stack,
    } : String(error))
    if (child.pid) {
      await stopPid(child.pid)
    }
    await clearState()
    throw error
  }
}

export async function stopServer() {
  const current = await getServerStatus()
  if (current.running && current.pid) {
    await stopPid(current.pid)
  }
  await clearState()
  return {
    success: true,
  }
}
