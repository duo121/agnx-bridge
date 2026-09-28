---
name: agnx-bridge
description: 通过本机 AGNX Bridge HTTP API 驱动已在线 Chrome 扩展，提供页面导航、页面脚本执行、截图、页面/插件 console、CDP 调试与通用 Chrome API 自动化。适用于网页采集、页面交互、浏览器操作和插件侧诊断。
engine: automation
tags:
  - agnx
  - bridge
  - chrome
  - automation
  - tabs
  - agnx-bridge
---

# AGNX Bridge Skill

## 定位

这个 skill 教 Agent 如何调用 **AGNX Bridge**（Chrome 扩展 + 本机 bridge server）。

- 通过本机 HTTP API 驱动已在线浏览器扩展（默认 `http://localhost:3054`）
- 复用用户当前真实浏览器上下文与登录态
- 覆盖浏览器控制、页面读取、页面执行、截图、日志采集、CDP 调试
- 面向任务提供稳定工作流，而不是只暴露底层协议名词

适用任务：

- 浏览器自动化
- 页面导航与页面状态检查
- 网页正文与结构化信息提取
- 页面点击、输入、提交、滚动与页面脚本执行
- 页面截图与关键帧观察
- 页面 console / 插件 console 诊断
- 浏览器标签页、窗口、历史、书签等资源访问
- 基于 CDP 的页面与网络调试

## 前置条件

- Bridge HTTP API 默认在 `http://localhost:3054`（由扩展 popup「开启桥接」经 **native-host** 拉起；不必依赖其它前端进程）
- 浏览器已加载 **AGNX Bridge** 扩展且桥接在线
- 建议先执行健康检查，确认存在在线 client

快速检查：

```bash
BASE=http://localhost:3054/api/agnx-bridge
curl -sS "$BASE/health"
```

如果没有在线 client，先停止任务并说明 bridge 未就绪（让用户开 popup → 开启桥接）。

## 工程与安装坐标

> 改协议以本仓库源码为准。不要和 OpenCLI、Agnx 桌面内嵌 Browser 搞混。

| 角色 | 说明 |
|---|---|
| 开源仓库 | `agnx-bridge`（扩展 + `skills/agnx-bridge`） |
| 扩展清单名 | `AGNX Bridge` |
| 构建产物 | 仓库内 `.output/chrome-mv3/`（或 GitHub Releases 的 zip） |
| extensionId | `eppdcemdgahndmmnnfhmgpcagpjiclcp`（由仓库 `keys/extension-private-key.pem` 派生） |
| 运行时根 | `~/Library/Application Support/AGNX/webext-bridge-native-host/`（目录名历史兼容） |
| Native host | `com.agnx.webext_bridge`（Chrome 注册名，历史兼容） |
| Skill 安装位置 | `~/.cursor/skills/agnx-bridge/` · `~/.claude/skills/agnx-bridge/` · `~/.codex/skills/agnx-bridge/` |

用户安装 Skill：

```bash
# 在克隆的仓库根目录
./scripts/install-skill.sh
# 或（仓库公开后）
npx skills add <owner>/agnx-bridge -g -y
```

**没有**内置「可交互元素快照 / AX ref」工具；需要时用 `page-agent` 自写 DOM 查询，或 `browser-agent` + CDP。

## 权限模型（当前实现）

- `manifest.permissions` 已固定启用（非 optional）：`sidePanel`、`storage`、`activeTab`、`tabs`、`tabGroups`、`scripting`、`bookmarks`、`history`、`downloads`、`sessions`、`alarms`、`clipboardRead`、`clipboardWrite`、`management`、`notifications`、`contextMenus`、`debugger`、`webRequest`、`declarativeNetRequest`、`readingList`、`cookies`、`contentSettings`、`search`、`topSites`、`browsingData`、`webNavigation`、`tabCapture`、`pageCapture`。
- `manifest.host_permissions` 为 `['<all_urls>']`。
- `browser-agent` 不做运行时危险 API denylist，调用范围由浏览器 API 暴露与扩展权限共同决定。
- 如果任务需要“只开放部分能力”，优先通过本 skill 的提示词策略裁剪，不要先改代码。

## 统一调用约定

常用入口只有三个：

- `GET /api/agnx-bridge/health`
- `POST /api/agnx-bridge/exec`
- `GET /api/agnx-bridge/exec/:execId`

统一 shell 模板只保留一次：

```bash
BASE=http://localhost:3054/api/agnx-bridge

curl -sS "$BASE/health"

curl -sS -X POST "$BASE/exec" \
  -H 'Content-Type: application/json' \
  -d '<JSON_BODY>'
```

下面所有任务模板只给 `<JSON_BODY>`。

执行参数约定：

- `waitMs` 默认用 `20000`
- 页面加载、截图、慢接口排查可提高到 `30000` 到 `60000`
- `page-agent.timeout` 推荐 `15000` 到 `30000`
- 如果 `POST /exec` 返回的 `status` 仍是 `pending` 或 `dispatched`，继续轮询 `GET /exec/:execId`

## Bridge 控制（端口/连接）

扩展 popup / background 提供独立控制通道，用于管理 bridge 长连接配置与运行状态：

- `BRIDGE_CONTROL_GET_STATE`
- `BRIDGE_CONTROL_SET_CONFIG`
- `BRIDGE_CONTROL_CONNECT`
- `BRIDGE_CONTROL_DISCONNECT`
- `BRIDGE_CONTROL_RECONNECT`

说明：

- 控制消息通过 `chrome.runtime.sendMessage` 直接发送给扩展 background，不经过 `/api/agnx-bridge/exec`。
- 当前实现仅保留“当前快照”，不包含历史记录能力。
- 任务模板见 [references/task-templates.md](references/task-templates.md) 的「Bridge 控制（端口/连接）」章节。

## 能力总览

### 1. 浏览器控制

- 查询标签页、窗口、分组、会话
- 打开页面、跳转当前页面
- 后退、前进、刷新
- 调用通用 Chrome Extension API

### 2. 页面读取与页面内执行

- 读取标题、URL、正文、链接、DOM 状态
- 读取页面上的结构化信息
- 在页面 Main World 执行脚本
- 调用页面全局对象、页面函数、页面路由逻辑

### 3. 页面交互与可视化观测

- 抓取当前可见页面截图
- 导航后抓取关键画面
- 页面点击、输入、表单提交、滚动
- 基于 CDP 做更底层的截图与调试

### 4. 日志与诊断

- 抓取页面 console
- 抓取插件 `background/service worker` console
- 诊断页面报错
- 配合 CDP 做网络与运行时排查

### 5. 浏览器资源访问

- `tabs`
- `windows`
- `tabGroups`
- `bookmarks`
- `history`
- `downloads`
- `storage`
- `sessions`
- `alarms`
- `notifications`
- `contextMenus`
- `debugger`

## 入口选择

### `browser-agent`

适合：

- 浏览器级操作
- 标签页 / 窗口 / 历史 / 书签查询
- 页面打开、跳转、后退、刷新
- 截图
- `debugger.attach`
- `debugger.sendCommand`
- `debugger.detach`

覆盖命名空间：

- `tabs`
- `windows`
- `tabGroups`
- `bookmarks`
- `history`
- `downloads`
- `storage`
- `sessions`
- `alarms`
- `notifications`
- `contextMenus`
- `debugger`

### `page-agent`

适合：

- 页面正文提取
- DOM 状态检查
- 页面脚本执行
- 页面内路由或业务逻辑触发
- 结构化采集

执行特性：

- `code` 在页面 `Main World` 执行
- 不传 `tabId` 时默认使用当前活动标签页
- 通过 `args` 传参，在脚本里用 `args` 数组读取
- 适合返回结构化 JSON，不适合返回超长 DOM 快照

### `console-capture`

适合：

- 页面 console 采集
- 插件 console 采集
- 页面错误排查
- 自动化步骤期间的日志观察

执行特性：

- `target` 支持 `page` 和 `extension`
- `action` 支持 `start / get / stop / clear`
- `page` 模式会通过 `chrome.debugger` 建立监听页面日志
- `extension` 模式会缓冲插件 `background/service worker` 自身日志
- 日志采集是显式开启的：要拿新增日志，先 `start`；`get` 只读取当前缓冲，不会自动开始监听

## 可靠工作流

### 工作流 1：接入浏览器并确认目标标签页

1. 先调用 `health` 确认有在线 client
2. 用 `tabs.query` 找到当前活动标签页或目标标签页
3. 在拿到 `tabId` 后再进行导航、截图、CDP 调试或页面日志采集

### 工作流 2：页面跳转并观察结果

1. 用 `tabs.update` 或 `tabs.create` 打开目标页面
2. 用 `page-agent` 读取 `title / url / readyState / 关键元素`
3. 必要时抓一张截图确认关键帧
4. 如有异常，再开启 `console-capture target=page`

### 工作流 3：页面调试

1. `console-capture target=page start`
2. 执行页面跳转、交互或 `page-agent` 脚本
3. `console-capture target=page get`
4. 需要时再结合 `debugger.sendCommand`

### 工作流 4：插件侧调试

1. `console-capture target=extension start`
2. 触发插件动作，例如 `browser-agent`、bridge 执行、扩展 UI 行为
3. `console-capture target=extension get`
4. 读取错误级别或关键词过滤结果
5. 结束后 `stop`，需要重置缓冲时再 `clear`

### 工作流 5：页面采集

1. 用 `page-agent` 返回结构化对象
2. 优先返回 `title / url / headings / chunks / links`
3. 正文过长时分块返回
4. 避免一次性返回超长字符串或完整 DOM 快照

### 工作流 6：网络与 CDP 调试

1. 先用页面日志和页面资源时序复现问题
2. 需要更低层时再使用 `browser-agent + debugger.*`
3. 常见方向：
   - `Runtime.*`
   - `Page.*`
   - `Network.*`
4. 配合 `console-capture` 一起看日志与错误
5. 调试结束后主动 `debugger.detach`

## 高频任务模板

详细 JSON 请求体放在 [references/task-templates.md](references/task-templates.md)，需要具体请求体时再读取这个文件。

模板导航：

- Bridge 控制：状态读取、端口配置、连接/断开/重连（无历史记录）
- 标签页与导航：全部标签页、活动标签页、跳转、新开页、刷新、后退、前进、截图
- 页面读取与交互：关键帧确认、摘要提取、页面脚本、点击、输入、提交、滚动、页面路由
- 日志采集：`page` 与 `extension` 的 `start / get / stop / clear`
- CDP 调试：`debugger.attach`、`Runtime.evaluate`、`debugger.detach`
- 网络排查：页面日志、`performance.getEntriesByType('resource')`、可选 `Network.enable`
- 通用请求/响应采集脚本：[`scripts/build-network-capture-command.mjs`](scripts/build-network-capture-command.mjs)

## 函数式脚本入口（推荐）

当任务需要“先触发页面操作，再抓取网络请求并返回结构化请求/响应数据给 `jq` 二次过滤”时，
优先使用：

- [`scripts/build-network-capture-command.mjs`](scripts/build-network-capture-command.mjs)

这个脚本会生成可直接提交到 `/api/agnx-bridge/exec` 的 `page-agent` payload，并统一返回：

- `requests[]`：请求侧规范数据（`requestId/transport/url/method/headers/bodyPreview/timestamp`）
- `responses[]`：响应侧规范数据（`requestId/status/ok/headers/bodyPreview/duration`）

适用场景：

- 不预设只看 `200`，而是先回收完整请求/响应样本，再由用户用 `jq` 过滤。
- 同时兼容 `fetch` 与 `XMLHttpRequest`。
- 需要“点击某按钮后抓取该时段网络数据”的自动化链路。

## Console Capture 说明

### `target=page`

- 基于 `chrome.debugger.attach({ tabId })` 捕获页面 console
- 典型顺序：`start -> 执行动作 -> get -> stop`
- `get` 和 `clear` 读取当前页面缓冲，不会自动开启监听
- 同一时间只会维护一个页面捕获目标
- 适合页面报错、页面日志、自动化步骤诊断

### `target=extension`

- 捕获插件 `background/service worker` 自身的 `console.*`
- 不需要 `tabId`
- 典型顺序：`start -> 触发插件动作 -> get -> stop`
- `start` 之后产生的新日志才会进入缓冲
- 适合 bridge 执行链路和插件逻辑排查

## 页面提取最佳实践

- 优先返回结构化对象，不要一次性返回超长整串文本
- 推荐返回：
  - `title`
  - `url`
  - `headings`
  - `chunks` / `paragraphs`
  - `links`
  - `metadata`
- 不推荐返回：
  - 整篇超长正文拼成单个字符串
  - 大量 `base64` / `data URL`
  - 深层嵌套的完整 DOM 快照

正文过长时，建议分块：

```js
const text = document.body?.innerText ?? ""
const chunks = []
for (let i = 0; i < text.length; i += 800) {
  chunks.push(text.slice(i, i + 800))
}
return { title: document.title, url: location.href, chunks }
```

## 结果约定

`exec.status`：

- `pending`: 已入队，待插件拉取
- `dispatched`: 插件已拉取，执行中
- `succeeded`: 执行成功
- `failed`: 执行失败
- `timeout`: 超时

`exec.result` 截断机制（默认开启）：

- 对超长 JSON 做通用保护，避免单次响应占用过多 token
- 常见场景：
  - `data:*` URL（如 `data:image/...;base64,...`）会被替换为截断占位
  - 超长字符串会保留预览并附带截断占位
  - 过深对象、超长数组、超多键对象会被裁剪

截断占位示例：

- `[TRUNCATED reason=data-url len=182344]`
- `xxx... [TRUNCATED reason=string-length len=9000]`

聊天工具输出外置约定：

- 超过阈值的叶子字符串会被写入工作目录 `.agnx/refs/`
- 主消息里只保留短预览和 `[TRUNCATED_REF manifest="..." first_chunk="..." ...]`
- 需要查看完整内容时，直接用 `Read` 读取对应文件

## 提示词策略模板（可裁剪）

默认（完全暴露）策略：

```md
你可以使用 AGNX Bridge 的全部能力：
- browser-agent：允许调用已暴露的 chrome.* API（按扩展权限生效）
- page-agent：允许页面脚本执行与交互
- console-capture：允许 page/extension 日志采集
- bridge control：允许读取状态、设置端口、连接/断开/重连
禁止使用“历史记录回放”相关描述或调用（该能力已下线）。
```

最小权限策略（示例，按需替换）：

```md
仅允许以下命名空间：
- tabs.query
- tabs.update
- tabs.create
- tabs.captureVisibleTab
- page-agent 只读提取（禁止 click/input/submit）
禁止：
- debugger.*
- downloads.*
- management.*
- bridge control 的 set/connect/disconnect/reconnect（仅允许 get_state）
```

## 注意事项

- AGNX Bridge 扩展 background 必须在线
- `browser-agent` 当前不内置危险 API 拦截，若需限制请在 skill 提示词中声明允许/禁止范围
- `page-agent` 不能在 `chrome://`、`chrome-extension://`、`about:` 等特殊页面执行
- `page-agent` 在页面 Main World 执行，仍可能受目标站点页面环境影响
- 页面 console 采集会附着调试器，浏览器可能显示调试提示条
- 页面 console 采集同一时间只支持一个活动标签页
- 集成验证时，建议先用只读命令，如 `tabs.query`、页面只读提取、`health`
