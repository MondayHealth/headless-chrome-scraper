import Page from "../../page";
import { promisify } from "util";
import { e, l, w } from "../log";
import { jitterWait } from "../time-utils";
import request from "request";
import { BCBSSearch, RETRY } from "./search";
import { FEDERAL } from "./data";
import { listingKeyForName } from "../util";

export const NETWORK_NAME = "bcbs";
const PROVIDER_KEY = listingKeyForName(NETWORK_NAME);

export default class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;
    this._ua = null;

    // Cruft we need to make ajax requests
    this._loginData = null;
    this._currentHref = null;
    this._detailCookie = null;

    // noinspection JSUnresolvedVariable
    this._rHSet = promisify(redis.hset).bind(redis);
    // noinspection JSUnresolvedVariable
    this._rHGet = promisify(redis.hget).bind(redis);
    // noinspection JSUnresolvedVariable
    this._rHDel = promisify(redis.hdel).bind(redis);

    /**
     *
     * @type {BCBSSearch}
     * @private
     */
    this._search = new BCBSSearch(redis);

    // We have issues with this and BCBS sometimes
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

    this._sigHandle = async () => {
      console.warn("Caught SIGTERM! Stopping...");
      process.exit();
    };

    process.on("SIGINT", this._sigHandle);
  }

  /**
   * Get a query string from a map
   * @param {Object} obj
   * @returns {string}
   */
  static queryStringForObject(obj) {
    return Object.entries(obj)
      .map(
        ([key, value]) => (value !== undefined ? key + "=" + value : undefined)
      )
      .join("&");
  }

  /**
   * Listen for login requests and record the responses
   * @returns {Function}
   */
  catchLogin() {
    return this._page.onResponse(response => {
      if (response.url().indexOf("public/service/login") >= 0) {
        response.text().then(body => this.updateLoginData(JSON.parse(body)));
      }
    });
  }

  /**
   * Get the request headers for detail requests
   * @returns {{Accept: string, "Accept-Encoding": string, "Accept-Language":
   *   string, "Cache-Control": string, Connection: string, Cookie: null|*,
   *   DNT: number, Host: *, Pragma: string, Referer: string, "User-Agent":
   *   null|*, "X-Distil-Ajax": null|*, "x-dtreferer": null|*,
   *   "X-Requested-With": string}}
   */
  getDetailRequestHeaders() {
    return {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      Cookie: this._detailCookie,
      DNT: 1,
      Host: this._search.domain(),
      Pragma: "no-cache",
      Referer: `https://${this._search.domain()}/app/public/`,
      "User-Agent": this._ua,
      "X-Distil-Ajax": this._search.lastDistilAjaxValue(),
      "x-dtreferer": this._currentHref,
      "X-Requested-With": "XMLHttpRequest"
    };
  }

  /**
   * Get provider detail via GET request
   * @param {number} providerID
   * @param {number} locationID
   * @returns {Promise<Object>}
   */
  async getProviderDetail(providerID, locationID) {
    console.assert(providerID);
    console.assert(locationID);

    const headers = this.getDetailRequestHeaders();

    const pcode = this._search.currentProductCode();

    const queryParams = Crawl.queryStringForObject({
      providerId: providerID,
      locationId: locationID,
      location: "New%20York%2C%20NY",
      query: "",
      selectedServiceName: "",
      alphaPrefix: "",
      productCode: pcode === FEDERAL ? undefined : pcode,
      guid: this._loginData.guid,
      languageCode: "EN"
    });

    const json = true;
    const gzip = true;
    const domain = this._search.domain();
    const base = `https://${domain}/healthsparq/public/service/profile`;
    const timeout = 120 * 1000;
    const url = base + "?" + queryParams;

    return new Promise((resolve, reject) => {
      request(
        { url, json, headers, gzip, timeout },
        (error, response, body) => {
          // Read more about errors here:
          // https://github.com/request/request#timeouts
          if (error) {
            if (error.code === "ETIMEDOUT") {
              if (error.connect) {
                e(`Request connection timeout.`);
              } else {
                e(`Request read timeout.`);
              }
              l(url);
              resolve(null);
              return;
            }

            reject(error);
            return;
          }

          if (response.statusCode !== 200) {
            console.error("Req failed: " + response.statusCode);
            if (response.statusCode >= 500) {
              resolve(RETRY);
            } else {
              reject(body);
            }
            return;
          }

          if (body.error) {
            // noinspection JSUnresolvedVariable
            switch (body.error.errorId) {
              case "SE001011":
                e(
                  "Invalid provider info for " + providerID + " / " + locationID
                );
                resolve(null);
                return;
              default:
                e(`Unknown error for ${providerID}/${locationID}`);
                reject(body);
                return;
            }
          }

          // noinspection JSUnresolvedVariable
          if (!body.provider) {
            console.warn("No provider");
            console.log(body);
          } else if (Object.keys(body.provider).length < 50) {
            console.warn("Detail strangely short for provider");
            console.log(body);
          }

          resolve(body);
        }
      );
    });
  }

  /**
   * Update our accounting of the current href of the page
   * @returns {Promise<void>}
   */
  async updateHref() {
    // noinspection JSUnresolvedVariable
    this._currentHref = await this._page.do(() => document.location.href);
  }

  /**
   * Get the detail GET request cookie header as a string
   * @returns {Promise<string>}
   */
  async updateDetailCookieString() {
    const cookies = await this._page.cookies();
    const map = {};
    cookies.forEach(({ name, value }) => (map[name] = value));

    // noinspection JSUnresolvedVariable
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

  /**
   * Download a provider detail object based on what was sent in the search
   * listing
   * @param {Object} listing
   * @returns {Promise<void>}
   */
  async getDetail(listing) {
    // noinspection JSUnresolvedVariable
    const lid = listing.bestLocation
      ? listing.bestLocation.id
      : listing.locations[0].id;

    const pid = listing.id;
    const uid = pid + ":" + lid;

    /**
     * Use this code block to delete providers instead of save them
    await this._rHDel(PROVIDER_KEY, uid);
    // noinspection JSUnresolvedVariable
    l(listing.fullName + ", " + listing.credentialDegreeLabel, "$");
    return;
     */

    const fxn = this.getProviderDetail.bind(this, pid, lid);
    const detail = await Crawl.retryWrapper(fxn, 3);

    if (!detail) {
      w(`Only partial data for ${listing.fullName}`);
    }

    let data = JSON.stringify({ listing, detail });
    let added = await this._rHSet(PROVIDER_KEY, uid, data);
    // noinspection JSUnresolvedVariable
    l(
      listing.fullName +
        ", " +
        listing.credentialDegreeLabel +
        " (" +
        uid +
        ")",
      !!added ? "+" : "o"
    );
  }

  /**
   * Make detail requests for an array of search results
   * @param {Array.<Object>} results The search results
   * @returns {Promise<void>}
   */
  async processSearchResults(results) {
    // We need this to be current for headers
    await this.updateHref();
    await this.updateDetailCookieString();

    const providers = results.providers;

    if (!providers) {
      e("No providers structure in results!");
      console.log(results);
      process.exit(1);
    }
    const count = providers.length;

    const promises = [];

    l(`Initiate retrieval of ${count} detail results`);

    for (let i = 0; i < count; i++) {
      promises.push(this.getDetail(providers[i]));
      await jitterWait(750, 500);
    }

    return Promise.all(promises);
  }

  updateLoginData(newData) {
    this._loginData = newData;
    l("Login data updated.", "=");
  }

  async conductSearch() {
    await jitterWait(1000, 1000);

    const begin = this._search.beginSearch.bind(this._search);
    const next = this._search.nextPage.bind(this._search);

    let searchResults = await Crawl.retryWrapper(begin, 3);

    while (searchResults) {
      await this._search.storeSearchState();
      await this.processSearchResults(searchResults);
      await jitterWait(500, 500);
      searchResults = await Crawl.retryWrapper(next, 7);
    }

    l("Search complete");
  }

  static async retryWrapper(fxn, count) {
    let searchResults = await fxn();
    let retryCount = 0;

    while (searchResults === RETRY) {
      if (retryCount++ >= count) {
        e(`Too many retries (r > ${count}). Failing.`);
        process.exit(1);
      }

      w(`Caught retry, waiting about 10 seconds to retry.`);
      await jitterWait(10000, 1000);
      l(`Retrying.`);
      searchResults = await fxn();
    }

    return searchResults;
  }

  async crawl() {
    this._page = await Page.newPageFromBrowser(this._browser);
    this._ua = this._page.getUserAgent();

    // BCBS appears to crash chrome pages sometimes and there doesnt appear
    // to be an elegant way to handle this.
    this._page._page.on("error", error => {
      e("It appears the page has crashed.");
      console.log(error);
      process.exit(1);
    });

    this._search.setPage(this._page);
    await this._search.loadSearchState();

    this.catchLogin();

    do {
      await this.conductSearch();
    } while (this._search.nextSearch());

    l("Search appears to be complete!");

    return this._search.clearSearchState();
  }
}
