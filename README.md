# AGNX Bridge

把你**日常已登录的 Chrome** 变成 AI 的本地浏览器运行时。  
**浏览器扩展 + Agent Skill** 一套交付：扩展执行，Skill 教 Claude / Codex / Cursor 怎么调。

```text
AI（Cursor / Codex / Claude Code）
    │  curl POST /api/webext-bridge/exec   （结果再 GET /exec/:id 轮询）
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

---

## 目标用户路径（开源后）

理想体验：

1. 从 GitHub **Releases** 下载已构建的扩展包（zip）
2. Chrome → `chrome://extensions` → 开发者模式 → **加载已解压的扩展程序**
3. **一行命令**安装 Skill（并装好 native-host）
4. 扩展 popup 里点「开启桥接」→ 在 Cursor / Claude / Codex 里直接用

> 当前仓库已按上述路径整理；**Releases 自动发构建包**与**零克隆装 native-host**仍有缺口，见文末「开源缺口」。开发者可先用下方「从源码安装」跑通。

---

## 快速开始（从源码 · 现在就能用）

前置：Node ≥ 18、pnpm ≥ 9、Google Chrome（macOS 优先；Edge/Brave/Chromium 见下文）。

```bash
git clone <本仓库 URL> agnx-bridge
cd agnx-bridge
pnpm install
pnpm build                 # 产出 .output/chrome-mv3/
pnpm native-host:install   # 安装本机 native host + bridge server 运行时
./scripts/install-skill.sh # 把 skill 装进 Cursor / Claude / Codex
```

然后：

1. Chrome 打开 `chrome://extensions` → 开「开发者模式」→「加载已解压的扩展程序」→ 选 `.output/chrome-mv3/`
2. 点扩展图标 → 端口填 `3054`（或你想用的端口）→ **开启桥接**
3. 健康检查：

```bash
curl -sS http://localhost:3054/api/webext-bridge/health
```

应看到 `clients.online >= 1`。之后在 Agent 里说「用 AGNX Bridge / agnx-bridge skill 列一下当前标签」即可。

### 只装 Skill（一行）

在仓库根目录：

```bash
./scripts/install-skill.sh
```

仓库上线 GitHub 后，也可用（把 `<owner>` 换成你的账号）：

```bash
# 推荐：跨 Cursor / Claude / Codex 的 skills CLI
npx skills add <owner>/agnx-bridge -g -y

# 或脚本（需带 owner）
AGNX_BRIDGE_GITHUB_OWNER=<owner> \
  curl -fsSL https://raw.githubusercontent.com/<owner>/agnx-bridge/main/scripts/install-skill.sh | bash
```

Skill 会装到：

| Agent | 路径 |
|---|---|
| Cursor | `~/.cursor/skills/agnx-bridge/` |
| Claude Code | `~/.claude/skills/agnx-bridge/` |
| Codex | `~/.codex/skills/agnx-bridge/` |

Agent 通过 Skill 学到的入口：

- `GET  http://localhost:3054/api/webext-bridge/health`
- `POST http://localhost:3054/api/webext-bridge/exec`
- `GET  http://localhost:3054/api/webext-bridge/exec/:execId`

详细任务模板见 `skills/agnx-bridge/references/task-templates.md`。

---

## 仓库结构

| 路径 | 作用 |
|---|---|
| `src/` | Chrome MV3 扩展源码 |
| `server/` | 本机 bridge HTTP server |
| `native-host/` | Native Messaging 宿主 |
| `skills/agnx-bridge/` | Agent Skill（给 Claude / Codex / Cursor） |
| `scripts/install-native-host.mjs` | 安装本机宿主与 server 运行时 |
| `scripts/install-skill.sh` | 一行安装 Skill |
| `keys/extension-private-key.pem` | 稳定 extensionId（发布构建必须用它） |
| `.output/chrome-mv3/` | `pnpm build` 后的可加载扩展目录 |

稳定 extensionId（由 `keys/` 派生）：`eppdcemdgahndmmnnfhmgpcagpjiclcp`  
Native host 名：`com.agnx.webext_bridge`  
运行时目录：`~/Library/Application Support/AGNX/webext-bridge-native-host/`

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

协议摘要：扩展侧 `register` / `pull` / `result`；Agent 侧 `health` / `exec` / `exec/:id`。

---

## 开源缺口（相对「下包 + 一行命令」）

要对齐文首「目标用户路径」，还缺这些交付，建议按优先级补：

1. **GitHub Release 产物**  
   CI 跑 `pnpm build && pnpm zip`，把 `chrome-mv3` zip（及可选 `native-host-runtime` tar）挂到 Releases。用户现在还不能「只在网页上下载」。

2. **不克隆也能装 native-host**  
   扩展无法自己启动 Node；必须装宿主。需要发布版安装器，例如：  
   `curl …/install.sh | bash` 下载 runtime 到 `Application Support` 并写 NativeMessagingHosts，**无需** `pnpm install` 整仓。

3. **扩展安装体验**  
   Chrome 不允许随便装 GitHub 上的 `.crx`。开源阶段只能 **Load unpacked** 或上架 **Chrome Web Store**。README 必须写清，避免用户以为双击 zip 就能装。

4. **端口与默认值统一**  
   Skill / 文档默认 `3054`；popup 若曾示例 `3006`，易踩坑。发布前统一默认端口与文案。

5. **跨平台**  
   `install-native-host.mjs` 对 Windows 未支持；Linux 路径需再验。开源用户画像若含 Windows，要补齐。

6. **Skill 发现**  
   仓库公开后，补 `npx skills add <owner>/agnx-bridge -g -y` 到 README 首页；可选登记 skills.sh。

7. **能力产品化（可选）**  
   可交互元素快照、更安全的权限分层、一键「检测 bridge 是否在线」的 skill 开场检查——提升 Agent 首次成功率。

---

## License

Apache-2.0
