# AGNX Bridge

[中文](./README.md) · [MIT License](./LICENSE)

![AGNX Bridge](./docs/assets/cover.jpg)

Turn your **everyday, already-signed-in Chrome** into a local browser runtime for AI agents.  
One package: a **Chrome extension** that executes work, plus an **Agent Skill** that teaches Claude / Codex / Cursor how to call it.

```text
AI (Cursor / Codex / Claude Code)
    │  curl POST /api/agnx-bridge/exec   (then poll GET /exec/:id)
    ▼
Local bridge server (default :3054, started by native-host)
    │  extension polls for jobs / posts results
    ▼
Chrome extension (AGNX Bridge) — runs in your real daily Chrome
    │
    ├─ browser-agent   → dynamic chrome.* / CDP (control the browser)
    ├─ page-agent      → run JS in the page main world (DOM / site logic)
    └─ console-capture → session-style page / extension console capture
```

HTTP API: **`/api/agnx-bridge/*`** · Default port: **`3054`** · extensionId: `eppdcemdgahndmmnnfhmgpcagpjiclcp`

---

## Recommended path

1. Download `agnx-bridge-chrome-mv3.zip` from **[Releases](https://github.com/duo121/agnx-bridge/releases)** and unzip to get `chrome-mv3/`  
   (If there is no release yet, use “From source” below and `pnpm build`.)
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select `chrome-mv3/`
3. Install the local native host + Skill:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/duo121/agnx-bridge/main/scripts/install.sh | bash

# Or from a local clone
./scripts/install.sh
```

```powershell
# Windows (from a local clone)
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

4. Click the toolbar **AGNX Bridge** icon (do not open `popup.html` as a normal tab) → confirm port **3054** → **Enable bridge**  
   - The port is a number; agents / curl use the derived URL `http://localhost:3054` (same config).  
   - A clean install defaults to **off** — you must enable once before `online` becomes 1.
5. In your agent: “use the AGNX Bridge skill to list my tabs”.

Health check:

```bash
curl -sS http://localhost:3054/api/agnx-bridge/health
```

Expect `clients.online >= 1`.

---

## From source

Requires Node ≥ 18, pnpm ≥ 9, Google Chrome (macOS / Windows / Linux; Edge / Brave / Chromium below).

```bash
git clone https://github.com/duo121/agnx-bridge.git
cd agnx-bridge
pnpm install
pnpm build                 # writes .output/chrome-mv3/
./scripts/install.sh       # macOS / Linux: native-host + Skill
# Windows:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

Load `.output/chrome-mv3/`, **Enable bridge** in the popup, then run the health check above.

### Skill only / host only

```bash
./scripts/install-skill.sh
pnpm native-host:install
AGNX_BRIDGE_SKIP_SKILL=1 ./scripts/install.sh
```

```powershell
# Windows host-only
$env:AGNX_BRIDGE_SKIP_SKILL = "1"
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

Or:

```bash
npx skills add duo121/agnx-bridge -g -y
```

Skill install paths:

| Agent | Path |
|---|---|
| Cursor | `~/.cursor/skills/agnx-bridge/` |
| Claude Code | `~/.claude/skills/agnx-bridge/` |
| Codex | `~/.codex/skills/agnx-bridge/` |

API entry points:

- `GET  http://localhost:3054/api/agnx-bridge/health`
- `POST http://localhost:3054/api/agnx-bridge/exec`
- `GET  http://localhost:3054/api/agnx-bridge/exec/:execId`

Task templates: [`skills/agnx-bridge/references/task-templates.md`](./skills/agnx-bridge/references/task-templates.md).

---

## Capability boundary

| Included | Not (yet) |
|---|---|
| Dynamic `chrome.*` / CDP (`browser-agent`) | First-class interactive element / AX observe / ref lists |
| Arbitrary in-page JS (`page-agent`) | One-click Chrome Web Store install (Load unpacked today) |
| Session console capture | Node-free zip-only install |
| Real login state + everyday tabs | — |

---

## Repository layout

| Path | Role |
|---|---|
| `src/` | Chrome MV3 extension |
| `server/` | Local bridge HTTP server |
| `native-host/` | Native Messaging host |
| `skills/agnx-bridge/` | Agent Skill |
| `scripts/install.sh` | macOS / Linux one-shot: native-host + Skill |
| `scripts/install.ps1` | Windows one-shot: native-host + Skill |
| `keys/extension-private-key.pem` | Stable extensionId (required for fixed ID distribution) |
| `.output/chrome-mv3/` | Loadable extension after `pnpm build` |

| Runtime id | Value |
|---|---|
| Product | **AGNX Bridge** |
| extensionId | `eppdcemdgahndmmnnfhmgpcagpjiclcp` |
| Native Messaging | `com.agnx.bridge` |
| Runtime dir (macOS) | `~/Library/Application Support/AGNX/agnx-bridge-native-host/` |
| Runtime dir (Windows) | `%LOCALAPPDATA%\AGNX\agnx-bridge-native-host\` |
| HTTP API | `/api/agnx-bridge/*` |
| Default port | `3054` |

---

## Develop & pack

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm zip
pnpm crx
./scripts/install.sh
# Windows: powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

Other browsers:

```bash
NATIVE_HOST_BROWSER=edge pnpm native-host:install
NATIVE_HOST_BROWSER=brave pnpm native-host:install
NATIVE_HOST_BROWSER=chromium pnpm native-host:install
```

Logs live under `.output/` inside the runtime directory above (`native-host.log`, `bridge-server.stderr.log`).

Push a `v*` tag to publish a Release zip via GitHub Actions (`agnx-bridge-chrome-mv3.zip`).

---

## Open gaps

1. Chrome Web Store listing (Load unpacked for now)
2. Optional interactive-element snapshot API

---

## License

[MIT](./LICENSE)
