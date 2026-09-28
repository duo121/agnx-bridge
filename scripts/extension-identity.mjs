import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
export const projectRoot = resolve(__dirname, "..")

/** 开源发布用 `keys/`；本地覆盖可用 `.keys/`（gitignore）。 */
const committedKeysDir = resolve(projectRoot, "keys")
const localKeysDir = resolve(projectRoot, ".keys")
const committedKeyPath = resolve(committedKeysDir, "extension-private-key.pem")
const localKeyPath = resolve(localKeysDir, "extension-private-key.pem")

export const keysDir = existsSync(committedKeyPath) ? committedKeysDir : localKeysDir
export const keyPath = existsSync(committedKeyPath) ? committedKeyPath : localKeyPath
export const nativeHostName = "com.agnx.bridge"

function hexToExtensionAlphabet(hex) {
  return hex.replace(/[0-9a-f]/g, (char) => String.fromCharCode(97 + Number.parseInt(char, 16)))
}

export function ensurePrivateKey() {
  if (existsSync(keyPath)) {
    return keyPath
  }

  mkdirSync(localKeysDir, { recursive: true })
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  })

  const pem = privateKey.export({
    type: "pkcs8",
    format: "pem",
  })

  writeFileSync(localKeyPath, pem)
  return localKeyPath
}

export function getExtensionManifestKey() {
  ensurePrivateKey()
  const privateKeyPem = readFileSync(ensurePrivateKey(), "utf8")
  const publicKey = createPublicKey(privateKeyPem)
  const der = publicKey.export({
    type: "spki",
    format: "der",
  })
  return der.toString("base64")
}

export function getExtensionId() {
  ensurePrivateKey()
  const manifestKey = getExtensionManifestKey()
  const digestHex = createHash("sha256")
    .update(Buffer.from(manifestKey, "base64"))
    .digest("hex")
    .slice(0, 32)
  return hexToExtensionAlphabet(digestHex)
}
