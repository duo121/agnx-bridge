import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { generateKeyPairSync } from "node:crypto"
import { spawn } from "node:child_process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, "..")
const packageJsonPath = join(projectRoot, "package.json")
const outputDir = join(projectRoot, ".output")
const extensionDir = join(outputDir, "chrome-mv3")
const keysDir = join(projectRoot, ".keys")
const keyPath = join(keysDir, "extension-private-key.pem")

function fail(message) {
  console.error(`[crx] ${message}`)
  process.exit(1)
}

function ensureExtensionBuilt() {
  if (!existsSync(extensionDir)) {
    fail("找不到 .output/chrome-mv3，请先执行 pnpm build")
  }
}

function ensurePrivateKey() {
  if (existsSync(keyPath)) {
    return keyPath
  }

  mkdirSync(keysDir, { recursive: true })
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  })

  const pem = privateKey.export({
    type: "pkcs8",
    format: "pem",
  })

  writeFileSync(keyPath, pem)
  console.log(`[crx] 已生成稳定私钥: ${keyPath}`)
  return keyPath
}

function getChromeCandidates() {
  const envPath = process.env.CHROME_PATH
  const candidates = []

  if (envPath) {
    candidates.push(envPath)
  }

  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    )
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || ""
    const programFiles = process.env.ProgramFiles || "C:\\Program Files"
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)"
    candidates.push(
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${localAppData}\\Microsoft\\Edge\\Application\\msedge.exe`,
    )
  }

  if (process.platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
    )
  }

  return candidates
}

function resolveChromeBinary() {
  const binary = getChromeCandidates().find((candidate) => candidate && existsSync(candidate))
  if (!binary) {
    fail("未找到可用的 Chrome/Edge 可执行文件。可通过 CHROME_PATH 指定路径。")
  }
  return binary
}

function runChromePack(chromeBinary, privateKeyPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      chromeBinary,
      [
        `--pack-extension=${extensionDir}`,
        `--pack-extension-key=${privateKeyPath}`,
      ],
      {
        cwd: projectRoot,
        stdio: "inherit",
      },
    )

    child.on("error", rejectPromise)
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      rejectPromise(new Error(`Chrome 打包失败，退出码 ${code ?? "unknown"}`))
    })
  })
}

function moveCrxArtifact(packageName, version) {
  const generatedCrx = join(outputDir, "chrome-mv3.crx")
  const targetCrx = join(outputDir, `${packageName}-${version}.crx`)

  if (!existsSync(generatedCrx)) {
    fail("Chrome 打包结束后未生成 .output/chrome-mv3.crx")
  }

  rmSync(targetCrx, { force: true })
  renameSync(generatedCrx, targetCrx)
  return targetCrx
}

async function main() {
  ensureExtensionBuilt()
  const rawPackageJson = await readFile(packageJsonPath, "utf8")
  const packageJson = JSON.parse(rawPackageJson)
  const chromeBinary = resolveChromeBinary()
  const privateKeyPath = ensurePrivateKey()

  console.log(`[crx] 使用浏览器: ${chromeBinary}`)
  await runChromePack(chromeBinary, privateKeyPath)

  const crxPath = moveCrxArtifact(packageJson.name, packageJson.version)
  console.log(`[crx] 已生成 CRX: ${crxPath}`)
  console.log(`[crx] 已保留稳定私钥: ${privateKeyPath}`)
}

await main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
