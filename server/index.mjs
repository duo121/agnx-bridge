#!/usr/bin/env node

import http from "node:http"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { createBridgeProtocol } from "./bridge-protocol.mjs"
import { createBridgeHttpServer } from "./http-server.mjs"

function parsePort(value, fallback, { allowZero = false } = {}) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.floor(value)
    if (allowZero && normalized === 0) return 0
    if (normalized >= 1 && normalized <= 65535) return normalized
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10)
    if (allowZero && parsed === 0) return 0
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
      return parsed
    }
  }

  return fallback
}

function trimEnvString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getBoundPort(server) {
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("无法读取 server 监听端口")
  }
  return address.port
}

function setJsonHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*")
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Agnx-Bridge-Token, X-Webext-Bridge-Token")
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
  response.setHeader("Content-Type", "application/json; charset=utf-8")
}

function createDiscoveryServer(discoveryProvider) {
  return http.createServer((request, response) => {
    if (!request.url || !request.method) {
      setJsonHeaders(response)
      response.statusCode = 400
      response.end(JSON.stringify({ success: false, error: "无效请求" }))
      return
    }

    if (request.method === "OPTIONS") {
      setJsonHeaders(response)
      response.statusCode = 204
      response.end()
      return
    }

    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`)
    const isDiscovery =
      url.pathname === "/api/agnx-bridge/discovery"
      || url.pathname === "/api/webext-bridge/discovery"
    if (request.method !== "GET" || !isDiscovery) {
      setJsonHeaders(response)
      response.statusCode = 404
      response.end(JSON.stringify({ success: false, error: "路由不存在" }))
      return
    }

    setJsonHeaders(response)
    response.statusCode = 200
    response.end(JSON.stringify({
      success: true,
      data: discoveryProvider(),
    }))
  })
}

function closeServer(server) {
  if (!server) return Promise.resolve()

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

const requestedMainPort = parsePort(process.env.BRIDGE_PORT ?? process.env.PORT, 3002)
const requestedDiscoveryPort = parsePort(process.env.BRIDGE_DISCOVERY_PORT, 0, { allowZero: true })
const discoveryFile = trimEnvString(process.env.BRIDGE_DISCOVERY_FILE)
  || path.resolve(process.cwd(), ".output/bridge-discovery.json")
const host = trimEnvString(process.env.BRIDGE_HOST)
const protocol = createBridgeProtocol()

let mainPort = requestedMainPort
let discoveryPort = requestedDiscoveryPort
let mainBaseUrl = ""
let discoveryUrl = ""
let discoveryServer = null
let shuttingDown = false

function buildDiscoveryPayload() {
  return {
    mode: "manual",
    port: mainPort,
    baseUrl: mainBaseUrl,
    discoveryPort,
    discoveryUrl,
    pid: process.pid,
    updatedAt: Date.now(),
  }
}

async function writeDiscoverySnapshot() {
  if (discoveryPort === 0) return
  const payload = buildDiscoveryPayload()
  await mkdir(path.dirname(discoveryFile), { recursive: true })
  await writeFile(discoveryFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const mainServer = createBridgeHttpServer({
  protocol,
  discoveryProvider: discoveryPort === 0 ? undefined : buildDiscoveryPayload,
})

async function ensureDiscoveryServer() {
  if (discoveryPort === 0) {
    discoveryUrl = ""
    return
  }

  discoveryUrl = `http://localhost:${discoveryPort}/api/agnx-bridge/discovery`
  if (mainPort === discoveryPort) {
    return
  }

  discoveryServer = createDiscoveryServer(buildDiscoveryPayload)
  await new Promise((resolve, reject) => {
    discoveryServer.once("error", reject)
    discoveryServer.listen(discoveryPort, host, () => {
      discoveryServer?.off("error", reject)
      resolve()
    })
  })
}

async function boot() {
  await new Promise((resolve, reject) => {
    mainServer.once("error", reject)
    mainServer.listen(requestedMainPort, host, () => {
      mainServer.off("error", reject)
      resolve()
    })
  })

  mainPort = getBoundPort(mainServer)
  mainBaseUrl = `http://localhost:${mainPort}`

  if (mainPort === requestedDiscoveryPort) {
    discoveryPort = mainPort
  }

  await ensureDiscoveryServer()
  await writeDiscoverySnapshot()

  console.log("[agnx-bridge-server] ready")
  console.log(`[agnx-bridge-server] base: ${mainBaseUrl}/api/agnx-bridge`)
  if (discoveryUrl) {
    console.log(`[agnx-bridge-server] discovery: ${discoveryUrl}`)
  }
}

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`[agnx-bridge-server] received ${signal}, shutting down`)
  await Promise.allSettled([
    closeServer(discoveryServer),
    closeServer(mainServer),
  ])
  process.exit(0)
}

process.on("SIGINT", () => {
  void shutdown("SIGINT")
})

process.on("SIGTERM", () => {
  void shutdown("SIGTERM")
})

boot().catch((error) => {
  console.error("[agnx-bridge-server] failed to start", error)
  process.exit(1)
})
