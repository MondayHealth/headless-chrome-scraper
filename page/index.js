let userAgent = null;

async function getCachedUserAgent(browser) {
  if (!userAgent) {
    userAgent = await browser.userAgent();
    userAgent = userAgent.replace("Headless", "");
  }

  return userAgent;
}

export default class Page {
  static async newPageFromBrowser(browser, verbose) {
    const page = await browser.newPage();
    const ua = await getCachedUserAgent(browser);
    return new Page(page, ua, verbose);
  }

  constructor(page, userAgent, verbose) {
    this._page = page;

    if (userAgent) {
      this._page.setUserAgent(userAgent);
      this._ua = userAgent;
    } else {
      this._page.userAgent().then(ua => (this._ua = ua));
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

  onResponse(callback) {
    this._page.on("response", callback);
    return () => this._page.removeListener("response", callback);
  }

  debugRequests(page) {
    return new Promise(resolve => {
      const stop = page.listenForRequests(intercepted => {
        console.log(">", intercepted.url());
      });
      resolve(stop);
    });
  }

  async close() {
    const p = this._page;
    this._page = null;
    console.debug("Closing page", p.url());
    await p.close();
  }

  debugNavigation() {
    this._page.on("framenavigated", () => {
      console.log("NAV", this._page.url());
    });
  }

  url() {
    return this._page.url();
  }

  async setSessionState(newState) {
    return this._page.evaluate(data => {
      for (let key in data) {
        // noinspection JSUnresolvedVariable
        sessionStorage.setItem(key, data[key]);
      }
      return sessionStorage;
    }, newState);
  }

  async getSessionState() {
    return this._page.evaluate(() => {
      return JSON.stringify(sessionStorage);
    });
  }

  async click(selector, delay) {
    return this._page.click(selector, { delay: delay || 100 });
  }

  async goThenWait(url) {
    return this.go(url, { waitUntil: 'networkidle2' });
  }

  async go(url, opts) {
    return this._page.goto(url, opts || {});
  }
}
