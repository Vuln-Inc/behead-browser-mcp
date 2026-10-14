import { createInterface } from "node:readline"

export const schema = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
})

export const text = (value) => ({
  content: [{
    type: "text",
    text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
  }],
})

export function serve({ name, version = "0.1.0", tools, callTool, close }) {
  const send = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`)
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })

  input.on("line", async (line) => {
    let request
    try {
      request = JSON.parse(line)
      let result
      if (request.method === "initialize") {
        result = {
          protocolVersion: request.params?.protocolVersion || "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version },
        }
      } else if (request.method === "ping") {
        result = {}
      } else if (request.method === "tools/list") {
        result = { tools }
      } else if (request.method === "tools/call") {
        result = await callTool(request.params?.name, request.params?.arguments || {})
      } else if (request.id === undefined || request.method?.startsWith("notifications/")) {
        return
      } else {
        send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `method not found: ${request.method}` } })
        return
      }
      send({ jsonrpc: "2.0", id: request.id, result })
    } catch (error) {
      if (request?.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
        })
      }
    }
  })

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      await close?.()
      process.exit(0)
    })
  }
}
