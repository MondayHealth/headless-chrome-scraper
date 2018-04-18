/**
 *
 *

 COMMERCIAL
 URL: https://connect.werally.com/plans/uhc
 How to navigate:
 Select Mental Health Directory
 Change Location to New York, NY
 Click to search by “People” à “Provider Type” for the following provider types:
 ...
 After clicking plan, update radius to “10 miles”
 Fields to be captured:
 Provider Name
 Provider Type (selected earlier)
 License (it’s attached to the end of the name field, e.g. LCSW, PhD)
 Address
 Phone
 Accepting New Patients (Y/N)
 Coverage/Plan Type: “Commercial”
 */

import Page from "../../page";
import { jitterWait } from "../time-utils";
import { l } from "../log";
import { promisify } from "util";
import Http2Client from "../http2-util";

const UHC_BASE = "https://connect.werally.com/plans/uhc";

const HOST = "https://connect.werally.com";

const AUTHORITY = "connect.werally.com";

const UHC_DETAIL_PATH =
  "/rest/provider/v2/partners/uhc/providerTypes/person/providers/";

const PROVIDER_TYPES = [
  "Psychiatrist (Physician)",
  "Psychologist",
  "Master Level Clinician",
  "Nurse Masters Level",
  "Telemental Health Providers"
];

const SEARCH_STATE_KEY = "united:search-state";

const PROVIDER_KEY = "united:providers";

export default class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;
    this._ua = null;
    this._xsrfToken = null;

    this._client = null;

    this._rGet = promisify(redis.get).bind(redis);
    this._rSet = promisify(redis.set).bind(redis);
    this._rHSet = promisify(redis.hset).bind(redis);
    this._rHGet = promisify(redis.hget).bind(redis);
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
    // noinspection JSUnresolvedVariable
    const url = await this._page.href();

    return Promise.all([
      this._rHSet(SEARCH_STATE_KEY, "session", sessionStorage),
      this._rHSet(SEARCH_STATE_KEY, "local", localStorage),
      this._rHSet(SEARCH_STATE_KEY, "cookies", cookies),
      this._rHSet(SEARCH_STATE_KEY, "url", url)
    ]);
  }

  async previousSearchStateExists() {
    return !!(await this._rHGet(SEARCH_STATE_KEY, "url"));
  }

  async loadSearchPosition() {
    const [sessionStorage, localStorage, cookies, url] = await Promise.all([
      this._rHGet(SEARCH_STATE_KEY, "session"),
      this._rHGet(SEARCH_STATE_KEY, "local"),
      this._rHGet(SEARCH_STATE_KEY, "cookies"),
      this._rHGet(SEARCH_STATE_KEY, "url")
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
    await this._page.waitForSelector(selector);
    const snoopSearch = this.catchSearchResult();
    await this._page.click(selector);
    return snoopSearch;
  }

  async newSearch(providerType) {
    const mhdSelector = "#step-0 > div.nodeContainer > ul > li:nth-child(2)";
    await this._page.waitForSelector(mhdSelector);
    await this._page.click(mhdSelector);

    await jitterWait(1000, 500);

    const peopleSelector = "a[track='People']";
    await this._page.waitForSelector(peopleSelector);
    await this._page.click(peopleSelector);

    await jitterWait(1000, 500);

    const providerSelector =
      "#step-1 > div:nth-child(2) > div.ng-if-fade." +
      "ngAnimateEnabled > ul > li:nth-child(1)";
    await this._page.waitForSelector(providerSelector);
    await this._page.click(providerSelector);

    await jitterWait(1000, 500);

    let snoopSearch = this.catchSearchResult();

    const typeSelector = `a[track="${providerType}"]`;
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
      "context-config-partnerid": "uhc",
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
    const url = UHC_DETAIL_PATH + id + "?coverageType=behavioral";
    const headers = this.getDetailHeaders(referrer);
    const raw = await this._client.req(url, headers);

    if (raw.length < 100) {
      console.error("Short provider detail", raw);
    }

    return JSON.parse(raw);
  }

  async saveProviderData(uid, list, detail) {
    const json = JSON.stringify({ list, detail });
    const added = await this._rHSet(PROVIDER_KEY, uid, json);
    const name = list.name;
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

  async scan(providerTypeIndex) {
    let hardStop = false;

    if (this._page) {
      await this._page.close();
      this._page = null;
    }

    const shouldResume = await this.previousSearchStateExists();

    // Put this in the right place
    this._page = await Page.newPageFromBrowser(this._browser);
    this._ua = this._page.getUserAgent();
    await this._page.goThenWait(UHC_BASE);

    this._client = new Http2Client(HOST, AUTHORITY);

    let result = null;

    if (shouldResume) {
      result = await this.loadSearchPosition();
    } else {
      const providerType = PROVIDER_TYPES[providerTypeIndex];
      l("Starting new search for provider type " + providerType);
      result = await this.newSearch(providerType);
    }

    const sigHandle = () => {
      console.warn("Caught SIGTERM! Stopping...");
      hardStop = true;
    };

    process.on("SIGINT", sigHandle);

    while (result && !hardStop) {
      await this.processSearchResult(result);
      await jitterWait(5000, 500);
      result = await this.nextPage();
      await this.saveSearchPosition();
    }

    process.removeListener("SIGINT", sigHandle);

    l("Search complete");

    // Clean up
    await this._page.close();
    this._client.dispose();
    this._page = null;
    this._client = null;
  }
}
