import devices from "puppeteer/DeviceDescriptors";

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

  async iPhone() {
    return this._page.emulate(devices["iPhone 6"]);
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

  onRequestFailed(callback) {
    this._page.on("requestfailed", callback);
    return () => this._page.removeListener("requestfailed", callback);
  }

  async interceptRequests() {
    return this._page.setRequestInterception(true);
  }

  async $(selector) {
    return this._page.$(selector);
  }

  async $$(selector) {
    return this._page.$$(selector);
  }

  async do(fxn, params) {
    return this._page.evaluate(fxn, params);
  }

  async close() {
    const p = this._page;
    this._page = null;
    await p.close();
  }

  url() {
    return this._page.url();
  }

  async cookies() {
    return this._page.cookies();
  }

  async setCookies(cookies) {
    return Promise.all(cookies.map(cookie => this._page.setCookie(cookie)));
  }

  async setSessionState(newState) {
    return this._page.evaluate(data => {
      for (let key in data) {
        // noinspection JSUnresolvedVariable
        sessionStorage.setItem(key, data[key]);
      }
      // noinspection JSUnresolvedVariable
      return sessionStorage;
    }, newState);
  }

  async setLocalStorage(newState) {
    return this._page.evaluate(data => {
      for (let key in data) {
        // noinspection JSUnresolvedVariable
        localStorage.setItem(key, data[key]);
      }
    });
  }

  async getLocalStorageAsJSON() {
    // noinspection JSUnresolvedVariable
    return this.do(() => JSON.stringify(localStorage));
  }

  async getSessionStateAsJSON() {
    // noinspection JSUnresolvedVariable
    return this.do(() => JSON.stringify(sessionStorage));
  }

  async waitForSelector(selector, delay) {
    return this._page.waitForSelector(selector, {
      visible: true,
      timeout: delay ? delay : 300000
    });
  }

  async waitForXPath(path) {
    return this._page.waitForXPath(path, { visible: true });
  }

  async getHTML() {
    return this._page.content();
  }

  async click(selector, delay) {
    return this._page.click(selector, { delay: delay || 100 });
  }

  async type(selector, input, delay) {
    await this._page.waitForSelector(selector);
    return this._page.type(selector, input, { delay: delay || 100 });
  }

  async href() {
    // noinspection JSUnresolvedVariable
    return this.do(() => document.location.href);
  }

  async clickAndWaitForNav(select, delay) {
    const navPromise = this._page.waitForNavigation({
      waitUntil: "networkidle2"
    });

    const clickPromise = this.click(select, delay);

    return Promise.all([navPromise, clickPromise]);
  }

  async goThenWait(url, idle, timeout) {
    return this.go(url, {
      waitUntil: "networkidle" + (idle ? 0 : 2),
      timeout: timeout ? timeout : 30000
    });
  }

  async repeatDeleteKey(count) {
    const promises = [];
    for (let i = 0; i < count; i++) {
      promises.push(this._page.keyboard.press("Backspace"));
    }
    return Promise.all(promises);
  }

  mouse() {
    return this._page.mouse;
  }

  async go(url, opts) {
    return this._page.goto(url, opts || {});
  }

  async reloadWithCacheOff(idle) {
    await this._page.setCacheEnabled(false);
    await this._page.reload({ waitUntil: "networkidle" + (idle ? 0 : 2) });
    return this._page.setCacheEnabled(true);
  }
}
