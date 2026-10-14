#!/usr/bin/env node

import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { BeheadRuntime } from "./runtime.mjs"
import { schema, serve, text } from "./protocol.mjs"

const runtime = new BeheadRuntime()
const str = (description) => ({ type: "string", description })
const bool = (description) => ({ type: "boolean", description })
const tools = [
  ["behead_browser_navigate", "Open a URL in Behead Browser.", schema({ url: str("URL") }, ["url"])],
  ["behead_browser_snapshot", "Return an ARIA snapshot and page metadata.", schema()],
  ["behead_browser_click", "Click a CSS selector.", schema({ selector: str("CSS selector"), dblClick: bool("Double click") }, ["selector"])],
  ["behead_browser_hover", "Hover a CSS selector.", schema({ selector: str("CSS selector") }, ["selector"])],
  ["behead_browser_fill", "Fill an input or select.", schema({ selector: str("CSS selector"), value: str("Value") }, ["selector", "value"])],
  ["behead_browser_type", "Type text into an element.", schema({ selector: str("CSS selector"), text: str("Text") }, ["selector", "text"])],
  ["behead_browser_press", "Press a keyboard key or chord.", schema({ key: str("Key") }, ["key"])],
  ["behead_browser_evaluate", "Evaluate JavaScript in the page.", schema({ expression: str("JavaScript expression") }, ["expression"])],
  ["behead_browser_screenshot", "Capture a screenshot.", schema({ path: str("Output path"), fullPage: bool("Capture full page") })],
  ["behead_browser_cookies", "Return session cookies.", schema()],
  ["behead_browser_network_requests", "Return observed requests.", schema()],
  ["behead_browser_close", "Close Behead Browser.", schema()],
].map(([name, description, inputSchema]) => ({ name, description, inputSchema }))

async function callTool(name, args) {
  if (name === "behead_browser_close") {
    await runtime.close()
    return text("behead browser closed")
  }
  await runtime.ensure()
  const page = runtime.page()
  switch (name) {
    case "behead_browser_navigate":
      await page.goto(args.url, { waitUntil: "domcontentloaded" })
      return text({ url: page.url(), title: await page.title() })
    case "behead_browser_snapshot":
      return text({ url: page.url(), title: await page.title(), aria: await page.locator("body").ariaSnapshot() })
    case "behead_browser_click":
      await page.locator(args.selector).click({ clickCount: args.dblClick ? 2 : 1 })
      return text("clicked")
    case "behead_browser_hover":
      await page.locator(args.selector).hover()
      return text("hovered")
    case "behead_browser_fill": {
      const locator = page.locator(args.selector)
      if ((await locator.evaluate((element) => element.tagName)) === "SELECT") {
        await locator.selectOption({ label: args.value }).catch(() => locator.selectOption(args.value))
      } else {
        await locator.fill(args.value)
      }
      return text("filled")
    }
    case "behead_browser_type":
      await page.locator(args.selector).pressSequentially(args.text)
      return text("typed")
    case "behead_browser_press":
      await page.keyboard.press(args.key)
      return text("pressed")
    case "behead_browser_evaluate":
      return text(await page.evaluate((expression) => globalThis.eval(expression), args.expression))
    case "behead_browser_screenshot": {
      const path = resolve(args.path || "/tmp/behead-browser.png")
      await mkdir(dirname(path), { recursive: true })
      const data = await page.screenshot({ path, fullPage: args.fullPage ?? false })
      return { content: [{ type: "text", text: path }, { type: "image", data: data.toString("base64"), mimeType: "image/png" }] }
    }
    case "behead_browser_cookies":
      return text(await runtime.session.context.cookies())
    case "behead_browser_network_requests":
      return text(runtime.networkRequests.map(({ request, response, ...record }) => ({ ...record, status: response?.status() })))
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}

serve({ name: "behead-browser", tools, callTool, close: () => runtime.close() })
