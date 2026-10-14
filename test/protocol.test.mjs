import assert from "node:assert/strict"
import test from "node:test"
import { withServer } from "./helpers.mjs"

test("browser server exposes only Behead browser tools", async () => {
  await withServer("src/browser.mjs", async (call) => {
    const { tools } = await call("tools/list")
    assert.ok(tools.length >= 10)
    assert.ok(tools.every((tool) => tool.name.startsWith("behead_browser_")))
    assert.ok(tools.some((tool) => tool.name === "behead_browser_navigate"))
  })
})

test("devtools server exposes its complete core catalog", async () => {
  await withServer("src/devtools.mjs", async (call) => {
    const { tools } = await call("tools/list")
    assert.ok(tools.length >= 30)
    assert.ok(tools.every((tool) => tool.name.startsWith("behead_devtools_")))
    for (const required of [
      "behead_devtools_take_snapshot",
      "behead_devtools_list_console_messages",
      "behead_devtools_get_network_request",
      "behead_devtools_performance_start_trace",
      "behead_devtools_take_heapsnapshot",
      "behead_devtools_cdp",
    ]) {
      assert.ok(tools.some((tool) => tool.name === required), required)
    }
  })
})
