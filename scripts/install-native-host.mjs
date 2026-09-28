import { existsSync } from "node:fs"
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { getExtensionId, nativeHostName, projectRoot } from "./extension-identity.mjs"

const targetBrowser = (process.env.NATIVE_HOST_BROWSER || "chrome").trim().toLowerCase()
const nodeBinary = process.env.NATIVE_HOST_NODE || process.execPath
const runtimeRoot = resolve(
  process.env.HOME || "",
  "Library/Application Support/AGNX/webext-bridge-native-host",
)
const runtimeHostScriptPath = resolve(runtimeRoot, "native-host/host.mjs")
const runtimeLauncherScriptPath = resolve(runtimeRoot, "native-host-launcher.sh")
const runtimeSourceFiles = [
  "native-host/host.mjs",
  "native-host/launcher-core.mjs",
  "server/index.mjs",
  "server/http-server.mjs",
  "server/bridge-store.mjs",
  "server/bridge-protocol.mjs",
]

function resolveManifestDir(browser) {
  if (process.platform === "darwin") {
    if (browser === "chrome") {
      return resolve(process.env.HOME || "", "Library/Application Support/Google/Chrome/NativeMessagingHosts")
    }
    if (browser === "edge") {
      return resolve(process.env.HOME || "", "Library/Application Support/Microsoft Edge/NativeMessagingHosts")
    }
    if (browser === "brave") {
      return resolve(process.env.HOME || "", "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts")
    }
    if (browser === "chromium") {
      return resolve(process.env.HOME || "", "Library/Application Support/Chromium/NativeMessagingHosts")
    }
  }

  if (process.platform === "linux") {
    return resolve(process.env.HOME || "", ".config/google-chrome/NativeMessagingHosts")
  }

  throw new Error(`暂未支持的浏览器或平台组合: ${browser} / ${process.platform}`)
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
  await writeFile(
    runtimeLauncherScriptPath,
    `#!/bin/sh\nexec "${nodeBinary}" "${runtimeHostScriptPath}"\n`,
    "utf8",
  )
  await chmod(runtimeLauncherScriptPath, 0o755)

  const manifestDir = resolveManifestDir(targetBrowser)
  const manifestPath = resolve(manifestDir, `${nativeHostName}.json`)
  const extensionId = getExtensionId()

  await mkdir(manifestDir, { recursive: true })
  await writeFile(
    manifestPath,
    `${JSON.stringify({
      name: nativeHostName,
      description: "AGNX Webext Bridge local launcher",
      path: runtimeLauncherScriptPath,
      type: "stdio",
      allowed_origins: [`chrome-extension://${extensionId}/`],
    }, null, 2)}\n`,
    "utf8",
  )

  console.log(`[native-host] browser: ${targetBrowser}`)
  console.log(`[native-host] extension id: ${extensionId}`)
  console.log(`[native-host] node: ${nodeBinary}`)
  console.log(`[native-host] runtime root: ${runtimeRoot}`)
  console.log(`[native-host] launcher: ${runtimeLauncherScriptPath}`)
  console.log(`[native-host] host script: ${runtimeHostScriptPath}`)
  console.log(`[native-host] manifest: ${manifestPath}`)
}

await main().catch((error) => {
  console.error(`[native-host] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
