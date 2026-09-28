#!/usr/bin/env node

import { pathToFileURL } from "node:url"

const DEFAULT_WAIT_MS = 30000
const DEFAULT_PAGE_TIMEOUT_MS = 25000
const DEFAULT_CAPTURE_TIMEOUT_MS = 10000
const DEFAULT_MAX_ENTRIES = 120
const DEFAULT_BODY_PREVIEW_BYTES = 1024

const NETWORK_CAPTURE_CODE = String.raw`const [rawOptions] = args;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function asBool(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeStringArray(input, upper = false) {
  const values = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];

  const normalized = [];
  for (const item of values) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    normalized.push(upper ? trimmed.toUpperCase() : trimmed);
  }
  return normalized;
}

function normalizeOptions(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const trigger = input.trigger && typeof input.trigger === "object" ? input.trigger : {};

  return {
    timeoutMs: clamp(Number(input.timeoutMs ?? 10000), 500, 120000),
    maxEntries: clamp(Number(input.maxEntries ?? 120), 1, 500),
    includeBodyPreview: asBool(input.includeBodyPreview, false),
    bodyPreviewBytes: clamp(Number(input.bodyPreviewBytes ?? 1024), 64, 20000),
    captureAll: asBool(input.captureAll, true),
    stopWhenMatched: asBool(input.stopWhenMatched, false),
    urlIncludes: normalizeStringArray(input.urlIncludes, false),
    methods: normalizeStringArray(input.methods, true),
    trigger: {
      type: typeof trigger.type === "string" ? trigger.type : "none",
      selector: typeof trigger.selector === "string" ? trigger.selector.trim() : "",
      textRegex: typeof trigger.textRegex === "string" ? trigger.textRegex.trim() : "",
      delayMs: clamp(Number(trigger.delayMs ?? 0), 0, 10000),
    },
  };
}

function previewText(value, limit) {
  if (value === undefined || value === null) return null;
  const text = String(value);
  if (text.length <= limit) return text;
  return text.slice(0, limit) + " [TRUNCATED len=" + text.length + "]";
}

function parseHeaderString(raw) {
  if (!raw || typeof raw !== "string") return [];
  const lines = raw.split("\r\n").filter(Boolean);
  const headers = [];
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    headers.push({
      name: line.slice(0, idx).trim(),
      value: line.slice(idx + 1).trim(),
    });
  }
  return headers;
}

function headersToPairs(headersLike) {
  if (!headersLike) return [];
  try {
    if (typeof Headers !== "undefined" && headersLike instanceof Headers) {
      return Array.from(headersLike.entries()).map(([name, value]) => ({ name, value: String(value) }));
    }
  } catch {}

  if (Array.isArray(headersLike)) {
    return headersLike
      .filter((item) => Array.isArray(item) && item.length >= 2)
      .map(([name, value]) => ({ name: String(name), value: String(value) }));
  }

  if (typeof headersLike === "object") {
    return Object.entries(headersLike).map(([name, value]) => ({ name, value: String(value) }));
  }

  return [];
}

function serializeRequestBody(body, limit) {
  try {
    if (body === undefined || body === null) return null;
    if (typeof body === "string") return previewText(body, limit);
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      return previewText(body.toString(), limit);
    }
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      const fields = [];
      for (const [key, value] of body.entries()) {
        fields.push(
          key + "=" + (
            typeof value === "string"
              ? value
              : "[blob size=" + (value?.size ?? "?") + " type=" + (value?.type || "unknown") + "]"
          ),
        );
      }
      return previewText(fields.join("&"), limit);
    }
    if (typeof Blob !== "undefined" && body instanceof Blob) {
      return "[blob size=" + body.size + " type=" + (body.type || "unknown") + "]";
    }
    if (ArrayBuffer.isView(body)) {
      return "[typed-array byteLength=" + body.byteLength + "]";
    }
    if (body instanceof ArrayBuffer) {
      return "[array-buffer byteLength=" + body.byteLength + "]";
    }
    if (typeof body === "object") {
      return previewText(JSON.stringify(body), limit);
    }
    return previewText(String(body), limit);
  } catch (error) {
    return "[serialize-request-body-error] " + (error instanceof Error ? error.message : String(error));
  }
}

async function readFetchResponsePreview(response, includeBodyPreview, limit) {
  if (!includeBodyPreview) return null;
  try {
    const text = await response.clone().text();
    return previewText(text, limit);
  } catch (error) {
    return "[read-response-body-error] " + (error instanceof Error ? error.message : String(error));
  }
}

function shouldMatch(url, method, options) {
  const methodUpper = String(method || "").toUpperCase();
  const methodMatch = options.methods.length === 0 || options.methods.includes(methodUpper);
  const urlText = String(url || "");
  const urlMatch = options.urlIncludes.length === 0
    || options.urlIncludes.some((keyword) => urlText.includes(keyword));
  return methodMatch && urlMatch;
}

function shouldRecord(matched, options) {
  return matched || options.captureAll;
}

function pushLimited(target, item, maxEntries) {
  target.push(item);
  if (target.length > maxEntries) {
    target.splice(0, target.length - maxEntries);
  }
}

function findElementByTextRegex(pattern) {
  if (!pattern) return null;
  let regex;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    return null;
  }
  const candidates = document.querySelectorAll("button, [role='button'], a, [data-testid], [data-test]");
  for (const element of candidates) {
    const text = (element.textContent || "").trim();
    if (text && regex.test(text)) return element;
  }
  return null;
}

async function runTrigger(trigger) {
  if (!trigger || trigger.type === "none") {
    return { type: "none", executed: false };
  }

  if (trigger.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, trigger.delayMs));
  }

  if (trigger.type !== "click") {
    return { type: trigger.type, executed: false, error: "unsupported trigger type" };
  }

  let element = null;
  if (trigger.selector) {
    element = document.querySelector(trigger.selector);
  }
  if (!element && trigger.textRegex) {
    element = findElementByTextRegex(trigger.textRegex);
  }
  if (!(element instanceof HTMLElement)) {
    return { type: "click", executed: false, error: "trigger element not found" };
  }

  element.click();
  return {
    type: "click",
    executed: true,
    selector: trigger.selector || null,
    textRegex: trigger.textRegex || null,
    targetTag: element.tagName,
    targetText: previewText((element.textContent || "").trim(), 120),
  };
}

function toIso(ts) {
  try {
    return new Date(ts).toISOString();
  } catch {
    return null;
  }
}

return await new Promise((resolve) => {
  const options = normalizeOptions(rawOptions);
  const startedAt = Date.now();
  const requests = [];
  const responses = [];
  const errors = [];
  const requestStarts = new Map();
  let sequence = 0;
  let triggerResult = { type: "none", executed: false };
  let finished = false;
  let timeoutTimer = null;

  const originalFetch = window.fetch.bind(window);
  const xhrProto = XMLHttpRequest.prototype;
  const originalXhrOpen = xhrProto.open;
  const originalXhrSend = xhrProto.send;
  const originalXhrSetRequestHeader = xhrProto.setRequestHeader;

  function cleanup() {
    window.fetch = originalFetch;
    xhrProto.open = originalXhrOpen;
    xhrProto.send = originalXhrSend;
    xhrProto.setRequestHeader = originalXhrSetRequestHeader;
    if (timeoutTimer) clearTimeout(timeoutTimer);
  }

  function finish(reason) {
    if (finished) return;
    finished = true;
    cleanup();
    const endedAt = Date.now();
    const matchedResponses = responses.filter((item) => item.matched).length;
    resolve({
      meta: {
        reason,
        startedAt,
        startedAtIso: toIso(startedAt),
        endedAt,
        endedAtIso: toIso(endedAt),
        durationMs: endedAt - startedAt,
        options,
        trigger: triggerResult,
        requestCount: requests.length,
        responseCount: responses.length,
        matchedResponseCount: matchedResponses,
      },
      requests,
      responses,
      errors,
    });
  }

  function nextRequestId(prefix) {
    sequence += 1;
    return prefix + "-" + startedAt + "-" + sequence;
  }

  function maybeStopOnMatch(matched) {
    if (matched && options.stopWhenMatched) {
      finish("matched");
    }
  }

  window.fetch = async function patchedFetch(...fetchArgs) {
    const input = fetchArgs[0];
    const init = fetchArgs[1];
    const requestUrl = typeof input === "string" ? input : (input?.url || "");
    const requestMethod = String(init?.method || input?.method || "GET").toUpperCase();
    const requestHeaders = headersToPairs(init?.headers || input?.headers);
    const requestBodyPreview = serializeRequestBody(init?.body, options.bodyPreviewBytes);
    const requestId = nextRequestId("fetch");
    const requestStartedAt = Date.now();
    const matched = shouldMatch(requestUrl, requestMethod, options);
    requestStarts.set(requestId, requestStartedAt);

    if (shouldRecord(matched, options)) {
      pushLimited(requests, {
        requestId,
        transport: "fetch",
        url: requestUrl,
        method: requestMethod,
        matched,
        requestHeaders,
        requestBodyPreview,
        startedAt: requestStartedAt,
        startedAtIso: toIso(requestStartedAt),
      }, options.maxEntries);
    }

    try {
      const response = await originalFetch(...fetchArgs);
      const responsePreview = await readFetchResponsePreview(response, options.includeBodyPreview, options.bodyPreviewBytes);
      const responseEndedAt = Date.now();

      if (shouldRecord(matched, options)) {
        pushLimited(responses, {
          requestId,
          transport: "fetch",
          url: requestUrl,
          method: requestMethod,
          matched,
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          responseHeaders: headersToPairs(response.headers),
          responseBodyPreview: responsePreview,
          endedAt: responseEndedAt,
          endedAtIso: toIso(responseEndedAt),
          durationMs: responseEndedAt - (requestStarts.get(requestId) || responseEndedAt),
        }, options.maxEntries);
      }
      maybeStopOnMatch(matched);
      return response;
    } catch (error) {
      const responseEndedAt = Date.now();
      if (shouldRecord(matched, options)) {
        pushLimited(responses, {
          requestId,
          transport: "fetch",
          url: requestUrl,
          method: requestMethod,
          matched,
          status: null,
          statusText: null,
          ok: false,
          responseHeaders: [],
          responseBodyPreview: null,
          networkError: error instanceof Error ? error.message : String(error),
          endedAt: responseEndedAt,
          endedAtIso: toIso(responseEndedAt),
          durationMs: responseEndedAt - (requestStarts.get(requestId) || responseEndedAt),
        }, options.maxEntries);
      }
      maybeStopOnMatch(matched);
      throw error;
    } finally {
      requestStarts.delete(requestId);
    }
  };

  xhrProto.open = function patchedOpen(method, url, ...rest) {
    this.__agnxCaptureMethod = String(method || "GET").toUpperCase();
    this.__agnxCaptureUrl = String(url || "");
    this.__agnxCaptureHeaders = [];
    this.__agnxCaptureRequestId = nextRequestId("xhr");
    this.__agnxCaptureMatched = shouldMatch(this.__agnxCaptureUrl, this.__agnxCaptureMethod, options);
    requestStarts.set(this.__agnxCaptureRequestId, Date.now());
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  xhrProto.setRequestHeader = function patchedSetRequestHeader(name, value) {
    try {
      if (Array.isArray(this.__agnxCaptureHeaders)) {
        this.__agnxCaptureHeaders.push({ name: String(name), value: String(value) });
      }
    } catch {}
    return originalXhrSetRequestHeader.call(this, name, value);
  };

  xhrProto.send = function patchedSend(...rest) {
    const requestId = this.__agnxCaptureRequestId || nextRequestId("xhr");
    const requestUrl = this.__agnxCaptureUrl || "";
    const requestMethod = this.__agnxCaptureMethod || "GET";
    const matched = Boolean(this.__agnxCaptureMatched);
    const requestStartedAt = requestStarts.get(requestId) || Date.now();
    const requestBodyPreview = serializeRequestBody(rest[0], options.bodyPreviewBytes);

    if (shouldRecord(matched, options)) {
      pushLimited(requests, {
        requestId,
        transport: "xhr",
        url: requestUrl,
        method: requestMethod,
        matched,
        requestHeaders: Array.isArray(this.__agnxCaptureHeaders) ? this.__agnxCaptureHeaders : [],
        requestBodyPreview,
        startedAt: requestStartedAt,
        startedAtIso: toIso(requestStartedAt),
      }, options.maxEntries);
    }

    this.addEventListener("loadend", () => {
      const responseEndedAt = Date.now();
      if (shouldRecord(matched, options)) {
        const responsePreview = (
          options.includeBodyPreview
            ? previewText(
              typeof this.responseText === "string"
                ? this.responseText
                : "[responseType=" + (this.responseType || "unknown") + "]",
              options.bodyPreviewBytes,
            )
            : null
        );
        pushLimited(responses, {
          requestId,
          transport: "xhr",
          url: requestUrl,
          method: requestMethod,
          matched,
          status: Number.isFinite(this.status) ? this.status : null,
          statusText: typeof this.statusText === "string" ? this.statusText : null,
          ok: this.status >= 200 && this.status < 300,
          responseHeaders: parseHeaderString(this.getAllResponseHeaders?.() || ""),
          responseBodyPreview: responsePreview,
          endedAt: responseEndedAt,
          endedAtIso: toIso(responseEndedAt),
          durationMs: responseEndedAt - requestStartedAt,
        }, options.maxEntries);
      }
      requestStarts.delete(requestId);
      maybeStopOnMatch(matched);
    }, { once: true });

    return originalXhrSend.apply(this, rest);
  };

  timeoutTimer = setTimeout(() => {
    finish("timeout");
  }, options.timeoutMs);

  Promise.resolve()
    .then(() => runTrigger(options.trigger))
    .then((result) => {
      triggerResult = result;
      if (result && result.type !== "none" && !result.executed) {
        errors.push({
          stage: "trigger",
          message: result.error || "trigger not executed",
        });
        finish("trigger-failed");
      }
    })
    .catch((error) => {
      errors.push({
        stage: "trigger",
        message: error instanceof Error ? error.message : String(error),
      });
      finish("trigger-error");
    });
});`

function printHelp() {
  const help = `
用法：
  node scripts/build-network-capture-command.mjs --tab-id 123 [options]

输出：
  默认输出 agnx-bridge /exec 可直接提交的 JSON payload。

关键参数：
  --tab-id <number>                 目标 tabId（必填）
  --wait-ms <number>                /exec waitMs，默认 ${DEFAULT_WAIT_MS}
  --page-timeout-ms <number>        page-agent timeout，默认 ${DEFAULT_PAGE_TIMEOUT_MS}
  --capture-timeout-ms <number>     页面内抓取时长，默认 ${DEFAULT_CAPTURE_TIMEOUT_MS}
  --url-includes <a,b,c>            URL 关键字过滤（可选）
  --methods <GET,POST>              方法过滤（可选）
  --capture-all <true|false>        是否保留未命中过滤条件的数据，默认 true
  --max-entries <number>            requests/responses 最大条目，默认 ${DEFAULT_MAX_ENTRIES}
  --include-body-preview <true|false>  是否抓 body 预览，默认 false
  --body-preview-bytes <number>     body 预览长度，默认 ${DEFAULT_BODY_PREVIEW_BYTES}
  --stop-when-matched <true|false>  命中过滤条件后立即返回，默认 false
  --click-selector <css>            触发动作：点击 selector 命中元素
  --click-text-regex <regex>        触发动作：按文本正则匹配按钮
  --trigger-delay-ms <number>       执行触发动作前延迟，默认 0
  --output <payload|code|options>   输出类型，默认 payload
  --pretty <true|false>             是否格式化 JSON，默认 true
  --help                            显示帮助
`.trim()
  console.log(help)
}

function readFlagMap(argv) {
  const map = new Map()
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith("--")) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith("--")) {
      map.set(key, "true")
      continue
    }
    map.set(key, next)
    i += 1
  }
  return map
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return fallback
}

function parseInteger(value, fallback, min, max) {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function splitList(value, upper = false) {
  if (value === undefined) return []
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (upper ? item.toUpperCase() : item))
}

function buildCaptureOptions(input) {
  const options = {
    timeoutMs: parseInteger(input.get("capture-timeout-ms"), DEFAULT_CAPTURE_TIMEOUT_MS, 500, 120000),
    maxEntries: parseInteger(input.get("max-entries"), DEFAULT_MAX_ENTRIES, 1, 500),
    includeBodyPreview: parseBoolean(input.get("include-body-preview"), false),
    bodyPreviewBytes: parseInteger(input.get("body-preview-bytes"), DEFAULT_BODY_PREVIEW_BYTES, 64, 20000),
    captureAll: parseBoolean(input.get("capture-all"), true),
    stopWhenMatched: parseBoolean(input.get("stop-when-matched"), false),
    urlIncludes: splitList(input.get("url-includes"), false),
    methods: splitList(input.get("methods"), true),
    trigger: {
      type: "none",
      selector: "",
      textRegex: "",
      delayMs: parseInteger(input.get("trigger-delay-ms"), 0, 0, 10000),
    },
  }

  const selector = (input.get("click-selector") || "").trim()
  const textRegex = (input.get("click-text-regex") || "").trim()
  if (selector || textRegex) {
    options.trigger = {
      type: "click",
      selector,
      textRegex,
      delayMs: options.trigger.delayMs,
    }
  }

  return options
}

export function buildNetworkCaptureCommand({
  tabId,
  waitMs = DEFAULT_WAIT_MS,
  pageTimeoutMs = DEFAULT_PAGE_TIMEOUT_MS,
  captureOptions = {},
} = {}) {
  const normalizedTabId = Number.parseInt(String(tabId), 10)
  if (!Number.isFinite(normalizedTabId) || normalizedTabId <= 0) {
    throw new Error("tabId 非法，必须是正整数")
  }

  return {
    waitMs: parseInteger(waitMs, DEFAULT_WAIT_MS, 1000, 120000),
    command: {
      kind: "page-agent",
      tabId: normalizedTabId,
      args: [captureOptions],
      timeout: parseInteger(pageTimeoutMs, DEFAULT_PAGE_TIMEOUT_MS, 1000, 120000),
      code: NETWORK_CAPTURE_CODE,
    },
  }
}

function main() {
  const flags = readFlagMap(process.argv.slice(2))

  if (flags.has("help")) {
    printHelp()
    return
  }

  const tabIdRaw = flags.get("tab-id")
  if (!tabIdRaw) {
    throw new Error("缺少必填参数 --tab-id")
  }

  const captureOptions = buildCaptureOptions(flags)
  const payload = buildNetworkCaptureCommand({
    tabId: tabIdRaw,
    waitMs: flags.get("wait-ms"),
    pageTimeoutMs: flags.get("page-timeout-ms"),
    captureOptions,
  })

  const output = (flags.get("output") || "payload").trim()
  const pretty = parseBoolean(flags.get("pretty"), true)

  if (output === "code") {
    console.log(NETWORK_CAPTURE_CODE)
    return
  }

  if (output === "options") {
    console.log(JSON.stringify(captureOptions, null, pretty ? 2 : 0))
    return
  }

  if (output === "payload") {
    console.log(JSON.stringify(payload, null, pretty ? 2 : 0))
    return
  }

  throw new Error(`不支持的输出类型: ${output}`)
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : ""
if (entryUrl === import.meta.url) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
