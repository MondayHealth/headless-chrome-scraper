import { FEDERAL, PLANS, SEARCHES } from "./data";
import Page from "../../page";
import { promisify } from "util";
import { l } from "../log";

const DISTL_AJAX_HEADER = "X-Distil-Ajax";

const PROVIDER_KEY = "bcbs:providers";

const SEARCH_KEY = "bcbs:last-search";

export default class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;
    this._distilAjax = null;
    this._loginData = null;

    this._rHSet = promisify(redis.hset).bind(redis);
    this._rHGet = promisify(redis.hget).bind(redis);

    // Default settings
    this._planIndex = 0;
    this._searchSettingsIndex = 0;
    this._page = 1;
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
    return promise;
  }

  searchURL() {
    const plan = PLANS[this._planIndex];

    const searchSettings = SEARCHES[this._searchSettingsIndex];
    const providerType = searchSettings.providerType;
    const specialties = searchSettings.specialties.join("&specialties=");
    const providerSubTypes = searchSettings.providerSubTypes.join(
      "&providerSubTypes="
    );

    const domain = plan.domain ? plan.domain : "provider.bcbs.com";
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
      page: this._page, // Starts at 1
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

  async storeSearchState() {
    const state = [this._planIndex, this._searchSettingsIndex, this._page];
    return this._rHSet(SEARCH_KEY, "searchState", JSON.stringify(state));
  }

  async loadSearchState() {
    const rawState = await this._rHGet(SEARCH_KEY, "searchState");
    [this._planIndex, this._searchSettingsIndex, this._page] = rawState
      ? JSON.parse(rawState)
      : [0, 0, 1];
  }

  async clearSearchState() {
    return this._rHSet(SEARCH_KEY, "searchState", "");
  }

  async processSearchResults(results) {
    console.log(results);
  }

  async crawl() {
    this._page = await Page.newPageFromBrowser(this._browser);
    this._ua = this._page.getUserAgent();

    // Wait for login data
    const loginPromise = this.catchLogin();

    // Wait for the first search bit
    await this.loadSearchState();
    const firstSearchPromise = this.catchSearch();
    await this._page.goThenWait(this.searchURL());
    this._loginData = await loginPromise;
    let searchResults = await firstSearchPromise;

    while (searchResults) {
      await this.storeSearchState();
      await this.processSearchResults(searchResults);
      searchResults = await this.clickNext();
    }

    l("Done with the crawl.");
    return this.clearSearchState();
  }
}
