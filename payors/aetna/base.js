import request from "request";
import { promisify } from "util";

import Page from "../../page/index";
import { listingKeyForName } from "../util";

const RATE_LIMIT_WARN_THRESHOLD = 50;

export const NETWORK_NAME = "aetna";
export const RESULT_SET_KEY = listingKeyForName(NETWORK_NAME);

export function queryStringFromParams(paramMap) {
  return Object.entries(paramMap)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

export default class Base {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;
    this._clientID = null;
    this._userAgent = null;

    this._rGet = promisify(redis.get).bind(redis);
    this._rSet = promisify(redis.set).bind(redis);
    this._rHSet = promisify(redis.hset).bind(redis);
    this._hGet = promisify(redis.hget).bind(redis);
    this._hKeys = promisify(redis.hkeys).bind(redis);
  }

  async getProviderIDs() {
    return this._hKeys(RESULT_SET_KEY);
  }

  async getProviderDataForID(providerID) {
    return JSON.parse(await this._hGet(RESULT_SET_KEY, providerID));
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

  async reInitPage() {
    if (this._page) {
      this._page.close().then();
    }

    this._page = await Page.newPageFromBrowser(this._browser);
  }

  async initialize(wait) {
    await this.reInitPage();

    const getClientIDPromise = this.getClientIDFromPage(this._page);
    const suffix =
      "#/contentPage?page=providerSearchLanding&site_id=dse&language=en";

    const opts = wait ? { waitUntil: "networkidle2" } : {};
    const goPromise = this._page.go(Base.getReferrer() + suffix, opts);
    this._userAgent = this._page.getUserAgent();
    this._clientID = await getClientIDPromise;

    if (wait) {
      return goPromise;
    }
  }

  static checkResponseForError(response) {
    const status = response.providersResponse
      ? response.providersResponse.status
      : response.providerResponse.status;

    if (!status.statusCode || parseInt(status.statusCode) !== 0) {
      return status;
    }

    return null;
  }

  static async apiRequest(url, headers) {
    const baseUrl = "https://api2.aetna.com/";
    const json = true;
    const gzip = true;

    // console.log("requesting", baseUrl, url);

    return new Promise((resolve, reject) => {
      request({ baseUrl, url, headers, json, gzip }, (e, r, result) => {
        if (e) {
          reject(e);
          return;
        }

        if (r.statusCode !== 200) {
          console.error("Got non-200 status code from", url);
          if (result) {
            console.error(JSON.stringify(result));
          }
          reject(r.statusCode);
          return;
        }

        const status = Base.checkResponseForError(result);

        if (status) {
          console.error(`Error: ${status.statusCode} ${status.detail}`);
          reject(status);
          return;
        }

        const rateLimit = Base.extractRateLimit(r.headers);

        if (rateLimit.remaining < RATE_LIMIT_WARN_THRESHOLD) {
          console.warn("!!! LOW REMAINING REQUEST COUNT !!!", rateLimit);
        }

        resolve({ result, rateLimit });
      });
    });
  }

  async destroy() {
    if (this._page) {
      await this._page.close();
    }
  }

  static getReferrer() {
    return "https://www.aetna.com/dsepublic/";
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
      Referer: Base.getReferrer(),
      "User-Agent": this._userAgent,
      "X-IBM-Client-Id": this._clientID
    };
  }
}
