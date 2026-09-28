import { defineConfig } from "wxt"
// @ts-expect-error Local build helper is plain ESM.
import { getExtensionManifestKey } from "./scripts/extension-identity.mjs"

export default defineConfig({
  srcDir: "src",
  entrypointsDir: "entrypoints",
  manifest: {
    key: getExtensionManifestKey(),
    name: "AGNX Bridge",
    description: "AGNX Bridge — turn your logged-in Chrome into an AI browser runtime",
    version: "0.1.0",
    permissions: [
      "storage",
      "nativeMessaging",
      "activeTab",
      "tabs",
      "tabGroups",
      "scripting",
      "bookmarks",
      "history",
      "downloads",
      "sessions",
      "alarms",
      "notifications",
      "contextMenus",
      "debugger"
    ],
    host_permissions: ["<all_urls>"],
    action: {
      default_title: "AGNX Bridge",
      default_popup: "popup.html"
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'"
    }
  },
  dev: {
    server: {
      port: 3103
    }
  },
  webExt: {
    disabled: true
  }
})
