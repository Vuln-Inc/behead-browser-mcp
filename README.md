# Behead Browser MCP

Browser automation and DevTools MCP servers backed exclusively by [Behead Browser](https://github.com/Vuln-Inc/behead-browser) and Patchright Chromium.

- `behead-browser-mcp` handles navigation, interaction, evaluation, screenshots, cookies, and request history.
- `behead-browser-devtools-mcp` adds multi-page control, UID snapshots, console and network inspection, CSS, emulation, traces, heap snapshots, and raw CDP.

Neither server launches Playwright, Puppeteer, Google Chrome, or the ordinary Chrome DevTools MCP.

## Requirements

- Node.js 20 or newer
- A built Behead Browser checkout
- Patchright's full Chromium installation

```bash
git clone https://github.com/Vuln-Inc/behead-browser.git
cd behead-browser
bun install --frozen-lockfile
bun run build
bunx patchright install chromium
```

## Install

```bash
npm install -g github:Vuln-Inc/behead-browser-mcp
export BEHEAD_BROWSER_MODULE=/absolute/path/to/behead-browser/dist/index.js
```

The environment variable must point to the compiled module exporting `launchBeheadBrowser`.

## OpenCode

```json
{
  "mcp": {
    "behead-browser": {
      "type": "local",
      "command": ["behead-browser-mcp"],
      "environment": {
        "BEHEAD_BROWSER_MODULE": "/absolute/path/to/behead-browser/dist/index.js"
      }
    },
    "behead-devtools": {
      "type": "local",
      "command": ["behead-browser-devtools-mcp"],
      "environment": {
        "BEHEAD_BROWSER_MODULE": "/absolute/path/to/behead-browser/dist/index.js"
      }
    }
  }
}
```

Use `behead_browser_*` for normal automation and `behead_devtools_*` when console, network, performance, memory, or arbitrary CDP access is required.

## Verify

```bash
npm test
BEHEAD_BROWSER_MODULE=/absolute/path/to/behead-browser/dist/index.js npm run test:integration
```

The integration suite launches the real browser and verifies navigation, CDP evaluation, snapshots, console and network capture, performance metrics, tracing, and heap snapshots.

## Limits

Behead Browser intentionally blocks service and shared workers. The DevTools server enables CDP Runtime in its own browser process, so use the automation server when minimizing debugger-observable behavior matters. Raw CDP access is powerful and should only be exposed to trusted MCP clients.
