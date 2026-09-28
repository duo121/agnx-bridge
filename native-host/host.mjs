import { appendFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  ensureServer,
  getServerStatus,
  stopServer,
} from "./launcher-core.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, "..")
const outputDir = resolve(projectRoot, ".output")
const nativeHostLogFile = resolve(outputDir, "native-host.log")
const MAX_MESSAGE_LENGTH = 10 * 1024 * 1024

let readBuffer = Buffer.alloc(0)
let processingQueue = Promise.resolve()
let exiting = false

function serializeError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    }
  }

  return {
    message: String(error),
  }
}

async function ensureOutputDir() {
  await mkdir(outputDir, { recursive: true })
}

function logNativeHost(event, data) {
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

function writeNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8")
  const header = Buffer.alloc(4)
  header.writeUInt32LE(payload.length, 0)
  process.stdout.write(header)
  process.stdout.write(payload)
}

async function handleMessage(message) {
  const requestId = typeof message?.requestId === "string" ? message.requestId : undefined
  const type = typeof message?.type === "string" ? message.type : ""

  try {
    if (type === "ping") {
      writeNativeMessage({
        success: true,
        requestId,
        pong: true,
      })
      return
    }

    if (type === "ensure_server") {
      const result = await ensureServer(message.port)
      writeNativeMessage({
        success: true,
        requestId,
        ...result,
      })
      return
    }

    if (type === "stop_server") {
      const result = await stopServer()
      writeNativeMessage({
        success: true,
        requestId,
        ...result,
      })
      return
    }

    if (type === "get_status") {
      const result = await getServerStatus()
      writeNativeMessage({
        success: true,
        requestId,
        ...result,
      })
      return
    }

    writeNativeMessage({
      success: false,
      requestId,
      error: `不支持的 native host 请求类型: ${type || "unknown"}`,
    })
  } catch (error) {
    logNativeHost("handle_message_failed", {
      requestId,
      type,
      error: serializeError(error),
    })

    writeNativeMessage({
      success: false,
      requestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function enqueueMessage(message) {
  processingQueue = processingQueue
    .then(() => handleMessage(message))
    .catch((error) => {
      logNativeHost("message_queue_failed", serializeError(error))
    })
}

function exitWhenQueueDrained(code = 0) {
  if (exiting) return
  exiting = true

  void processingQueue.finally(() => {
    process.exit(code)
  })
}

function consumeFrames() {
  while (readBuffer.length >= 4) {
    const messageLength = readBuffer.readUInt32LE(0)
    if (messageLength < 0 || messageLength > MAX_MESSAGE_LENGTH) {
      logNativeHost("invalid_message_length", { messageLength })
      exitWhenQueueDrained(1)
      return
    }

    if (readBuffer.length < 4 + messageLength) {
      return
    }

    const payloadBuffer = readBuffer.subarray(4, 4 + messageLength)
    readBuffer = readBuffer.subarray(4 + messageLength)

    try {
      const message = JSON.parse(payloadBuffer.toString("utf8"))
      logNativeHost("receive_message", {
        requestId: message?.requestId,
        type: message?.type,
      })
      enqueueMessage(message)
    } catch (error) {
      logNativeHost("parse_message_failed", {
        error: serializeError(error),
        payload: payloadBuffer.toString("utf8"),
      })
    }
  }
}

await ensureOutputDir()
logNativeHost("native_host_started", { argv: process.argv.slice(2) })

process.stdin.on("data", (chunk) => {
  readBuffer = Buffer.concat([readBuffer, Buffer.from(chunk)])
  consumeFrames()
})

process.stdin.on("end", () => {
  logNativeHost("stdin_end")
  exitWhenQueueDrained(0)
})

process.stdin.on("close", () => {
  logNativeHost("stdin_close")
  exitWhenQueueDrained(0)
})

process.stdin.on("error", (error) => {
  logNativeHost("stdin_error", serializeError(error))
  exitWhenQueueDrained(1)
})

process.on("uncaughtException", (error) => {
  logNativeHost("uncaught_exception", serializeError(error))
  exitWhenQueueDrained(1)
})

process.on("unhandledRejection", (error) => {
  logNativeHost("unhandled_rejection", serializeError(error))
  exitWhenQueueDrained(1)
})

process.stdin.resume()
