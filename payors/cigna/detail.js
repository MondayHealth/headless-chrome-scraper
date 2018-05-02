import { jitterWait } from "../time-utils";
import { e, l } from "../log";
import Crawl from "./crawl";
import cheerio from "cheerio";
import { stripWhitespace } from "../../page";

const PROVIDER_DETAIL_KEY = "cigna:provider-detail";

export class DetailScraper {
  constructor(page) {
    this._page = page;
  }

  /**
   * Block requests to googleapis domains until the returned function is called
   * @returns {Promise<function(): Promise<void>>}
   */
  async blockGoogleMapsRequests() {
    await this._page.setInterceptRequests(true);

    const stop = this._page.listenForRequests(request => {
      request.url().indexOf("googleapis") >= 0
        ? request.abort()
        : request.continue();
    });

    return async () => {
      stop();
      return this._page.setInterceptRequests(false);
    };
  }

  /**
   *
   * @param expectedCount {number}
   * @returns {Promise<Array.<string>>}
   */
  async capturePlanDetailRequests(expectedCount) {
    let count = 0;
    let collected = {};
    const url =
      "https://hcpdirectory.cigna.com/web/public/providers/searchresults";
    const self = this;
    return new Promise(resolve => {
      const stop = this._page.onResponse(response => {
        if (response.url().indexOf(url) !== 0) {
          return;
        }

        response.text().then(body => {
          const { planName, value } = self.processPlanDetailResponse(
            response.request().postData(),
            body
          );

          l(`Collected ${count++} / ${expectedCount}`);
          collected[planName] = value;

          if (count === expectedCount) {
            stop();
            resolve(collected);
          }
        });
      });
    });
  }

  /**
   * We save this information so we can tell what plan specifically was
   * asked for without having to parse weird hashes
   * @param map {Object}
   * @returns {{productCodes: *, medicalProductCode: *, medicalNetworkCode: *,
   *   networkCode: *, medicalMpoCode: *, medicalNpoCode: *}}
   */
  static extractPlanInfoFromMap(map) {
    return {
      productCodes: map.productCodes,
      medicalProductCode: map.medicalProductCode,
      medicalNetworkCode: map.medicalNetworkCode,
      networkCode: map.networkCode,
      medicalMpoCode: map.medicalMpoCode,
      medicalNpoCode: map.medicalNpoCode
    };
  }

  /**
   *
   * @param postData {string}
   * @param body {string}
   */
  processPlanDetailResponse(postData, body) {
    const $ = cheerio.load(stripWhitespace(body));

    if (Crawl.checkHTMLForRateLimit($)) {
      e("Encountered rate limit in plan request.");
      process.exit(1);
    }

    // noinspection JSUnresolvedFunction
    const data = Array.from(
      $("td")
        .map((i, elem) => $(elem).html())
        .get()
    );

    const map = {};
    postData.split("&").forEach(pair => {
      const [key, value] = pair.split("=");
      map[key] = value;
    });
    const meta = DetailScraper.extractPlanInfoFromMap(map);

    const value = { meta, data };
    const planName = `${meta.medicalProductCode}:${meta.medicalMpoCode}:${
      meta.medicalNpoCode
    }`;
    return { planName, value };
  }

  /**
   * Click a detail link, as passed from pupeteer
   * @param elem {Object}
   * @returns {Promise<{info: string, name: string, plans: Array<string>}>}
   */
  async clickDetail(elem) {
    await elem.click();

    const infoSelector = "div#providerDetailsContainer > .container-fluid";
    const info = await Crawl.getInnerHTMLFromSelector(infoSelector);

    if (!info) {
      e("Couldn't find info element!");
      process.exit(1);
    }

    const nameSelector = "#providerDetailsContainer h1";
    const name = await Crawl.getInnerHTMLFromSelector(nameSelector);

    if (!name) {
      e("Couldn't find name element!");
      process.exit(1);
    }

    const planLinkSelector = "div#providerDetailsContainer > section > a";
    const planLinks = await this._page.$$(planLinkSelector);

    const count = planLinks.length;
    console.assert(count);

    const stopBlockingMaps = await this.blockGoogleMapsRequests();
    const planDetailRequests = this.capturePlanDetailRequests(count);

    // click all the plan links
    l(`Clicking ${count} plan links`);
    for (let i = 0; i < count; i++) {
      planLinks[i].click();
      await jitterWait(500, 500);
    }

    const plans = await planDetailRequests;
    l(`Collected ${count} plan info blocks`);

    await stopBlockingMaps();

    await jitterWait(500, 500);
    await this._page.click("#backToResults");

    return { info, name, plans };
  }

  /**
   * Get details
   * @param detailParams {Array}
   * @param hset {function}
   * @returns {Promise<void>}
   */
  async getDetails(detailParams, hset) {
    const listEntrySelector = "tr[data-search-result-id]";
    const linkSelector = listEntrySelector + " div.address-header a[name]";
    await this._page.waitForSelector(linkSelector, 7000);
    const nameLinks = await this._page.$$(linkSelector);

    l("Scraping details for search results.");
    for (let i = 0; i < nameLinks.length; i++) {
      let uid = detailParams[i].providerId;
      let output = JSON.stringify(await this.clickDetail(nameLinks[i]));
      let result = hset(PROVIDER_DETAIL_KEY, uid, output);
      l(`Detail : ${uid} : ${name}`, result ? "+" : "o");
    }
  }
}
