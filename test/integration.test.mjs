import assert from "node:assert/strict"
import { stat } from "node:fs/promises"
import test from "node:test"
import { withServer } from "./helpers.mjs"

const integration = process.env.BEHEAD_BROWSER_MODULE ? test : test.skip

integration("browser server navigates through Behead Browser", async () => {
  await withServer("src/browser.mjs", async (call) => {
    const result = await call("tools/call", {
      name: "behead_browser_navigate",
      arguments: { url: "data:text/html,<title>behead-browser-mcp-ok</title>" },
    })
    assert.match(result.content[0].text, /behead-browser-mcp-ok/)
  })
})

integration("devtools server reaches the Behead page through CDP", async () => {
  await withServer("src/devtools.mjs", async (call) => {
    const page = await call("tools/call", {
      name: "behead_devtools_new_page",
      arguments: { url: "data:text/html,<title>behead-devtools-mcp-ok</title><button>Go</button>" },
    })
    const pageId = JSON.parse(page.content[0].text).id
    const result = await call("tools/call", {
      name: "behead_devtools_cdp",
      arguments: {
        pageId,
        method: "Runtime.evaluate",
        params: { expression: "document.title", returnByValue: true },
      },
    })
    assert.match(result.content[0].text, /behead-devtools-mcp-ok/)

    const evaluated = await call("tools/call", {
      name: "behead_devtools_evaluate_script",
      arguments: {
        pageId,
        function: "() => { console.log('behead-console-ok'); return document.title }",
      },
    })
    assert.match(evaluated.content[0].text, /behead-devtools-mcp-ok/)

    const snapshot = await call("tools/call", {
      name: "behead_devtools_take_snapshot",
      arguments: { pageId },
    })
    assert.match(snapshot.content[0].text, /button|Go/)

    const consoleMessages = await call("tools/call", {
      name: "behead_devtools_list_console_messages",
      arguments: { pageId },
    })
    assert.match(consoleMessages.content[0].text, /behead-console-ok/)

    const requests = await call("tools/call", {
      name: "behead_devtools_list_network_requests",
      arguments: { pageId },
    })
    assert.match(requests.content[0].text, /data:text\/html/)

    const metrics = await call("tools/call", {
      name: "behead_devtools_performance_metrics",
      arguments: { pageId },
    })
    assert.match(metrics.content[0].text, /metrics/)

    await call("tools/call", {
      name: "behead_devtools_performance_start_trace",
      arguments: { pageId, screenshots: true },
    })
    const tracePath = "/tmp/behead-browser-mcp-test-trace.zip"
    await call("tools/call", {
      name: "behead_devtools_performance_stop_trace",
      arguments: { filePath: tracePath },
    })
    assert.ok((await stat(tracePath)).size > 0)

    const heapPath = "/tmp/behead-browser-mcp-test.heapsnapshot"
    await call("tools/call", {
      name: "behead_devtools_take_heapsnapshot",
      arguments: { pageId, filePath: heapPath },
    })
    assert.ok((await stat(heapPath)).size > 0)
  })
})
