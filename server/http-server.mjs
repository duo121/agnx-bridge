import http from "node:http"
import { parseBridgeCommand, readBridgeAuthToken } from "./bridge-protocol.mjs"

function setCommonHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*")
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Agnx-Bridge-Token",
  )
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  response.setHeader("Content-Type", "application/json; charset=utf-8")
}

function sendJson(response, status, payload) {
  setCommonHeaders(response)
  response.statusCode = status
  response.end(JSON.stringify(payload))
}

async function readJsonBody(request) {
  let raw = ""

  for await (const chunk of request) {
    raw += chunk
  }

  if (!raw.trim()) return {}

  try {
    return JSON.parse(raw)
  } catch {
    throw new Error("请求体 JSON 非法")
  }
}

function createRequestUrl(request) {
  const host = request.headers.host || "localhost"
  return new URL(request.url || "/", `http://${host}`)
}

function resolveErrorStatus(message, fallback = 400) {
  if (
    message.includes("token")
    || message.includes("缺少 bridge token")
  ) {
    return 401
  }
  if (message.includes("不存在")) {
    return 404
  }
  return fallback
}

export function createBridgeHttpServer({
  protocol,
  logger = console,
  discoveryProvider,
} = {}) {
  return http.createServer(async (request, response) => {
    if (!request.url || !request.method) {
      sendJson(response, 400, { success: false, error: "无效请求" })
      return
    }

    if (request.method === "OPTIONS") {
      setCommonHeaders(response)
      response.statusCode = 204
      response.end()
      return
    }

    const url = createRequestUrl(request)
    const pathname = url.pathname

    try {
      if (request.method === "GET" && pathname === "/api/agnx-bridge/discovery") {
        if (!discoveryProvider) {
          sendJson(response, 404, { success: false, error: "discovery 未启用" })
          return
        }

        sendJson(response, 200, {
          success: true,
          data: discoveryProvider(),
        })
        return
      }

      if (request.method === "GET" && pathname === "/api/agnx-bridge/health") {
        sendJson(response, 200, {
          success: true,
          data: protocol.getHealth(),
        })
        return
      }

      if (request.method === "POST" && pathname === "/api/agnx-bridge/register") {
        const body = await readJsonBody(request)
        const registration = protocol.registerClient({
          clientId: typeof body.clientId === "string" ? body.clientId : undefined,
          name: typeof body.name === "string" ? body.name : undefined,
          version: typeof body.version === "string" ? body.version : undefined,
          extensionId: typeof body.extensionId === "string" ? body.extensionId : undefined,
          userAgent: typeof request.headers["user-agent"] === "string"
            ? request.headers["user-agent"]
            : undefined,
        })

        sendJson(response, 200, {
          success: true,
          data: registration,
        })
        return
      }

      if (request.method === "GET" && pathname === "/api/agnx-bridge/pull") {
        const clientId = (url.searchParams.get("clientId") || "").trim()
        if (!clientId) {
          sendJson(response, 400, { success: false, error: "clientId 不能为空" })
          return
        }

        protocol.authenticateClient(clientId, readBridgeAuthToken(request.headers))
        const command = await protocol.pullCommand(clientId, url.searchParams.get("waitMs"))

        sendJson(response, 200, {
          success: true,
          data: {
            command: command
              ? {
                  execId: command.execId,
                  command: command.command,
                  createdAt: command.createdAt,
                  view: protocol.toExecView(command),
                }
              : null,
          },
        })
        return
      }

      if (request.method === "POST" && pathname === "/api/agnx-bridge/result") {
        const body = await readJsonBody(request)
        const clientId = typeof body.clientId === "string" ? body.clientId.trim() : ""
        const execId = typeof body.execId === "string" ? body.execId.trim() : ""

        if (!clientId) {
          sendJson(response, 400, { success: false, error: "clientId 不能为空" })
          return
        }
        if (!execId) {
          sendJson(response, 400, { success: false, error: "execId 不能为空" })
          return
        }

        protocol.authenticateClient(clientId, readBridgeAuthToken(request.headers))
        const updated = protocol.submitExecResult({
          clientId,
          execId,
          success: body.success === true,
          result: body.result,
          error: typeof body.error === "string" ? body.error : undefined,
        })

        sendJson(response, 200, {
          success: true,
          data: {
            exec: protocol.toExecView(updated),
          },
        })
        return
      }

      if (request.method === "POST" && pathname === "/api/agnx-bridge/exec") {
        const body = await readJsonBody(request)
        const source = typeof body.source === "string" ? body.source : "api"
        const clientId = typeof body.clientId === "string" ? body.clientId : undefined
        const commandInput = body.command && typeof body.command === "object"
          ? body.command
          : body
        const command = parseBridgeCommand(commandInput)

        const queued = protocol.enqueueExec({
          clientId,
          command,
          source,
        })
        const finalRecord = await protocol.waitForExec(queued.execId, body.waitMs)

        sendJson(response, 200, {
          success: true,
          data: {
            exec: protocol.toExecView(finalRecord),
          },
        })
        return
      }

      const execMatch = pathname.match(/^\/api\/agnx-bridge\/exec\/([^/]+)$/)
      if (request.method === "GET" && execMatch) {
        const record = protocol.getExec(decodeURIComponent(execMatch[1]))
        if (!record) {
          sendJson(response, 404, { success: false, error: "execId 不存在" })
          return
        }

        sendJson(response, 200, {
          success: true,
          data: {
            exec: protocol.toExecView(record),
          },
        })
        return
      }

      sendJson(response, 404, { success: false, error: "路由不存在" })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error?.("[agnx-bridge-server]", message)
      sendJson(response, resolveErrorStatus(message), {
        success: false,
        error: message,
      })
    }
  })
}
