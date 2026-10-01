/**
 * Seed Chrome Preferences so an unpacked extension loads without --load-extension
 * (Google Chrome brand builds ignore --load-extension).
 *
 * Usage:
 *   node scripts/seed-chrome-unpacked-extension.mjs <profileDir> <extensionDir> <extensionId>
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const profileDir = resolve(process.argv[2] || "C:/Users/jianduo/Documents/github/agnx-bridge/.winduo-e2e/chrome-profile")
const extensionDir = resolve(process.argv[3] || "C:/Users/jianduo/Documents/github/agnx-bridge/.winduo-e2e/chrome-mv3")
const extensionId = process.argv[4] || "eppdcemdgahndmmnnfhmgpcagpjiclcp"

function chromeInstallTime() {
  // Chrome uses Windows FILETIME (100ns since 1601) as decimal string.
  return String(BigInt(Date.now() + 11_644_473_600_000) * 10000n)
}

function scrubAppleDouble(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (name.startsWith("._") || name === ".DS_Store") {
      rmSync(full, { recursive: true, force: true })
      continue
    }
    try {
      scrubAppleDouble(full)
    } catch {
      // file
    }
  }
}

scrubAppleDouble(extensionDir)

const manifest = JSON.parse(readFileSync(join(extensionDir, "manifest.json"), "utf8"))
const defaultDir = join(profileDir, "Default")
mkdirSync(defaultDir, { recursive: true })

const prefsPath = join(defaultDir, "Preferences")
let prefs = {}
if (existsSync(prefsPath)) {
  try {
    prefs = JSON.parse(readFileSync(prefsPath, "utf8"))
  } catch {
    prefs = {}
  }
}

const apiPermissions = Array.isArray(manifest.permissions) ? [...manifest.permissions] : []
const hostPermissions = Array.isArray(manifest.host_permissions) ? [...manifest.host_permissions] : []
const installTime = chromeInstallTime()

prefs.extensions = prefs.extensions || {}
prefs.extensions.ui = {
  ...(prefs.extensions.ui || {}),
  developer_mode: true,
}
prefs.extensions.settings = prefs.extensions.settings || {}
prefs.extensions.settings[extensionId] = {
  account_extension_type: 0,
  active_permissions: {
    api: apiPermissions,
    explicit_host: hostPermissions,
    manifest_permissions: [],
    scriptable_host: [],
  },
  commands: {},
  content_settings: [],
  creation_flags: 1,
  disable_reasons: [],
  from_webstore: false,
  granted_permissions: {
    api: apiPermissions,
    explicit_host: hostPermissions,
    manifest_permissions: [],
    scriptable_host: [],
  },
  incognito_content_settings: [],
  incognito_preferences: {},
  location: 4,
  manifest,
  never_blocked_host: [],
  newAllowFileAccess: true,
  path: extensionDir.replace(/\//g, "\\"),
  preferences: {},
  state: 1,
  was_installed_by_default: false,
  was_installed_by_oem: false,
  withholding_permissions: false,
  first_install_time: installTime,
  last_update_time: installTime,
}

writeFileSync(prefsPath, `${JSON.stringify(prefs)}\n`, "utf8")
console.log(`seeded ${prefsPath}`)
console.log(`extension ${extensionId} -> ${extensionDir}`)
