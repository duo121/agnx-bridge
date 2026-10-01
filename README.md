# AGNX Bridge

[English](./README.en.md) · [MIT License](./LICENSE)

![AGNX Bridge](./docs/assets/cover.jpg)

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
    ├─ page-agent     → 在网页 Main World 跑一段 JS（控当前页 DOM / 站内逻辑）
    └─ console-capture → 会话式抓页面/扩展 console
```

HTTP API：**`/api/agnx-bridge/*`** · 默认端口：**`3054`** · extensionId：`eppdcemdgahndmmnnfhmgpcagpjiclcp`

---

## 目标用户路径（推荐）

1. 从 GitHub **[Releases](https://github.com/duo121/agnx-bridge/releases)** 下载 `agnx-bridge-chrome-mv3.zip`，解压得到 `chrome-mv3/`  
   （若还没有 Release，用下方「从源码安装」先 `pnpm build`。）
2. Chrome → `chrome://extensions` → 开发者模式 → **加载已解压的扩展程序** → 选 `chrome-mv3/`
3. 一行命令安装本机宿主 + Skill：

```bash
curl -fsSL https://raw.githubusercontent.com/duo121/agnx-bridge/main/scripts/install.sh | bash

# 或已克隆本仓库时
./scripts/install.sh
```

4. 点工具栏 **AGNX Bridge** 图标（不要当网页打开 popup）→ 确认端口 **3054** → **开启桥接**  
   - 端口是数字；Agent / curl 用的是派生地址 `http://localhost:3054`（同一配置）。  
   - 干净安装默认**关闭**，必须点一次开启才会 `online`。
5. Agent 里直接说「用 AGNX Bridge skill 列一下当前标签」。

健康检查：

```bash
curl -sS http://localhost:3054/api/agnx-bridge/health
```

应看到 `clients.online >= 1`。

---

## 快速开始（从源码）

前置：Node ≥ 18、pnpm ≥ 9、Google Chrome（macOS 优先；Edge / Brave / Chromium 见下文）。

```bash
git clone https://github.com/duo121/agnx-bridge.git
cd agnx-bridge
pnpm install
pnpm build                 # 产出 .output/chrome-mv3/
./scripts/install.sh       # native-host + Skill
```

然后加载 `.output/chrome-mv3/`，popup **开启桥接**，再跑上面的 `health`。

### 只装 Skill / 只装宿主

```bash
./scripts/install-skill.sh
pnpm native-host:install
AGNX_BRIDGE_SKIP_SKILL=1 ./scripts/install.sh
```

也可用：

```bash
npx skills add duo121/agnx-bridge -g -y
```

Skill 安装位置：

| Agent | 路径 |
|---|---|
| Cursor | `~/.cursor/skills/agnx-bridge/` |
| Claude Code | `~/.claude/skills/agnx-bridge/` |
| Codex | `~/.codex/skills/agnx-bridge/` |

Agent 入口：

- `GET  http://localhost:3054/api/agnx-bridge/health`
- `POST http://localhost:3054/api/agnx-bridge/exec`
- `GET  http://localhost:3054/api/agnx-bridge/exec/:execId`

任务模板：[`skills/agnx-bridge/references/task-templates.md`](./skills/agnx-bridge/references/task-templates.md)。

---

## 能力边界

| 有 | 没有 |
|---|---|
| 动态 `chrome.*` / CDP（`browser-agent`） | 一等公民「可交互元素列表 / AX observe / ref」 |
| 页内任意 JS（`page-agent`） | Chrome 网上应用店一键安装（目前 Load unpacked） |
| 会话式 console 采集 | 无 Node 的纯 zip 安装 |
| 复用真实登录态与日常标签 | Windows native-host（当前以 macOS 为主） |

---

## 仓库结构

| 路径 | 作用 |
|---|---|
| `src/` | Chrome MV3 扩展源码 |
| `server/` | 本机 bridge HTTP server |
| `native-host/` | Native Messaging 宿主 |
| `skills/agnx-bridge/` | Agent Skill |
| `scripts/install.sh` | 一键：native-host + Skill |
| `keys/extension-private-key.pem` | 稳定 extensionId（开源发行为固定 ID 所需） |
| `.output/chrome-mv3/` | `pnpm build` 后的可加载扩展目录 |

| 运行时标识 | 值 |
|---|---|
| 产品名 | **AGNX Bridge** |
| extensionId | `eppdcemdgahndmmnnfhmgpcagpjiclcp` |
| Native Messaging | `com.agnx.bridge` |
| 本机运行时目录 | `~/Library/Application Support/AGNX/agnx-bridge-native-host/` |
| HTTP API | `/api/agnx-bridge/*` |
| 默认端口 | `3054` |

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

其它浏览器宿主：

```bash
NATIVE_HOST_BROWSER=edge pnpm native-host:install
NATIVE_HOST_BROWSER=brave pnpm native-host:install
NATIVE_HOST_BROWSER=chromium pnpm native-host:install
```

日志：

- `~/Library/Application Support/AGNX/agnx-bridge-native-host/.output/native-host.log`
- `~/Library/Application Support/AGNX/agnx-bridge-native-host/.output/bridge-server.stderr.log`

打 `v*` tag 可走 GitHub Actions 发 Release（`agnx-bridge-chrome-mv3.zip`）。

---

## 开源缺口

1. Chrome Web Store 上架（当前 Load unpacked）
2. Windows native-host
3. 可选：可交互元素快照

---

## License

[MIT](./LICENSE)
