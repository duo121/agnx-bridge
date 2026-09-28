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

HTTP 入口统一为 **`/api/agnx-bridge/*`**（旧路径 `/api/webext-bridge/*` 仍兼容，文档与 Skill 只写新路径）。

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
./scripts/install.sh       # native-host + Skill（等价于 native-host:install + skill:install）
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
./scripts/install-skill.sh              # 仅 Skill
pnpm native-host:install                # 仅 native-host
AGNX_BRIDGE_SKIP_SKILL=1 ./scripts/install.sh   # 一键但不装 Skill
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

Agent 通过 Skill 学到的入口：

- `GET  http://localhost:3054/api/agnx-bridge/health`
- `POST http://localhost:3054/api/agnx-bridge/exec`
- `GET  http://localhost:3054/api/agnx-bridge/exec/:execId`

详细任务模板见 `skills/agnx-bridge/references/task-templates.md`。

---

## 仓库结构

| 路径 | 作用 |
|---|---|
| `src/` | Chrome MV3 扩展源码 |
| `server/` | 本机 bridge HTTP server |
| `native-host/` | Native Messaging 宿主 |
| `skills/agnx-bridge/` | Agent Skill（给 Claude / Codex / Cursor） |
| `scripts/install.sh` | **一键**：native-host + Skill |
| `scripts/install-native-host.mjs` | 仅安装本机宿主与 server 运行时 |
| `scripts/install-skill.sh` | 仅安装 Skill |
| `keys/extension-private-key.pem` | 稳定 extensionId（发布构建必须用它） |
| `.output/chrome-mv3/` | `pnpm build` 后的可加载扩展目录 |

| 运行时标识 | 值 |
|---|---|
| extensionId | `eppdcemdgahndmmnnfhmgpcagpjiclcp`（由 `keys/` 派生） |
| Native Messaging 名 | `com.agnx.webext_bridge`（Chrome 注册名，历史兼容，勿轻易改） |
| 本机运行时目录 | `~/Library/Application Support/AGNX/webext-bridge-native-host/`（目录名历史兼容） |

> 上表里若仍出现 `webext` 字样，仅是 **系统注册名 / 磁盘目录** 的兼容保留，产品对外一律叫 **AGNX Bridge**。

---

## 能力边界（诚实说明）

| 有 | 没有（缺口） |
|---|---|
| 动态 `chrome.*` / CDP（`browser-agent`） | 一等公民「可交互元素列表 / AX observe / ref 点击」 |
| 页内任意 JS（`page-agent`） | Chrome 网上应用店一键安装（目前靠开发者模式加载） |
| 会话式 console 采集 | 不装 native-host 就「只下 zip 即用」 |
| 复用真实登录态与日常标签 | Windows 原生宿主安装（当前脚本以 macOS 为主，Linux 部分支持） |

点选页面元素：请在 `page-agent` 里自写选择器，或自行拼 CDP；这不是内置工具。

---

## 开发与打包

```bash
pnpm install
pnpm typecheck
pnpm build          # .output/chrome-mv3/
pnpm zip            # .output/*.zip —— 未来挂到 GitHub Releases
pnpm crx            # 可选 CRX（仍建议用户 Load unpacked）
pnpm native-host:install
pnpm skill:install
./scripts/install.sh    # 推荐：两者一起
```

换浏览器装 native host：

```bash
NATIVE_HOST_BROWSER=edge pnpm native-host:install
NATIVE_HOST_BROWSER=brave pnpm native-host:install
NATIVE_HOST_BROWSER=chromium pnpm native-host:install
```

排查日志：

- `~/Library/Application Support/AGNX/webext-bridge-native-host/.output/native-host.log`
- `~/Library/Application Support/AGNX/webext-bridge-native-host/.output/bridge-server.stderr.log`

协议摘要：扩展侧 `register` / `pull` / `result`；Agent 侧 `health` / `exec` / `exec/:id`（均在 `/api/agnx-bridge` 下）。

---

## 开源缺口（相对「下包 + 一行命令」）

要对齐文首「目标用户路径」，还缺这些交付，建议按优先级补：

1. **GitHub Release 产物**  
   已有 `.github/workflows/release.yml`：打 `v*` tag 后构建并上传 `agnx-bridge-chrome-mv3.zip`。公开仓库并推送 tag 后，用户才可「只在网页上下载」。

2. **不克隆装宿主**  
   已提供 `scripts/install.sh`（可 `curl | bash`）。仍依赖 Node 与 GitHub 上的源码/归档可读；真正「只下 zip、无 Node」需再做打包安装器。

3. **扩展安装体验**  
   Chrome 不允许随便装 GitHub 上的 `.crx`。开源阶段只能 **Load unpacked** 或上架 **Chrome Web Store**。

4. **跨平台**  
   `install-native-host.mjs` 对 Windows 未支持；Linux 路径需再验。

5. **Skill 发现**  
   仓库公开后，首页用 `npx skills add <owner>/agnx-bridge -g -y`；可选登记 skills.sh。

6. **能力产品化（可选）**  
   可交互元素快照、权限分层、skill 开场自动 `health` 检查。

---

## License

Apache-2.0
