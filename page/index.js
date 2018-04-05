export default class Page {

  static async newPageFromBrowser(browser, verbose) {
    const page = await browser.newPage();
    const ua = await browser.userAgent();
    return new Page(page, ua.replace("Headless", ""), verbose);
  }

  constructor(page, userAgent, verbose) {
    this._page = page;

    if (userAgent) {
      this._page.setUserAgent(userAgent);
      this._ua = userAgent;
    } else {
      this._page.userAgent().then(ua => this._ua = ua);
    }

    if (verbose) {
      this._page.on("console", msg => console.log(msg));
    }
  }

  getUserAgent() {
    return this._ua;
  }

  listenForRequests(callback) {
    this._page.on("request", callback);
    return () => this._page.removeListener("request", callback);
  }

  async close() {
    const p = this._page;
    this._page = null;
    await p.close();
  }

  async go(url) {
    await this._page.goto(url);
  }
}
