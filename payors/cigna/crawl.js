import Page from "../../page";
import { jitterWait, wait } from "../time-utils";
import { e, l, w } from "../log";
import cheerio from "cheerio";
import { promisify } from "util";
import Requestor from "./requestor";

const BASE = "https://hcpdirectory.cigna.com/web/public/providers";

const SEARCHES = [
  "Behavioral Health Provider: Mental Health Counselor",
  "Behavioral Health Provider: Psychiatrist",
  "Behavioral Health Provider: Psychologist",
  "Behavioral Health Provider: Social Work"
];

const noop = () => undefined;

const document = {
  querySelector: s => {
    return { s, innerHTML: "foo" };
  },
  querySelectorAll: noop,
  body: { clientHeight: 0 }
};

const window = { scrollTo: noop };

const PROVIDER_LIST_KEY = "cigna:provider-listing";

const PROVIDER_DETAIL_KEY = "cigna:provider-detail";

export default class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;
    this._ua = null;

    this._paginationData = null;
    this._currentPage = 1;

    this._currentSearchIndex = 0;

    // noinspection JSUnresolvedVariable
    this._rHSet = promisify(redis.hset).bind(redis);
    // noinspection JSUnresolvedVariable
    this._rHGet = promisify(redis.hget).bind(redis);
  }

  async checkPageForRateLimit() {
    const selector = await this._page.$("h1");
    if (!selector) {
      return;
    }

    const innerHTML = await this._page.do(
      () => document.querySelector("h1").innerHTML
    );

    return innerHTML === "Hold up there!";
  }

  async clickApply() {
    // Click the search button
    const searchButton =
      "#filterP > div > div.drawer-content > " +
      "div.filter-action-buttons > " +
      "a.cigna-button.cigna-button-purple-light";

    await this._page.click(searchButton);
  }

  /**
   * Catch the first search request that happens on the page and return the
   * contents
   * @returns {Function}
   */
  async catchSearch() {
    const v =
      "https://hcpdirectory.cigna.com/web/public/providers/searchresults";

    const promises = [];

    const stop = this._page.onResponse(response => {
      if (response.url().indexOf(v) !== 0) {
        return;
      }

      promises.push(
        response.text().then(body => this.processSearchResults(body))
      );
    });

    return async () => {
      stop();
      return Promise.all(promises);
    };
  }

  async removeCurrentResults() {
    return this._page.do(
      s => Array.from(document.querySelectorAll(s)).forEach(e => e.remove()),
      "tr[data-search-result-id]"
    );
  }

  async moreResults() {
    const selector = "button.nfinite-scroll-trigger.cigna-button";
    const elt = await this._page.$(selector);

    if (!elt) {
      return null;
    }

    // Check to see if its visible
    // noinspection JSUnresolvedVariable
    const visible = await this._page.do(
      sel => !!document.querySelector(sel).offsetParent,
      selector
    );

    if (!visible) {
      await this._page.do(() =>
        window.scrollTo(0, document.body.clientHeight - 100)
      );
    } else {
      await this.removeCurrentResults();

      await elt.click();
    }

    return jitterWait(1000, 1000);
  }

  async resetSearch() {
    const resetLink = "#filterClearAllP";
    this._currentPage = 1;
    return this._page.click(resetLink);
  }

  async applyDistance() {
    // Get the bg
    // Drag the distance selector
    const selector = "span.ui-slider-handle.ui-state-default.ui-corner-all";
    await this._page.waitForSelector(selector);
    const handle = await this._page.$(selector);

    // Get the bounding box of the background of the slider
    const sliderBG = "div.slider-bg";
    const bg = await this._page.$(sliderBG);
    const bgBox = await bg.boundingBox();

    const box = await handle.boundingBox();
    const mouse = this._page.mouse();
    const centerX = box.x + box.width / 2;
    await mouse.move(centerX, box.y + box.height / 2);
    await mouse.down();
    await jitterWait(250, 100);
    await mouse.move(centerX + bgBox.width / 2.28, 0);
    await mouse.up();
    await jitterWait(500, 250);
  }

  saveListing(uid, stripped, name) {
    this._rHSet(PROVIDER_LIST_KEY, uid, stripped).then(result =>
      l(`List : ${uid} : ${name}`, !!result ? "+" : "o")
    );
  }

  async processSearchResults(rawHTML) {
    let $ = null;
    try {
      $ = cheerio.load(rawHTML);
    } catch (e) {
      e(`Failed to parse search results`);
      console.log(e);
      process.exit(1);
    }

    if (Requestor.checkHTMLForRateLimit($)) {
      e(`Caught rate limit on search result request. Exiting.`);
      process.exit(1);
    }

    // This is to be expected because of dumb webapps
    if ($("div.filter-options").length) {
      return;
    }

    // noinspection JSJQueryEfficiency
    let result = $("td");

    let length = result.length;

    if (length < 1) {
      $ = cheerio.load(`<table>${rawHTML}</table>`);
      result = $("td");
      length = result.length;
    }

    if (length < 1) {
      w(`Zero results found in raw search results.`);
      return;
    }

    const scripts = [];
    result.each((i, el) => {
      const capture = $(el);
      const a = capture.find("a[name]").eq(0);
      const uid = a.attr("name");
      const name = a.text();
      const stripped = capture.html().replace(/[\t\n\r]/gm, "");
      this.saveListing(uid, stripped, name);

      // Check this shit out
      scripts.push(
        new Function("return " + a.attr("onclick").slice(22, -15))()
      );
    });

    return await this.getDetailFromScripts(scripts);
  }

  async getDetailFromScripts(scripts) {
    const cookie = await this._page.cookies();
    const ua = this._page.getUserAgent();
    const href = await this._page.href();
    const req = new Requestor(href, cookie, ua);
    const count = scripts.length;

    for (let i = 0; i < count; i++) {
      let { info, name, plans, uid } = await req.getProvider(scripts[i]);
      let output = JSON.stringify({ info, name, plans });
      let result = this._rHSet(PROVIDER_DETAIL_KEY, uid, output);
      l(`Detail : ${uid} : ${name}`, result ? "+" : "o");
      await jitterWait(1000, 1000);
    }
  }

  async updatePaginationData() {
    const nFiniteSelector = "div.nfinite-scroll-container";
    this._paginationData = await this._page.do(selector => {
      // noinspection JSUnresolvedVariable
      const v = document.querySelector(selector).attributes;
      const len = v.length;
      const ret = {};
      for (let i = 0; i < len; i++) {
        let item = v.item(i);
        ret[item.name] = item.value;
      }
      return ret;
    }, nFiniteSelector);
  }

  async setupNewPage() {
    const search = SEARCHES[this._currentSearchIndex];
    l(`Beginning new search: ${search}`);

    // Do the new page boilerplate
    if (this._page) {
      this._page.close();
      this._page = null;
    }
    const page = await Page.newPageFromBrowser(this._browser);
    this._page = page;
    this._ua = page.getUserAgent();

    await page.goThenWait(BASE);

    if (await this.checkPageForRateLimit()) {
      e("Caught rate limit. Exiting.");
      process.exit(1);
    }

    // Input location
    const searchSelector = "input#searchLocation";
    await page.waitForSelector(searchSelector);
    await page.click(searchSelector);
    await jitterWait(250, 250);
    await page.repeatDeleteKey(50);
    await jitterWait(250, 250);
    await page.type(searchSelector, "New York, NY", 35);
    await jitterWait(500, 250);

    // Select the search entry
    const termInputSelector = "input#searchTermOneBox";
    await page.click(termInputSelector);
    await jitterWait(250, 250);
    await page.type(termInputSelector, search, 27);

    // Click the first entry in the list
    const topMenuItemSelector = "#ui-id-3 > li.ui-menu-item";
    await page.waitForSelector(topMenuItemSelector);
    await wait(500);
    await page.clickAndWaitForNav(topMenuItemSelector);

    // Wait for the "continue with my search" dialog
    await jitterWait(1000, 1000);
    const cwmsSelector = "#cbm-dialog-1 > div > div.margin-top-md > button";
    await page.waitForSelector(cwmsSelector);
    await page.click(cwmsSelector);

    await jitterWait(500, 500);

    // Set the distance
    return this.applyDistance();
  }

  totalResults() {
    return this._paginationData
      ? parseInt(this._paginationData["data-nfinite-total"])
      : 0;
  }

  totalPages() {
    return this._paginationData
      ? Math.ceil(parseFloat(this._paginationData["data-nfinite-pages"]))
      : 0;
  }

  describeSearch() {
    return `${
      SEARCHES[this._currentSearchIndex]
    } (${this.totalResults()} records, ${
      this._currentPage
    } / ${this.totalPages()} pages)`;
  }

  async searchIsEnded() {
    const s = ".nfinite-scroll-trigger.cigna-button.cigna-button-purple-light";
    const ret = this._page.do(sel => {
      const elt = document.querySelector(sel);
      if (!elt) {
        return false;
      }
      return elt.nextSibling ? !!elt.nextSibling.nextSibling : false;
    }, s);

    if (ret) {
      l(`Reached the end of ${this.describeSearch()}`);
    }
  }

  async crawl() {
    do {
      await this.setupNewPage();

      let stopSearch = this.catchSearch();

      await this.clickApply();
      await jitterWait(500, 500);
      await this.updatePaginationData();

      l(this.describeSearch());

      while (
        this._currentPage < this.totalPages() &&
        !(await this.searchIsEnded())
      ) {
        await this.moreResults();
      }

      await stopSearch();

      await this.resetSearch();
      l(`Finished ${this.describeSearch()}`);
    } while (++this._currentSearchIndex < SEARCHES.length);

    l("Search appears to be completed.");

    await this._page.close();
    this._page = null;

    l("Waiting 5 seconds to make sure there's no more search saving.");
    return wait(5000);
  }
}
