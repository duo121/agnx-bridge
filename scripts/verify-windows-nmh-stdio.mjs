import { spawn } from "node:child_process"
import { resolve } from "node:path"

const launcher = resolve(
  process.env.LOCALAPPDATA || "",
  "AGNX",
  "agnx-bridge-native-host",
  "native-host-launcher.cmd",
)

function encodeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8")
  const header = Buffer.alloc(4)
  header.writeUInt32LE(payload.length, 0)
  return Buffer.concat([header, payload])
}

function readOneMessage(buffer) {
  if (buffer.length < 4) return null
  const length = buffer.readUInt32LE(0)
  if (buffer.length < 4 + length) return null
  const json = buffer.subarray(4, 4 + length).toString("utf8")
  return {
    message: JSON.parse(json),
    rest: buffer.subarray(4 + length),
  }
}

const child = spawn(launcher, [], {
  windowsHide: true,
  stdio: ["pipe", "pipe", "pipe"],
  shell: true,
})

let stdout = Buffer.alloc(0)
let stderr = ""
let settled = false
const timeout = setTimeout(() => {
  console.error("FAIL  native-messaging handshake timeout")
  finish(1)
}, 15000)

function finish(code) {
  if (settled) return
  settled = true
  clearTimeout(timeout)
  try {
    child.stdin.end()
  } catch {}
  try {
    child.kill()
  } catch {}
  setTimeout(() => process.exit(code), 200)
}

child.stdout.on("data", (chunk) => {
  stdout = Buffer.concat([stdout, Buffer.from(chunk)])
  const parsed = readOneMessage(stdout)
  if (!parsed) return
  console.log("PASS  native-messaging via .cmd launcher")
  console.log(JSON.stringify(parsed.message))
  finish(parsed.message?.success ? 0 : 1)
})

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8")
})

child.on("error", (error) => {
  console.error("FAIL  spawn launcher", error.message)
  finish(1)
})

child.on("exit", (code) => {
  if (settled) return
  console.error("FAIL  launcher exited early", { code, stderr: stderr.slice(0, 500) })
  finish(1)
})

child.stdin.write(encodeMessage({
  type: "ensure_server",
  requestId: "win-verify-1",
  port: 3054,
}))
