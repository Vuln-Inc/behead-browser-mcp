import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

export async function withServer(script, callback) {
  const child = spawn(process.execPath, [script], {
    env: process.env,
    stdio: ["pipe", "pipe", "inherit"],
  })
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]()
  let id = 0
  const call = async (method, params = {}) => {
    const requestId = ++id
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`)
    while (true) {
      const { value, done } = await lines.next()
      if (done) throw new Error("MCP server exited before responding")
      const response = JSON.parse(value)
      if (response.id !== requestId) continue
      if (response.error) throw new Error(response.error.message)
      return response.result
    }
  }

  try {
    await call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    })
    return await callback(call)
  } finally {
    child.kill("SIGTERM")
  }
}
