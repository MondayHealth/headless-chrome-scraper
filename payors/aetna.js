import request from "request";
import { promisify } from "util";
import redis from "redis";

import Page from "./../page";

const REFERRER = "https://www.aetna.com/dsepublic/";

const BASE_URL =
  REFERRER + "#/contentPage?page=providerSearchLanding&site_id=dse&language=en";

const RESULTS_PER_PAGE = 25;

export class Aetna {
  constructor(browser) {
    this._browser = browser;
    this._page = null;
    this._clientID = null;
    this._userAgent = null;
  }

  async initialize() {
    this._page = await Page.newPageFromBrowser(this._browser);
    const getClientIDPromise = this.getClientIDFromPage(this._page);
    this._page.go(BASE_URL).then();
    this._userAgent = this._page.getUserAgent();
    this._clientID = await getClientIDPromise;
  }

  async destroy() {
    // await this._page.close();
  }

  static extractProviderList(responseBody) {
    return responseBody.providersResponse.readProvidersResponse
      .providerInfoResponses;
  }

  static extractPagingData(responseBody) {
    return responseBody.providersResponse.readProvidersResponse.interfacePaging;
  }

  static providerInfoQuery(pageIndex) {
    const params = {
      searchText: "Behavioral%20Health%20Professionals",
      listFieldSelections: "affiliations",
      isGuidedSearch: false,
      state: "NY",
      distance: 25,
      latitude: 40.7427,
      longitude: -73.99340000000001,
      postalCode: 10199,
      // 1, 0 is the first page, 1, 25 is the second page
      firstRecordOnPage: RESULTS_PER_PAGE * pageIndex + 1,
      lastRecordOnPage: pageIndex < 1 ? 0 : RESULTS_PER_PAGE * (pageIndex + 1)
    };
    const param_string = Object.entries(params)
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    const base = "healthcare/prod/v3/publicdse_providersearch";

    // We want to make sure this URL looks EXACTLY like what the SPA produces
    const last = "&&responseLanguagePreference=en&siteId=dse";

    return `${base}?${param_string}${last}`;
  }

  headersForAPIRequest() {
    return {
      "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      DNT: 1,
      Host: "api2.aetna.com",
      "If-Modified-Since": "Mon, 26 Jul 1997 05:00:00 GMT",
      Origin: "https://www.aetna.com",
      Pragma: "no-cache",
      Referer: REFERRER,
      "User-Agent": this._userAgent,
      "X-IBM-Client-Id": this._clientID
    };
  }

  static extractRateLimit(responseHeaders) {
    /**
     'x-ratelimit-limit': 'name=rate-limit,280;',
     'x-ratelimit-remaining': 'name=rate-limit,278;',
     */

    function parseOut(input) {
      return parseInt(
        responseHeaders[input]
          .split("=")[1]
          .split(",")[1]
          .split(";")[0]
      );
    }

    const limit = parseOut("x-ratelimit-limit");
    const remaining = parseOut("x-ratelimit-remaining");

    return { limit, remaining };
  }

  async listProviders(pageIndex) {
    const baseUrl = "https://api2.aetna.com/";
    const url = Aetna.providerInfoQuery(pageIndex);
    const headers = this.headersForAPIRequest();
    const json = true;
    const gzip = true;
    return new Promise((resolve, reject) => {
      request({ baseUrl, url, headers, json, gzip }, (e, r, result) => {
        if (e) {
          reject(e);
          return;
        }

        if (r.statusCode !== 200) {
          console.error("Got non-200 status code from", url);
          reject(r.statusCode);
          return;
        }

        const status = Aetna.checkResponseForError(result);

        if (status) {
          console.error(`Error: ${status.statusCode} ${status.detail}`);
          reject(status);
          return;
        }

        const rateLimit = Aetna.extractRateLimit(r.headers);
        resolve({ result, rateLimit });
      });
    });
  }

  async getClientIDFromPage(page) {
    return new Promise(resolve => {
      const stop = page.listenForRequests(intercepted => {
        const name = "x-ibm-client-id";
        const headers = intercepted.headers();
        const value = headers[name];
        if (value) {
          resolve(value);
          stop();
        }
      });
    });
  }

  static checkResponseForError(response) {
    const status = response.providersResponse.status;

    if (status.statusCode !== 200)
    {
      return status;
    }

    return null;
  }

  async scanProviders() {
    const client = redis.createClient();
    const paginationKey = "aetna-last-page";
    const resultsSetKey = "aetna-providers";
    const rGet = promisify(client.get).bind(client);
    const rSet = promisify(client.set).bind(client);
    const rHSet = promisify(client.hset).bind(client);

    let pageIndex = (await rGet(paginationKey)) || 0;

    const { result, rateLimit } = await this.listProviders(pageIndex);
    Aetna.checkResponseForError(result);
    const providers = Aetna.extractProviderList(result);
    const pagination = Aetna.extractPagingData(result);

    if (rateLimit.remaining < 50) {
      console.warn("!!! LOW REMAINING REQUEST COUNT !!!", rateLimit);
    }

    providers.forEach(provider => {
      const name = provider.providerInformation.providerDisplayName.full;
      const id = provider.providerInformation.providerID;
      const raw = JSON.stringify(provider);
      rHSet(resultsSetKey, id, raw).then(result => {
        console.log("stored provider", id, name, result);
      });
    });

    pageIndex += 1;
    await rSet(paginationKey, pageIndex).then(r => console.log("set", r));
  }
}
