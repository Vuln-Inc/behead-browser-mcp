#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { BeheadRuntime } from "./runtime.mjs"
import { schema, serve, text } from "./protocol.mjs"

const runtime = new BeheadRuntime()
const str = (description) => ({ type: "string", description })
const int = (description) => ({ type: "integer", description })
const bool = (description) => ({ type: "boolean", description })

const tools = [
  ["behead_devtools_list_pages", "List Behead Browser pages.", schema()],
  ["behead_devtools_new_page", "Open a new Behead Browser page.", schema({ url: str("URL"), background: bool("Do not focus") }, ["url"])],
  ["behead_devtools_select_page", "Select a page.", schema({ pageId: int("Page ID"), bringToFront: bool("Focus page") }, ["pageId"])],
  ["behead_devtools_close_page", "Close a page.", schema({ pageId: int("Page ID") }, ["pageId"])],
  ["behead_devtools_navigate_page", "Navigate, reload, go back, or go forward.", schema({ pageId: int("Page ID"), type: str("url, reload, back, or forward"), url: str("URL"), timeout: int("Timeout ms") })],
  ["behead_devtools_wait_for", "Wait for any supplied text.", schema({ pageId: int("Page ID"), text: { type: "array", items: { type: "string" } }, timeout: int("Timeout ms") }, ["text"])],
  ["behead_devtools_take_snapshot", "Capture ARIA and DOM snapshots with element UIDs.", schema({ pageId: int("Page ID"), verbose: bool("Include hidden nodes"), filePath: str("Output path") })],
  ["behead_devtools_take_screenshot", "Capture a page or element screenshot.", schema({ pageId: int("Page ID"), uid: str("Element UID"), selector: str("CSS selector"), filePath: str("Output path"), format: str("png, jpeg, webp"), quality: int("Quality"), fullPage: bool("Full page") })],
  ["behead_devtools_click", "Click an element.", schema({ pageId: int("Page ID"), uid: str("Element UID"), selector: str("CSS selector"), dblClick: bool("Double click"), button: str("Mouse button") })],
  ["behead_devtools_hover", "Hover an element.", schema({ pageId: int("Page ID"), uid: str("Element UID"), selector: str("CSS selector") })],
  ["behead_devtools_fill", "Fill an input, select, checkbox, or radio.", schema({ pageId: int("Page ID"), uid: str("Element UID"), selector: str("CSS selector"), value: str("Value") }, ["value"])],
  ["behead_devtools_fill_form", "Fill multiple controls.", schema({
    pageId: int("Page ID"),
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: { uid: { type: "string" }, selector: { type: "string" }, value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
    },
  }, ["elements"])],
  ["behead_devtools_type_text", "Type into the focused element.", schema({ pageId: int("Page ID"), text: str("Text"), submitKey: str("Optional submit key") }, ["text"])],
  ["behead_devtools_press_key", "Press a keyboard key or chord.", schema({ pageId: int("Page ID"), key: str("Key") }, ["key"])],
  ["behead_devtools_drag", "Drag one element onto another.", schema({ pageId: int("Page ID"), from_uid: str("Source UID"), to_uid: str("Target UID") }, ["from_uid", "to_uid"])],
  ["behead_devtools_upload_file", "Upload files.", schema({ pageId: int("Page ID"), uid: str("Element UID"), selector: str("CSS selector"), filePaths: { type: "array", items: { type: "string" } } }, ["filePaths"])],
  ["behead_devtools_handle_dialog", "Accept or dismiss a dialog.", schema({ action: str("accept or dismiss"), promptText: str("Prompt response") }, ["action"])],
  ["behead_devtools_resize_page", "Resize the viewport.", schema({ pageId: int("Page ID"), width: int("Width"), height: int("Height") }, ["width", "height"])],
  ["behead_devtools_emulate", "Apply media, geolocation, headers, network, CPU, and viewport emulation.", schema({ pageId: int("Page ID"), colorScheme: str("dark, light, auto"), reducedMotion: str("reduce or no-preference"), geolocation: str("latitude,longitude"), extraHttpHeaders: str("JSON object"), offline: bool("Offline"), cpuThrottlingRate: { type: "number" }, viewport: str("WIDTHxHEIGHT") })],
  ["behead_devtools_evaluate_script", "Evaluate JavaScript.", schema({ pageId: int("Page ID"), function: str("Function or expression"), args: { type: "array" }, filePath: str("Output path") }, ["function"])],
  ["behead_devtools_list_console_messages", "List console and page errors.", schema({ pageId: int("Page ID"), types: { type: "array", items: { type: "string" } }, pageIdx: int("Page index"), pageSize: int("Page size") })],
  ["behead_devtools_get_console_message", "Get one console message.", schema({ msgid: int("Message ID") }, ["msgid"])],
  ["behead_devtools_list_network_requests", "List requests and responses.", schema({ pageId: int("Page ID"), resourceTypes: { type: "array", items: { type: "string" } }, pageIdx: int("Page index"), pageSize: int("Page size") })],
  ["behead_devtools_get_network_request", "Get full request and response details.", schema({ reqid: int("Request ID"), requestFilePath: str("Request body output"), responseFilePath: str("Response body output") }, ["reqid"])],
  ["behead_devtools_get_css_styles", "Get computed CSS styles.", schema({ pageId: int("Page ID"), uid: str("Element UID"), selector: str("CSS selector") })],
  ["behead_devtools_performance_start_trace", "Start a browser trace.", schema({ pageId: int("Page ID"), reload: bool("Reload page"), screenshots: bool("Capture screenshots") })],
  ["behead_devtools_performance_stop_trace", "Stop and save the trace.", schema({ filePath: str("Trace zip path") })],
  ["behead_devtools_performance_metrics", "Read Chrome Performance metrics.", schema({ pageId: int("Page ID") })],
  ["behead_devtools_take_heapsnapshot", "Capture a V8 heap snapshot.", schema({ pageId: int("Page ID"), filePath: str("Heap snapshot path") }, ["filePath"])],
  ["behead_devtools_cdp", "Send any Chrome DevTools Protocol command.", schema({ pageId: int("Page ID"), method: str("CDP method"), params: { type: "object" } }, ["method"])],
  ["behead_devtools_close", "Close Behead DevTools.", schema()],
].map(([name, description, inputSchema]) => ({ name, description, inputSchema }))

async function snapshot(page, verbose) {
  runtime.uidSelectors.clear()
  const elements = await page.locator("body *").evaluateAll((nodes, includeHidden) => nodes.flatMap((element) => {
    const style = getComputedStyle(element)
    if (!includeHidden && (style.display === "none" || style.visibility === "hidden")) return []
    const parts = []
    let current = element
    while (current && current !== document.body) {
      let part = current.tagName.toLowerCase()
      if (current.id) { parts.unshift(`#${CSS.escape(current.id)}`); break }
      const siblings = current.parentElement ? [...current.parentElement.children].filter((item) => item.tagName === current.tagName) : []
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
      parts.unshift(part)
      current = current.parentElement
    }
    const selector = parts[0]?.startsWith("#") ? parts.join(" > ") : `body > ${parts.join(" > ")}`
    const name = element.getAttribute("aria-label") || element.getAttribute("alt") || element.getAttribute("title") || element.textContent?.trim().replace(/\s+/g, " ").slice(0, 160) || ""
    return [{ selector, role: element.getAttribute("role") || element.tagName.toLowerCase(), name }]
  }), verbose)
  const lines = elements.map((element, index) => {
    const uid = `e${index + 1}`
    runtime.uidSelectors.set(uid, element.selector)
    return `[uid=${uid}] ${element.role}${element.name ? ` "${element.name}"` : ""}`
  })
  return `${await page.locator("body").ariaSnapshot()}\n\n${lines.join("\n")}`
}

const paginate = (items, pageIdx = 0, pageSize = 50) => items.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize)

async function callTool(name, args) {
  if (name === "behead_devtools_close") { await runtime.close(); return text("behead devtools closed") }
  await runtime.ensure()
  if (name === "behead_devtools_list_pages") return text(await Promise.all([...runtime.pages].map(async ([id, page]) => ({ id, selected: id === runtime.selectedPageId, url: page.url(), title: await page.title() }))))
  if (name === "behead_devtools_new_page") { const page = await runtime.session.newPage(); const id = runtime.addPage(page); await runtime.enableDevtools(id); await page.goto(args.url, { waitUntil: "domcontentloaded" }); if (!args.background) await page.bringToFront(); return text({ id, url: page.url(), title: await page.title() }) }
  if (name === "behead_devtools_select_page") { const page = runtime.page(args.pageId); runtime.selectedPageId = args.pageId; if (args.bringToFront) await page.bringToFront(); return text(`selected page ${args.pageId}`) }
  if (name === "behead_devtools_close_page") { const page = runtime.page(args.pageId); if (runtime.pages.size === 1) throw new Error("cannot close the last page"); await page.close(); runtime.pages.delete(args.pageId); runtime.selectedPageId = runtime.pages.keys().next().value; return text("closed") }
  const page = runtime.page(args.pageId)
  await runtime.enableDevtools(args.pageId || runtime.selectedPageId)

  switch (name) {
    case "behead_devtools_navigate_page": { const type = args.type || "url"; if (type === "reload") await page.reload({ waitUntil: "domcontentloaded", timeout: args.timeout }); else if (type === "back") await page.goBack({ waitUntil: "domcontentloaded", timeout: args.timeout }); else if (type === "forward") await page.goForward({ waitUntil: "domcontentloaded", timeout: args.timeout }); else await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: args.timeout }); return text({ url: page.url(), title: await page.title() }) }
    case "behead_devtools_wait_for": await Promise.any(args.text.map((value) => page.getByText(value).first().waitFor({ timeout: args.timeout || 30000 }))); return text("text found")
    case "behead_devtools_take_snapshot": { const output = await snapshot(page, args.verbose); if (args.filePath) { const path = resolve(args.filePath); await mkdir(dirname(path), { recursive: true }); await writeFile(path, output); return text(path) } return text(output) }
    case "behead_devtools_take_screenshot": { const target = args.uid || args.selector ? runtime.target(page, args) : page; const format = args.format || "png"; const path = resolve(args.filePath || `/tmp/behead-devtools.${format}`); await mkdir(dirname(path), { recursive: true }); const options = { path, type: format, quality: format === "png" ? undefined : args.quality }; if (!(args.uid || args.selector)) options.fullPage = args.fullPage; const data = await target.screenshot(options); return { content: [{ type: "text", text: path }, { type: "image", data: data.toString("base64"), mimeType: `image/${format}` }] } }
    case "behead_devtools_click": await runtime.target(page, args).click({ button: args.button || "left", clickCount: args.dblClick ? 2 : 1 }); return text("clicked")
    case "behead_devtools_hover": await runtime.target(page, args).hover(); return text("hovered")
    case "behead_devtools_fill": { const locator = runtime.target(page, args); const type = await locator.getAttribute("type"); if (["checkbox", "radio"].includes(type)) await locator.setChecked(args.value === "true"); else if ((await locator.evaluate((element) => element.tagName)) === "SELECT") await locator.selectOption({ label: args.value }).catch(() => locator.selectOption(args.value)); else await locator.fill(args.value); return text("filled") }
    case "behead_devtools_fill_form": for (const element of args.elements) await callTool("behead_devtools_fill", { ...element, pageId: args.pageId }); return text("form filled")
    case "behead_devtools_type_text": await page.keyboard.type(args.text); if (args.submitKey) await page.keyboard.press(args.submitKey); return text("typed")
    case "behead_devtools_press_key": await page.keyboard.press(args.key); return text("pressed")
    case "behead_devtools_drag": await runtime.target(page, { uid: args.from_uid }).dragTo(runtime.target(page, { uid: args.to_uid })); return text("dragged")
    case "behead_devtools_upload_file": await runtime.target(page, args).setInputFiles(args.filePaths); return text("uploaded")
    case "behead_devtools_handle_dialog": if (!runtime.pendingDialog) throw new Error("no dialog is open"); if (args.action === "accept") await runtime.pendingDialog.accept(args.promptText); else await runtime.pendingDialog.dismiss(); runtime.pendingDialog = undefined; return text("dialog handled")
    case "behead_devtools_resize_page": await page.setViewportSize({ width: args.width, height: args.height }); return text("resized")
    case "behead_devtools_emulate": { if (args.colorScheme || args.reducedMotion) await page.emulateMedia({ colorScheme: args.colorScheme === "auto" ? null : args.colorScheme, reducedMotion: args.reducedMotion }); if (args.geolocation) { const [latitude, longitude] = args.geolocation.split(",").map(Number); await runtime.session.context.setGeolocation({ latitude, longitude }); await runtime.session.context.grantPermissions(["geolocation"]) } if (args.extraHttpHeaders !== undefined) await runtime.session.context.setExtraHTTPHeaders(args.extraHttpHeaders ? JSON.parse(args.extraHttpHeaders) : {}); if (args.viewport) { const [width, height] = args.viewport.split("x").map(Number); await page.setViewportSize({ width, height }) } if (args.offline !== undefined) await runtime.cdp(page, "Network.emulateNetworkConditions", { offline: args.offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); if (args.cpuThrottlingRate) await runtime.cdp(page, "Emulation.setCPUThrottlingRate", { rate: args.cpuThrottlingRate }); return text("emulation applied") }
    case "behead_devtools_evaluate_script": {
      const source = args.function.trim()
      const result = source.startsWith("(") || source.startsWith("async") || source.startsWith("function")
        ? await page.evaluate(({ source, values }) => globalThis.eval(`(${source})`)(...values), { source, values: args.args || [] })
        : await page.evaluate((value) => globalThis.eval(value), source)
      await page.waitForTimeout(0)
      if (args.filePath) {
        const path = resolve(args.filePath)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, JSON.stringify(result, null, 2))
        return text(path)
      }
      return text(result)
    }
    case "behead_devtools_list_console_messages": { let records = runtime.consoleMessages.filter((item) => item.pageId === (args.pageId || runtime.selectedPageId)); if (args.types?.length) records = records.filter((item) => args.types.includes(item.type)); return text(paginate(records, args.pageIdx, args.pageSize)) }
    case "behead_devtools_get_console_message": return text(runtime.consoleMessages.find((item) => item.id === args.msgid) || null)
    case "behead_devtools_list_network_requests": {
      let records = runtime.networkRequests.filter((item) => item.pageId === (args.pageId || runtime.selectedPageId))
      if (args.resourceTypes?.length) records = records.filter((item) => args.resourceTypes.includes(item.resourceType))
      return text(paginate(records, args.pageIdx, args.pageSize).map(({ request, response, ...record }) => ({
        ...record,
        status: typeof response?.status === "function" ? response.status() : response?.status,
      })))
    }
    case "behead_devtools_get_network_request": {
      const record = runtime.networkRequests.find((item) => item.id === args.reqid)
      if (!record) throw new Error(`unknown request: ${args.reqid}`)
      let responseBody = ""
      if (record.cdpRequestId && record.response) {
        const client = runtime.devtoolsClients.get(record.pageId)
        responseBody = await client.send("Network.getResponseBody", { requestId: record.cdpRequestId }).then((result) => result.base64Encoded ? Buffer.from(result.body, "base64").toString("utf8") : result.body).catch(() => "")
      } else if (record.response) {
        responseBody = await record.response.body().then((body) => body.toString("utf8")).catch(() => "")
      }
      if (args.requestFilePath) await writeFile(resolve(args.requestFilePath), record.postData || "")
      if (args.responseFilePath) await writeFile(resolve(args.responseFilePath), responseBody)
      const response = record.response
      return text({
        id: record.id,
        method: record.method,
        url: record.url,
        resourceType: record.resourceType,
        requestHeaders: record.requestHeaders,
        postData: args.requestFilePath || record.postData,
        status: typeof response?.status === "function" ? response.status() : response?.status,
        statusText: typeof response?.statusText === "function" ? response.statusText() : response?.statusText,
        responseHeaders: typeof response?.headers === "function" ? response.headers() : response?.headers,
        responseBody: args.responseFilePath || responseBody,
      })
    }
    case "behead_devtools_get_css_styles": { const selector = args.selector || runtime.uidSelectors.get(args.uid); if (!selector) throw new Error("provide a valid UID or selector"); return text({ selector, computed: await page.locator(selector).evaluate((element) => Object.fromEntries([...getComputedStyle(element)].map((name) => [name, getComputedStyle(element).getPropertyValue(name)]))) }) }
    case "behead_devtools_performance_start_trace": if (runtime.tracing) throw new Error("trace already active"); await runtime.session.context.tracing.start({ screenshots: args.screenshots ?? true, snapshots: true, sources: true }); runtime.tracing = true; if (args.reload) await page.reload({ waitUntil: "networkidle" }); return text("trace started")
    case "behead_devtools_performance_stop_trace": { if (!runtime.tracing) throw new Error("no trace is active"); const path = resolve(args.filePath || "/tmp/behead-trace.zip"); await mkdir(dirname(path), { recursive: true }); await runtime.session.context.tracing.stop({ path }); runtime.tracing = false; return text(path) }
    case "behead_devtools_performance_metrics": await runtime.cdp(page, "Performance.enable"); return text(await runtime.cdp(page, "Performance.getMetrics"))
    case "behead_devtools_take_heapsnapshot": { const path = resolve(args.filePath); await mkdir(dirname(path), { recursive: true }); const client = await page.context().newCDPSession(page); const chunks = []; client.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) => chunks.push(chunk)); await client.send("HeapProfiler.enable"); await client.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: true }); await writeFile(path, chunks.join("")); await client.detach(); return text(path) }
    case "behead_devtools_cdp": return text(await runtime.cdp(page, args.method, args.params || {}))
    default: throw new Error(`unknown tool: ${name}`)
  }
}

serve({ name: "behead-browser-devtools", tools, callTool, close: () => runtime.close() })
