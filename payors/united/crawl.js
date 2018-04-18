import Page from "../../page";
import { jitterWait } from "../time-utils";
import { l } from "../log";
import { promisify } from "util";
import Http2Client from "../http2-util";

const HOST = "https://connect.werally.com";
const AUTHORITY = "connect.werally.com";

export default class UnitedCrawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;
    this._ua = null;
    this._xsrfToken = null;
    this._providerTypeIndex = 0;

    this._client = null;

    this._rHSet = promisify(redis.hset).bind(redis);
    this._rHGet = promisify(redis.hget).bind(redis);

    this._sigHandle = async () => {
      console.warn("Caught SIGTERM! Stopping...");
      process.exit();
    };

    process.on("SIGINT", this._sigHandle);
  }

  baseURLAbbreviation() {
    return "uhc";
  }

  payorAbbreviation() {
    return "uhc";
  }

  payorName() {
    return "united";
  }

  providerTypes() {
    return [
      "Psychiatrist (Physician)",
      "Psychologist",
      "Master Level Clinician",
      "Nurse Masters Level",
      "Telemental Health Providers"
    ];
  }

  searchStateKey() {
    return this.payorName() + ":search-state";
  }

  providerKey() {
    return this.payorName() + ":providers";
  }

  currentProviderType() {
    return this.providerTypes()[this._providerTypeIndex];
  }

  baseURL() {
    return `${HOST}/plans/${this.baseURLAbbreviation()}`;
  }

  coverageType() {
    return "behavioral";
  }

  detailPath(searchID) {
    return (
      "/rest/provider/v2/partners/" +
      this.payorAbbreviation() +
      "/providerTypes/person/providers/" +
      searchID +
      "?coverageType=" +
      this.coverageType()
    );
  }

  async destroy() {
    process.removeListener("SIGINT", this._sigHandle);

    if (this._page) {
      await this._page.close();
      this._page = null;
    }

    if (this._client) {
      this._client.dispose();
      this._client = null;
    }
  }

  async catchSearchResult() {
    return new Promise(resolve => {
      const stop = this._page.onResponse(response => {
        if (response.url().indexOf("v4/search/filtered") < 0) {
          return;
        }

        const headers = response.request().headers();
        this._xsrfToken = headers["x-xsrf-token"];

        response.text().then(body => {
          stop();
          resolve(JSON.parse(body));
        });
      });
    });
  }

  async saveSearchPosition() {
    const sessionStorage = await this._page.getSessionStateAsJSON();
    const localStorage = await this._page.getLocalStorageAsJSON();
    const cookies = JSON.stringify(await this._page.cookies());
    const url = await this._page.href();

    const key = this.searchStateKey();

    return Promise.all([
      this._rHSet(key, "session", sessionStorage),
      this._rHSet(key, "local", localStorage),
      this._rHSet(key, "cookies", cookies),
      this._rHSet(key, "url", url),
      this._rHSet(key, "providerIndex", this._providerTypeIndex)
    ]);
  }

  async previousSearchStateExists() {
    return !!(await this._rHGet(this.searchStateKey(), "url"));
  }

  async reloadProviderTypeIndex() {
    const typeIndex = await this._rHGet(this.searchStateKey(), "providerIndex");
    this._providerTypeIndex = !!typeIndex ? parseInt(typeIndex) : 0;
  }

  async setNewProviderSearchIndex(newIndex) {
    console.assert(newIndex >= 0);

    const providerTypeCount = this.providerTypes().length;

    console.assert(newIndex <= providerTypeCount);

    this._providerTypeIndex = newIndex;

    if (newIndex === providerTypeCount) {
      l(`Provider rolled over.`);
      return;
    }

    l(`Provider type updated to ${this.currentProviderType()}`);

    const key = this.searchStateKey();

    return Promise.all([
      this._rHSet(key, "url", ""),
      this._rHSet(key, "providerIndex", newIndex)
    ]);
  }

  async loadSearchPosition() {
    const key = this.searchStateKey();

    const [sessionStorage, localStorage, url, cookies] = await Promise.all([
      this._rHGet(key, "session"),
      this._rHGet(key, "local"),
      this._rHGet(key, "url"),
      this._rHGet(key, "cookies")
    ]);

    if (!url) {
      throw new Error("No search state to load!");
    }

    await Promise.all([
      this._page.setLocalStorage(JSON.parse(localStorage)),
      this._page.setSessionState(JSON.parse(sessionStorage)),
      this._page.setCookies(JSON.parse(cookies))
    ]);

    const snoopSearch = this.catchSearchResult();
    l("Resuming search at " + url);
    await this._page.goThenWait(url);
    return snoopSearch;
  }

  async nextPage() {
    const selector = 'button[track="next-page"]';

    const disabled = await this._page.do(
      selector => document.querySelector(selector).attributes.disabled,
      selector
    );

    if (disabled) {
      l("Next button disabled. Assuming end of search.");
      return null;
    }

    const snoopSearch = this.catchSearchResult();
    await this._page.click(selector);
    l("Next page.");
    return snoopSearch;
  }

  async newSearch() {
    const mhdSelector = "#step-0 > div.nodeContainer > ul > li:nth-child(2)";
    await this._page.waitForSelector(mhdSelector);
    await this._page.click(mhdSelector);

    await jitterWait(2000, 500);

    const peopleSelector = "a[track='People']";
    await this._page.waitForSelector(peopleSelector);
    await this._page.click(peopleSelector);

    await jitterWait(2000, 500);

    const providerSelector =
      "#step-1 > div:nth-child(2) > div.ng-if-fade." +
      "ngAnimateEnabled > ul > li:nth-child(1)";
    await this._page.waitForSelector(providerSelector);
    await this._page.click(providerSelector);

    await jitterWait(2000, 500);

    let snoopSearch = this.catchSearchResult();

    const typeSelector = `a[track="${this.currentProviderType()}"]`;
    await this._page.waitForSelector(typeSelector);
    await this._page.click(typeSelector);

    return await snoopSearch;
  }

  getDetailHeaders(referer) {
    return {
      accept: "application/json, text/plain, */*",
      "accept-encoding": "gzip, deflate, br",
      "accept-language": "en",
      "cache-control": "no-cache",
      "context-config-partnerid": this.payorAbbreviation(),
      dnt: 1,
      pragma: "no-cache",
      // @TODO: This is where cookies would go, but its unclear if they should.
      referer,
      "user-agent": this._ua,
      "x-rally-locale": "en - US",
      "x-xsrf-token": this._xsrfToken
    };
  }

  async getProviderDetail(id, referrer) {
    const headers = this.getDetailHeaders(referrer);
    const raw = await this._client.req(this.detailPath(id), headers);

    if (raw.length < 100) {
      console.error("Short provider detail", raw);
    }

    return JSON.parse(raw);
  }

  async saveProviderData(uid, list, detail) {
    const json = JSON.stringify({ list, detail });
    const added = await this._rHSet(this.providerKey(), uid, json);
    const name = list.name;

    // noinspection JSUnresolvedVariable
    l(`${name.first} ${name.last}, ${name.degree}`, !!added ? "+" : "o");
  }

  async processSearchResult(result) {
    const found = result.results;
    const len = found.length;

    const url = await this._page.href();

    for (let i = 0; i < len; i++) {
      let current = found[i];
      let id = current.id;
      let detail = await this.getProviderDetail(id, url);
      await this.saveProviderData(id, current, detail);
      await jitterWait(750, 500);
    }

    return len;
  }

  async scanCurrentProviderType() {
    if (this._page) {
      await this._page.close();
      this._page = null;
    }

    const shouldResume = await this.previousSearchStateExists();

    // Put this in the right place
    this._page = await Page.newPageFromBrowser(this._browser);
    this._ua = this._page.getUserAgent();
    await this._page.goThenWait(this.baseURL());

    await jitterWait(5000, 1000);

    this._client = new Http2Client(HOST, AUTHORITY);

    let result = null;

    if (shouldResume) {
      result = await this.loadSearchPosition();
    } else {
      const providerType = this.currentProviderType();
      l("Starting new search for provider type " + providerType);
      result = await this.newSearch(providerType);
    }

    while (result) {
      await this.processSearchResult(result);
      await jitterWait(5000, 500);
      result = await this.nextPage();
      await this.saveSearchPosition();
    }

    l("Provider type search complete");

    // Clean up
    await this._page.close();
    this._client.dispose();
    this._page = null;
    this._client = null;
  }

  async crawl() {
    await this.reloadProviderTypeIndex();

    l(`Beginning crawl for ${this.currentProviderType()}`);

    while (this._providerTypeIndex < this.providerTypes().length) {
      await this.scanCurrentProviderType();
      await this.setNewProviderSearchIndex(this._providerTypeIndex + 1);
    }

    l("Search complete. Discarding search state.");
    await this.setNewProviderSearchIndex(0);
  }
}
