import { FEDERAL, PLANS, SEARCHES } from "./data";
import Page from "../../page";
import { promisify } from "util";
import { l } from "../log";
import { jitterWait } from "../time-utils";
import request from "request";

const DISTL_AJAX_HEADER = "X-Distil-Ajax";

const PROVIDER_KEY = "bcbs:providers";

const SEARCH_KEY = "bcbs:last-search";

export default class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;
    this._ua = null;

    // Cruft we need to make ajax requests
    this._distilAjax = null;
    this._loginData = null;
    this._currentHref = null;
    this._detailCookie = null;

    this._rHSet = promisify(redis.hset).bind(redis);
    this._rHGet = promisify(redis.hget).bind(redis);

    // Default settings
    this._planIndex = 0;
    this._searchSettingsIndex = 0;
    this._pageIndex = 1;

    // We have issues with this and BCBS sometimes
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

    this._sigHandle = async () => {
      console.warn("Caught SIGTERM! Stopping...");
      process.exit();
    };

    process.on("SIGINT", this._sigHandle);
  }

  static queryStringForObject(obj) {
    return Object.entries(obj)
      .map(([key, value]) => key + "=" + value)
      .join("&");
  }

  async catchLogin() {
    return this.generateRequestCatcher("public/service/login");
  }

  async catchSearch() {
    return this.generateRequestCatcher("public/service/search");
  }

  async generateRequestCatcher(substring) {
    return new Promise(resolve => {
      const stop = this._page.onResponse(response => {
        if (response.url().indexOf(substring) < 0) {
          return;
        }

        const headers = response.request().headers();
        this._distilAjax = headers[DISTL_AJAX_HEADER];
        this._detailCookie = response.request().headers().Cookie;

        response.text().then(body => {
          stop();
          resolve(JSON.parse(body));
        });
      });
    });
  }

  async clickNext() {
    const buttonSelector = 'button[data-test="right-arrow-pagination-link"]';
    const element = await this._page.$(buttonSelector);

    if (!element) {
      return null;
    }

    const promise = this.catchSearch();
    await this._page.click(buttonSelector);
    this.declineFeedback().then(() => l("Feedback declined."));
    this._pageIndex++;
    l("Moving to page " + this._pageIndex);
    return promise;
  }

  domain() {
    const plan = PLANS[this._planIndex];
    return plan.domain ? plan.domain : "provider.bcbs.com";
  }

  searchURL() {
    const plan = PLANS[this._planIndex];

    const searchSettings = SEARCHES[this._searchSettingsIndex];
    const providerType = searchSettings.providerType;
    const specialties = searchSettings.specialties.join("&specialties=");
    const providerSubTypes = searchSettings.providerSubTypes.join(
      "&providerSubTypes="
    );

    const domain = this.domain();
    const base = `https://${domain}/app/public/#/one/`;

    const firstParams = Crawl.queryStringForObject({
      city: "",
      state: "",
      postalCode: "",
      country: "",
      insurerCode: "BCBSA_I",
      brandCode: plan.brandCode ? plan.brandCode : "BCBSANDHF",
      alphaPrefix: "",
      bcbsaProductId: ""
    });

    const secondPath = "/results/";

    const secondParams = Crawl.queryStringForObject({
      acceptingNewPatients: false,
      alphaPrefix: "",
      boardCertified: "",
      hasExtendedHours: false,
      gender: "",
      isEligiblePCP: false,
      location: "New%2520York%252C%2520NY",
      maxLatitude: "",
      maxLongitude: "",
      minLatitude: "",
      minLongitude: "",
      name: "",
      page: this._pageIndex, // Starts at 1
      patientAgeRestriction: "",
      patientGenderRestriction: "",
      providerCategory: "P",
      providerSubTypes,
      providerType,
      qualityRecognitions: "",
      searchType: "default",
      radius: 50, // 1, 5, 25, 50, 100, 150
      size: 10,
      sort: "DEFAULT",
      specialties
    });

    let ret = base + firstParams + secondPath + secondParams;

    if (plan.productCode !== FEDERAL) {
      ret += "&productCode=" + plan.productCode;
    }

    return ret;
  }

  currentPlan() {
    return PLANS[this._planIndex].name;
  }

  currentProductCode() {
    return PLANS[this._planIndex].productCode;
  }

  async storeSearchState() {
    const state = [this._planIndex, this._searchSettingsIndex, this._pageIndex];
    return this._rHSet(SEARCH_KEY, "searchState", JSON.stringify(state));
  }

  async loadSearchState() {
    const rawState = await this._rHGet(SEARCH_KEY, "searchState");
    [this._planIndex, this._searchSettingsIndex, this._pageIndex] = rawState
      ? JSON.parse(rawState)
      : [0, 0, 1];
    l(`Resuming search ${this.describeSearch()}`);
  }

  describeSearch() {
    return `${this.currentPlan()} (Search ${this._searchSettingsIndex}, Page ${
      this._pageIndex
    })`;
  }

  async clearSearchState() {
    return this._rHSet(SEARCH_KEY, "searchState", "");
  }

  getDetailRequestHeaders() {
    return {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      Cookie: this._detailCookie,
      DNT: 1,
      Host: this.domain(),
      Pragma: "no-cache",
      Referer: `https://${this.domain()}/app/public/`,
      "User-Agent": this._ua,
      "X-Distil-Ajax": this._distilAjax,
      "x-dtreferer": this._currentHref,
      "X-Requested-With": "XMLHttpRequest"
    };
  }

  async getProviderDetail(providerID, locationID) {
    const headers = this.getDetailRequestHeaders();

    const queryParams = Crawl.queryStringForObject({
      providerId: providerID,
      locationId: locationID,
      location: "New%20York%2C%20NY",
      query: "",
      selectedServiceName: "",
      alphaPrefix: "",
      productCode: this.currentProductCode(),
      guid: this._loginData.guid,
      languageCode: "EN"
    });

    const json = true;
    const gzip = true;
    const base = `https://${this.domain()}/healthsparq/public/service/profile`;
    const url = base + "?" + queryParams;

    return new Promise((resolve, reject) => {
      request({ url, json, headers, gzip }, (error, response, body) => {
        if (error) {
          reject(error);
          return;
        }

        if (response.statusCode !== 200) {
          console.error("Req failed: " + response.statusCode);
          reject(body);
          return;
        }

        resolve(body);
      });
    });
  }

  async updateHref() {
    // noinspection JSUnresolvedVariable
    this._currentHref = await this._page.do(() => document.location.href);
  }

  async updateDetailCookieString() {
    const cookies = await this._page.cookies();
    const map = {};
    cookies.forEach(({ name, value }) => (map[name] = value));

    const jsid = "JSESSIONID=" + this._loginData.analyticsSupport.jsessionId;

    const order = [
      "rxVisitor",
      "dtSa",
      "correlationId",
      "D_IID",
      "D_UID",
      "D_ZID",
      "D_ZUID",
      "D_HID",
      "D_SID",
      "utag_main",
      "AWSALB",
      "dtCookie",
      "_4c_",
      "rxvt",
      "dtPC"
    ];

    this._detailCookie = "JSESSIONID=" + jsid;

    const result = order.map(name => `${name}=${map[name]}`);
    result.unshift(jsid);
    this._detailCookie = result.join("; ");
  }

  async processSearchResults(results) {
    // We need this to be current for headers
    await this.updateHref();
    await this.updateDetailCookieString();

    const providers = results.providers;
    const count = providers.length;

    for (let i = 0; i < count; i++) {
      let listEntry = providers[i];

      let lid = listEntry.bestLocation
        ? listEntry.bestLocation.id
        : listEntry.locations[0].id;

      let pid = listEntry.id;
      let detail = await this.getProviderDetail(pid, lid);

      if (Object.keys(detail.provider).length < 50) {
        console.warn("Detail strangely short for provider", listEntry.fullName);
      }

      let data = JSON.stringify({ listEntry, detail });
      let uid = pid + ":" + lid;
      let added = await this._rHSet(PROVIDER_KEY, uid, data);
      l(listEntry.fullName, !!added ? "+" : "o");
      await jitterWait(750, 500);
    }
  }

  async declineFeedback() {
    const selector = "a.acsInviteButton.acsDeclineButton";
    try {
      await this._page.waitForSelector(selector);
      await jitterWait(1000, 1000);
      await this._page.click(selector);
    } catch (e) {
      l("No feedback button showed up.");
    }
  }

  async conductSearch() {
    await jitterWait(1000, 1000);

    l(this.describeSearch(), ">");

    // Go to the actual search page
    const firstSearchPromise = this.catchSearch();
    this.declineFeedback().then(() => l("Feedback declined."));
    await this._page.goThenWait(this.searchURL());

    l("Waiting for login data to be caught");
    this._loginData = await loginPromise;

    let searchResults = await firstSearchPromise;
    while (searchResults) {
      await this.storeSearchState();
      await this.processSearchResults(searchResults);
      await jitterWait(1000, 1000);
      searchResults = await this.clickNext();
    }

    l("Search complete");
  }

  async crawl() {
    await this.loadSearchState();

    this._page = await Page.newPageFromBrowser(this._browser);
    this._ua = this._page.getUserAgent();

    // Wait for login data
    const loginPromise = this.catchLogin();

    l("Waiting for main search page to load to establish login");
    await this._page.goThenWait("https://" + this.domain());

    for (; this._planIndex < PLANS.length; this._planIndex++) {
      for (
        ;
        this._searchSettingsIndex < SEARCHES.length;
        this._searchSettingsIndex++
      ) {
        await this.conductSearch();
      }
    }

    return this.clearSearchState();
  }
}
