import { existsSync } from "node:fs"
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { getExtensionId, nativeHostName, projectRoot } from "./extension-identity.mjs"

const targetBrowser = (process.env.NATIVE_HOST_BROWSER || "chrome").trim().toLowerCase()
const nodeBinary = process.env.NATIVE_HOST_NODE || process.execPath
const isWindows = process.platform === "win32"

function resolveRuntimeRoot() {
  if (process.env.AGNX_BRIDGE_RUNTIME_ROOT?.trim()) {
    return resolve(process.env.AGNX_BRIDGE_RUNTIME_ROOT.trim())
  }
  if (isWindows) {
    const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
    return resolve(base, "AGNX", "agnx-bridge-native-host")
  }
  return resolve(homedir(), "Library/Application Support/AGNX/agnx-bridge-native-host")
}

const runtimeRoot = resolveRuntimeRoot()
const runtimeHostScriptPath = resolve(runtimeRoot, "native-host/host.mjs")
const runtimeLauncherScriptPath = resolve(
  runtimeRoot,
  isWindows ? "native-host-launcher.cmd" : "native-host-launcher.sh",
)
const runtimeManifestPath = resolve(runtimeRoot, `${nativeHostName}.json`)
const runtimeSourceFiles = [
  "native-host/host.mjs",
  "native-host/launcher-core.mjs",
  "server/index.mjs",
  "server/http-server.mjs",
  "server/bridge-store.mjs",
  "server/bridge-protocol.mjs",
]

/** @type {Record<string, Record<string, string>>} */
const manifestDirs = {
  darwin: {
    chrome: "Library/Application Support/Google/Chrome/NativeMessagingHosts",
    edge: "Library/Application Support/Microsoft Edge/NativeMessagingHosts",
    brave: "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts",
    chromium: "Library/Application Support/Chromium/NativeMessagingHosts",
  },
  linux: {
    chrome: ".config/google-chrome/NativeMessagingHosts",
    edge: ".config/microsoft-edge/NativeMessagingHosts",
    brave: ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts",
    chromium: ".config/chromium/NativeMessagingHosts",
  },
}

/** Windows：Chrome 读注册表指向 manifest，文件可放在 runtime 目录。 */
const windowsRegistryKeys = {
  chrome: `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${nativeHostName}`,
  edge: `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${nativeHostName}`,
  brave: `HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\${nativeHostName}`,
  chromium: `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${nativeHostName}`,
}

function resolveManifestDir(browser) {
  if (isWindows) {
    return runtimeRoot
  }

  const byOs = manifestDirs[process.platform]
  const relative = byOs?.[browser]
  if (!relative) {
    throw new Error(`暂未支持的浏览器或平台组合: ${browser} / ${process.platform}`)
  }
  return resolve(homedir(), relative)
}

function buildLauncherContents() {
  if (isWindows) {
    // Chrome Native Messaging 在 Windows 上要求 path 指向 .cmd/.bat/.exe。
    // 使用绝对路径，避免依赖 PATH；不转发 %*，以免吞掉 stdio。
    return [
      "@echo off",
      `"${nodeBinary}" "${runtimeHostScriptPath}"`,
      "",
    ].join("\r\n")
  }
  return `#!/bin/sh\nexec "${nodeBinary}" "${runtimeHostScriptPath}"\n`
}

function registerWindowsNativeHost(manifestPath) {
  const key = windowsRegistryKeys[targetBrowser]
  if (!key) {
    throw new Error(`暂未支持的 Windows 浏览器: ${targetBrowser}`)
  }

  const result = spawnSync(
    "reg",
    ["add", key, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"],
    { encoding: "utf8", windowsHide: true },
  )
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim()
    throw new Error(`写入注册表失败 (${key}): ${detail || `exit ${result.status}`}`)
  }
  return key
}

async function installRuntimeFiles() {
  for (const relativePath of runtimeSourceFiles) {
    const sourcePath = resolve(projectRoot, relativePath)
    if (!existsSync(sourcePath)) {
      throw new Error(`找不到 runtime 文件: ${sourcePath}`)
    }

    const targetPath = resolve(runtimeRoot, relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await copyFile(sourcePath, targetPath)
  }
}

async function main() {
  await installRuntimeFiles()
  await mkdir(runtimeRoot, { recursive: true })
  await writeFile(runtimeLauncherScriptPath, buildLauncherContents(), "utf8")
  if (!isWindows) {
    await chmod(runtimeLauncherScriptPath, 0o755)
  }

  const extensionId = getExtensionId()
  const manifestDir = resolveManifestDir(targetBrowser)
  const manifestPath = isWindows
    ? runtimeManifestPath
    : resolve(manifestDir, `${nativeHostName}.json`)

  await mkdir(manifestDir, { recursive: true })
  await writeFile(
    manifestPath,
    `${JSON.stringify({
      name: nativeHostName,
      description: "AGNX Bridge local launcher",
      path: runtimeLauncherScriptPath,
      type: "stdio",
      allowed_origins: [`chrome-extension://${extensionId}/`],
    }, null, 2)}\n`,
    "utf8",
  )

  let registryKey = ""
  if (isWindows) {
    registryKey = registerWindowsNativeHost(manifestPath)
  }

  console.log(`[native-host] platform: ${process.platform}`)
  console.log(`[native-host] browser: ${targetBrowser}`)
  console.log(`[native-host] extension id: ${extensionId}`)
  console.log(`[native-host] node: ${nodeBinary}`)
  console.log(`[native-host] runtime root: ${runtimeRoot}`)
  console.log(`[native-host] launcher: ${runtimeLauncherScriptPath}`)
  console.log(`[native-host] host script: ${runtimeHostScriptPath}`)
  console.log(`[native-host] manifest: ${manifestPath}`)
  if (registryKey) {
    console.log(`[native-host] registry: ${registryKey}`)
  }
}

await main().catch((error) => {
  console.error(`[native-host] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
