# AGNX Bridge Task Templates

在 [../SKILL.md](../SKILL.md) 的统一 shell 模板基础上，把下面任一 JSON 请求体替换进 `<JSON_BODY>` 即可。

## 目录

- Bridge 控制（端口/连接）
- 标签页与导航
- 页面读取与交互
- 页面与插件日志
- CDP 与网络

## Bridge 控制（端口/连接）

以下模板用于扩展内部控制通道（`chrome.runtime.sendMessage`），不经过 `/api/agnx-bridge/exec`。

### 读取当前状态

```json
{
  "type": "BRIDGE_CONTROL_GET_STATE"
}
```

### 更新端口配置

```json
{
  "type": "BRIDGE_CONTROL_SET_CONFIG",
  "config": {
    "port": 3054
  }
}
```

### 建立连接

```json
{
  "type": "BRIDGE_CONTROL_CONNECT"
}
```

### 断开连接

```json
{
  "type": "BRIDGE_CONTROL_DISCONNECT"
}
```

### 重连

```json
{
  "type": "BRIDGE_CONTROL_RECONNECT"
}
```

说明：

- 该控制通道只返回当前快照，不提供历史记录。
- 控制入口已在扩展 popup 按钮组中实现，可直接通过 UI 操作。

## 标签页与导航

### 获取全部标签页

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "browser-agent",
    "method": "tabs.query",
    "args": [{}]
  }
}
```

### 获取当前活动标签页

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "browser-agent",
    "method": "tabs.query",
    "args": [{ "active": true, "currentWindow": true }]
  }
}
```

### 页面跳转

```json
{
  "waitMs": 30000,
  "command": {
    "kind": "browser-agent",
    "method": "tabs.update",
    "args": [123, { "url": "https://example.com" }]
  }
}
```

### 打开新页面

```json
{
  "waitMs": 30000,
  "command": {
    "kind": "browser-agent",
    "method": "tabs.create",
    "args": [{ "url": "https://example.com" }]
  }
}
```

### 刷新当前页面

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "browser-agent",
    "method": "tabs.reload",
    "args": [123]
  }
}
```

### 后退

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "browser-agent",
    "method": "tabs.goBack",
    "args": [123]
  }
}
```

### 前进

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "browser-agent",
    "method": "tabs.goForward",
    "args": [123]
  }
}
```

### 页面截图

```json
{
  "waitMs": 30000,
  "command": {
    "kind": "browser-agent",
    "method": "tabs.captureVisibleTab",
    "args": [null, { "format": "png" }]
  }
}
```

## 页面读取与交互

### 导航后关键帧确认

```json
{
  "waitMs": 30000,
  "command": {
    "kind": "page-agent",
    "tabId": 123,
    "args": ["main, [role=main], h1"],
    "code": "const [selector] = args; const el = document.querySelector(selector); return { title: document.title, url: location.href, readyState: document.readyState, found: !!el, preview: el?.textContent?.trim().slice(0, 160) ?? null, viewport: { width: window.innerWidth, height: window.innerHeight } };",
    "timeout": 15000
  }
}
```

### 页面摘要提取

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "page-agent",
    "tabId": 123,
    "code": "const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 20).map(el => el.textContent?.trim()).filter(Boolean); const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 20).map(a => ({ text: a.textContent?.trim() ?? '', href: a.href })); const text = document.body?.innerText?.replace(/\\s+/g, ' ').trim() ?? ''; return { title: document.title, url: location.href, headings, links, textPreview: text.slice(0, 1200) };",
    "timeout": 20000
  }
}
```

### 页面内执行脚本

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "page-agent",
    "tabId": 123,
    "code": "return { url: location.href, hasDialog: !!document.querySelector('dialog,[role=dialog]'), activeElement: document.activeElement?.tagName ?? null };",
    "timeout": 15000
  }
}
```

### 点击元素

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "page-agent",
    "tabId": 123,
    "args": ["button[type=submit]"],
    "code": "const [selector] = args; const el = document.querySelector(selector); if (!(el instanceof HTMLElement)) throw new Error('Element not found: ' + selector); el.click(); return { clicked: true, selector, tagName: el.tagName };",
    "timeout": 15000
  }
}
```

### 输入文本

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "page-agent",
    "tabId": 123,
    "args": ["input[name=email]", "user@example.com"],
    "code": "const [selector, value] = args; const el = document.querySelector(selector); if (!el) throw new Error('Element not found: ' + selector); if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) { el.focus(); el.value = String(value ?? ''); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { filled: true, selector, valueLength: el.value.length, kind: el.tagName.toLowerCase() }; } if (el instanceof HTMLElement && el.isContentEditable) { el.focus(); el.textContent = String(value ?? ''); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { filled: true, selector, valueLength: el.textContent?.length ?? 0, kind: 'contenteditable' }; } throw new Error('Target is not an input, textarea, or contenteditable element');",
    "timeout": 15000
  }
}
```

### 表单提交

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "page-agent",
    "tabId": 123,
    "args": ["form"],
    "code": "const [selector] = args; const target = selector ? document.querySelector(selector) : document.querySelector('form'); if (!(target instanceof HTMLFormElement)) throw new Error('Form not found'); target.requestSubmit(); return { submitted: true, action: target.action || location.href, method: (target.method || 'get').toUpperCase() };",
    "timeout": 15000
  }
}
```

### 页面滚动

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "page-agent",
    "tabId": 123,
    "args": [1200, "smooth"],
    "code": "const [top, behavior] = args; window.scrollTo({ top: Number(top ?? 0), behavior: behavior === 'smooth' ? 'smooth' : 'auto' }); return { scrollY: window.scrollY, viewportHeight: window.innerHeight };",
    "timeout": 15000
  }
}
```

### 页面内路由跳转

如果站点暴露全局 router，优先直接调用站点自身路由 API；通用场景可用：

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "page-agent",
    "tabId": 123,
    "args": ["/dashboard"],
    "code": "const [url] = args; const before = location.href; history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')); return { before, after: location.href };",
    "timeout": 15000
  }
}
```

## 页面与插件日志

日志采集是显式开启的。要拿新增日志，先 `start`；`get` 只读取当前缓冲。

### 开始监听页面 console

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "console-capture",
    "target": "page",
    "action": "start",
    "tabId": 123
  }
}
```

### 读取页面错误与警告

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "console-capture",
    "target": "page",
    "action": "get",
    "filter": {
      "levels": ["error", "warn"],
      "limit": 100
    }
  }
}
```

### 停止监听页面 console

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "console-capture",
    "target": "page",
    "action": "stop",
    "tabId": 123
  }
}
```

### 清空页面日志缓冲

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "console-capture",
    "target": "page",
    "action": "clear"
  }
}
```

### 开始采集插件自身日志

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "console-capture",
    "target": "extension",
    "action": "start"
  }
}
```

### 读取插件错误日志

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "console-capture",
    "target": "extension",
    "action": "get",
    "filter": {
      "levels": ["error"],
      "limit": 100
    }
  }
}
```

### 停止采集插件日志

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "console-capture",
    "target": "extension",
    "action": "stop"
  }
}
```

### 清空插件日志缓冲

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "console-capture",
    "target": "extension",
    "action": "clear"
  }
}
```

## CDP 与网络

### 附着调试器

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "browser-agent",
    "method": "debugger.attach",
    "args": [
      { "tabId": 123 },
      "1.3"
    ]
  }
}
```

### 执行 `Runtime.evaluate`

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "browser-agent",
    "method": "debugger.sendCommand",
    "args": [
      { "tabId": 123 },
      "Runtime.evaluate",
      {
        "expression": "document.title",
        "returnByValue": true
      }
    ]
  }
}
```

### 释放调试器

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "browser-agent",
    "method": "debugger.detach",
    "args": [
      { "tabId": 123 }
    ]
  }
}
```

### 读取页面资源时序

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "page-agent",
    "tabId": 123,
    "code": "const entries = performance.getEntriesByType('resource').slice(-50).map(entry => ({ name: entry.name, initiatorType: entry.initiatorType, duration: Math.round(entry.duration), transferSize: 'transferSize' in entry ? entry.transferSize : undefined, nextHopProtocol: 'nextHopProtocol' in entry ? entry.nextHopProtocol : undefined })); return { url: location.href, entries };",
    "timeout": 15000
  }
}
```

### 启用 CDP 网络域

```json
{
  "waitMs": 20000,
  "command": {
    "kind": "browser-agent",
    "method": "debugger.sendCommand",
    "args": [
      { "tabId": 123 },
      "Network.enable",
      {}
    ]
  }
}
```

### 通用请求/响应双数据采集（函数脚本）

当你需要先采集完整网络样本（而不是只断言状态码）时，优先走脚本化入口：

```bash
# 1) 先拿到活动标签页 tabId
BASE=http://localhost:3054/api/agnx-bridge
TAB_ID=$(curl -sS -X POST "$BASE/exec" \
  -H 'Content-Type: application/json' \
  -d '{"waitMs":20000,"command":{"kind":"browser-agent","method":"tabs.query","args":[{"active":true,"currentWindow":true}]}}' \
  | jq -r '.data.exec.result[0].id')

# 2) 生成 payload（像“调用函数”一样传参）
PAYLOAD=$(node skills/agnx-bridge/scripts/build-network-capture-command.mjs \
  --tab-id "$TAB_ID" \
  --click-selector '[data-testid="add-user"]' \
  --click-text-regex '新增用户|Add User' \
  --url-includes '/api/user' \
  --methods 'POST,PUT' \
  --capture-timeout-ms 12000 \
  --capture-all true \
  --include-body-preview false \
  --output payload \
  --pretty false)

# 3) 执行并取 requests/responses 两套数据
curl -sS -X POST "$BASE/exec" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD" \
  | jq '.data.exec.result | { meta, requests, responses }'
```

常见二次过滤（`jq`）：

```bash
# 仅看目标接口非 2xx 的响应
... | jq '.responses[] | select((.url|contains("/api/user")) and (.ok == false))'

# 仅看 POST 请求及其对应响应
... | jq '{ requests: [.requests[] | select(.method=="POST")], responses: [.responses[] | select(.method=="POST")] }'
```
