import { pathToFileURL } from "node:url"

export class BeheadRuntime {
  browser
  session
  selectedPageId = 0
  nextPageId = 1
  pages = new Map()
  consoleMessages = []
  networkRequests = []
  uidSelectors = new Map()
  pendingDialog
  tracing = false
  devtoolsClients = new Map()
  #nextMessageId = 1
  #nextRequestId = 1

  async ensure() {
    if (this.browser) return
    const configured = process.env.BEHEAD_BROWSER_MODULE || "behead-browser"
    const specifier = configured.startsWith("/") ? pathToFileURL(configured).href : configured
    const { launchBeheadBrowser } = await import(specifier)
    this.browser = await launchBeheadBrowser()
    this.session = await this.browser.newSession({ acceptDownloads: true })
    this.addPage(await this.session.newPage())
  }

  addPage(page) {
    const id = this.nextPageId++
    this.pages.set(id, page)
    this.selectedPageId = id
    page.on("dialog", (dialog) => { this.pendingDialog = dialog })
    page.on("request", (request) => {
      this.networkRequests.push({
        id: this.#nextRequestId++, pageId: id, request, response: undefined,
        method: request.method(), url: request.url(), resourceType: request.resourceType(),
        requestHeaders: request.headers(), postData: request.postData(), timestamp: Date.now(),
      })
      if (this.networkRequests.length > 1000) this.networkRequests.shift()
    })
    page.on("response", (response) => {
      const record = [...this.networkRequests].reverse().find((item) => item.request === response.request())
      if (record) record.response = response
    })
    return id
  }

  async enableDevtools(pageId = this.selectedPageId) {
    if (this.devtoolsClients.has(pageId)) return this.devtoolsClients.get(pageId)
    const page = this.page(pageId)
    const client = await page.context().newCDPSession(page)
    client.on("Runtime.consoleAPICalled", (event) => {
      this.consoleMessages.push({
        id: this.#nextMessageId++,
        pageId,
        type: event.type,
        text: event.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" "),
        stackTrace: event.stackTrace,
        timestamp: event.timestamp,
      })
    })
    client.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      this.consoleMessages.push({
        id: this.#nextMessageId++,
        pageId,
        type: "error",
        text: exceptionDetails.exception?.description || exceptionDetails.text,
        stackTrace: exceptionDetails.stackTrace,
        timestamp: exceptionDetails.timestamp,
      })
    })
    client.on("Network.requestWillBeSent", (event) => {
      this.networkRequests.push({
        id: this.#nextRequestId++,
        pageId,
        cdpRequestId: event.requestId,
        method: event.request.method,
        url: event.request.url,
        resourceType: event.type?.toLowerCase(),
        requestHeaders: event.request.headers,
        postData: event.request.postData,
        timestamp: event.timestamp,
      })
      if (this.networkRequests.length > 1000) this.networkRequests.shift()
    })
    client.on("Network.responseReceived", (event) => {
      const record = [...this.networkRequests].reverse().find((item) => item.cdpRequestId === event.requestId)
      if (record) record.response = event.response
    })
    await client.send("Runtime.enable")
    await client.send("Network.enable")
    this.devtoolsClients.set(pageId, client)
    return client
  }

  page(id) {
    const page = this.pages.get(id || this.selectedPageId)
    if (!page || page.isClosed()) throw new Error(`unknown page: ${id || this.selectedPageId}`)
    return page
  }

  target(page, { uid, selector }) {
    const resolved = selector || this.uidSelectors.get(uid)
    if (!resolved) throw new Error("provide a valid snapshot uid or CSS selector")
    return page.locator(resolved)
  }

  async cdp(page, method, params = {}) {
    const client = await page.context().newCDPSession(page)
    try {
      return await client.send(method, params)
    } finally {
      await client.detach().catch(() => undefined)
    }
  }

  async close() {
    await this.session?.close().catch(() => undefined)
    await this.browser?.close().catch(() => undefined)
    this.browser = undefined
    this.session = undefined
    this.pages.clear()
    this.consoleMessages.length = 0
    this.networkRequests.length = 0
    this.uidSelectors.clear()
    this.devtoolsClients.clear()
    this.pendingDialog = undefined
    this.tracing = false
  }
}
