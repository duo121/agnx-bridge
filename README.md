# AGNX Bridge

把你**日常已登录的 Chrome** 变成 AI 的本地浏览器运行时。  
**浏览器扩展 + Agent Skill** 一套交付：扩展执行，Skill 教 Claude / Codex / Cursor 怎么调。

```text
AI（Cursor / Codex / Claude Code）
    │  curl POST /api/agnx-bridge/exec   （结果再 GET /exec/:id 轮询）
    ▼
本机 bridge server（默认 :3054，native-host 拉起）
    │  扩展轮询拉取任务 / 回传结果
    ▼
Chrome 扩展（AGNX Bridge）── 跑在你「日常已登录」的真 Chrome，不另起浏览器
    │
    ├─ browser-agent  → 动态调 chrome.* / CDP（主轴：控浏览器本体）
    │     例：{ "kind":"browser-agent", "method":"tabs.query",
    │           "args":[{ "active":true, "currentWindow":true }] }
    │         → chrome.tabs.query(...) → 拿到 tabId / url / title
    │
    ├─ page-agent     → 在网页 Main World 跑一段 JS（增强：控当前页 DOM / 站内逻辑）
    │     例：{ "kind":"page-agent", "tabId":12345, "timeout":15000,
    │           "code":"(() => ({ title: document.title,
    │             unread: document.querySelectorAll('.unread').length }))()" }
    │
    └─ console-capture → 会话式抓页面/扩展 console（跟过程，不是单次 API）
          例：start → { "kind":"console-capture", "target":"page", "action":"start", "tabId":12345 }
              做事 → （中间穿插 browser-agent / page-agent）
              get  → { "kind":"console-capture", "target":"page", "action":"get",
                       "filter":{ "levels":["error","warn"] } }
              stop → { "kind":"console-capture", "target":"page", "action":"stop" }

一句话：日常 Chrome 被抬成 AI 的本地运行时——API 管浏览器、JS 管页面、会话管过程。
```

HTTP API：**`/api/agnx-bridge/*`**

---

## 目标用户路径

1. 从 GitHub **Releases** 下载 `agnx-bridge-chrome-mv3.zip`，解压得到 `chrome-mv3/`
2. Chrome → `chrome://extensions` → 开发者模式 → **加载已解压的扩展程序** → 选 `chrome-mv3/`
3. **一行命令**安装本机宿主 + Skill：

```bash
# 仓库公开后（把 <owner> 换成你的账号）
AGNX_BRIDGE_GITHUB_OWNER=<owner> \
  curl -fsSL https://raw.githubusercontent.com/<owner>/agnx-bridge/main/scripts/install.sh | bash

# 或已克隆本仓库时
./scripts/install.sh
```

4. 扩展 popup → 端口 **3054**（默认）→ **开启桥接** → Agent 里直接用

> Releases 自动发构建包仍依赖打 tag；在此之前请用下方「从源码安装」先 `pnpm build` 出扩展目录。其余缺口见文末。

---

## 快速开始（从源码 · 现在就能用）

前置：Node ≥ 18、pnpm ≥ 9、Google Chrome（macOS 优先；Edge/Brave/Chromium 见下文）。

```bash
git clone <本仓库 URL> agnx-bridge
cd agnx-bridge
pnpm install
pnpm build                 # 产出 .output/chrome-mv3/
./scripts/install.sh       # native-host + Skill
```

然后：

1. Chrome 打开 `chrome://extensions` → 开「开发者模式」→「加载已解压的扩展程序」→ 选 `.output/chrome-mv3/`
2. 点扩展图标 → 端口应为 **3054** → **开启桥接**
3. 健康检查：

```bash
curl -sS http://localhost:3054/api/agnx-bridge/health
```

应看到 `clients.online >= 1`。之后在 Agent 里说「用 AGNX Bridge skill 列一下当前标签」即可。

### 只装 Skill / 只装宿主

```bash
./scripts/install-skill.sh
pnpm native-host:install
AGNX_BRIDGE_SKIP_SKILL=1 ./scripts/install.sh
```

仓库上线 GitHub 后也可用：

```bash
npx skills add <owner>/agnx-bridge -g -y
```

Skill 会装到：

| Agent | 路径 |
|---|---|
| Cursor | `~/.cursor/skills/agnx-bridge/` |
| Claude Code | `~/.claude/skills/agnx-bridge/` |
| Codex | `~/.codex/skills/agnx-bridge/` |

Agent 入口：

- `GET  http://localhost:3054/api/agnx-bridge/health`
- `POST http://localhost:3054/api/agnx-bridge/exec`
- `GET  http://localhost:3054/api/agnx-bridge/exec/:execId`

任务模板：`skills/agnx-bridge/references/task-templates.md`。

---

## 仓库结构

| 路径 | 作用 |
|---|---|
| `src/` | Chrome MV3 扩展源码 |
| `server/` | 本机 bridge HTTP server |
| `native-host/` | Native Messaging 宿主 |
| `skills/agnx-bridge/` | Agent Skill |
| `scripts/install.sh` | **一键**：native-host + Skill |
| `scripts/install-native-host.mjs` | 仅安装本机宿主 |
| `scripts/install-skill.sh` | 仅安装 Skill |
| `keys/extension-private-key.pem` | 稳定 extensionId |
| `.output/chrome-mv3/` | `pnpm build` 后的可加载扩展目录 |

| 运行时标识 | 值 |
|---|---|
| 产品名 | **AGNX Bridge** |
| extensionId | `eppdcemdgahndmmnnfhmgpcagpjiclcp` |
| Native Messaging 名 | `com.agnx.bridge` |
| 本机运行时目录 | `~/Library/Application Support/AGNX/agnx-bridge-native-host/` |
| HTTP API | `/api/agnx-bridge/*` |
| 默认端口 | `3054` |

---

## 能力边界

| 有 | 没有 |
|---|---|
| 动态 `chrome.*` / CDP（`browser-agent`） | 一等公民「可交互元素列表 / AX observe / ref」 |
| 页内任意 JS（`page-agent`） | Chrome 网上应用店一键安装（目前 Load unpacked） |
| 会话式 console 采集 | 无 Node 的纯 zip 安装 |
| 复用真实登录态与日常标签 | Windows native-host（当前以 macOS 为主） |

---

## 开发与打包

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm zip
pnpm crx
./scripts/install.sh
```

```bash
NATIVE_HOST_BROWSER=edge pnpm native-host:install
NATIVE_HOST_BROWSER=brave pnpm native-host:install
NATIVE_HOST_BROWSER=chromium pnpm native-host:install
```

日志：

- `~/Library/Application Support/AGNX/agnx-bridge-native-host/.output/native-host.log`
- `~/Library/Application Support/AGNX/agnx-bridge-native-host/.output/bridge-server.stderr.log`

---

## 开源缺口

1. **GitHub Release**：打 `v*` tag 后上传 `agnx-bridge-chrome-mv3.zip`（workflow 已有）
2. **扩展商店**：开源阶段靠 Load unpacked，或上架 Chrome Web Store
3. **Windows** native-host
4. **可交互元素快照**（可选能力）

---

## License

MIT
