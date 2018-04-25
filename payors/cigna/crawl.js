import Page from "../../page";
import { jitterWait, wait } from "../time-utils";
import { e, l } from "../log";
import cheerio from "cheerio";
import { promisify } from "util";

const BASE = "https://hcpdirectory.cigna.com/web/public/providers";

const SPECIALTIES = [
  "Psychiatry, Child & Adolescent",
  "Counseling",
  "Psychiatry",
  "Psychology",
  "Psychology, Neurological",
  "Social Work",
  "Counseling"
];

const noop = () => undefined;

const document = {
  querySelector: noop,
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

    this._cookie = null;
    this._lastSearchHeaders = null;
    this._lastURL = null;

    this._paginationData = null;
    this._currentPage = 1;

    this._currentSpecialtyIndex = 0;

    // noinspection JSUnresolvedVariable
    this._rHSet = promisify(redis.hset).bind(redis);
    // noinspection JSUnresolvedVariable
    this._rHGet = promisify(redis.hget).bind(redis);
  }

  /**
   *
   * @returns {Promise<*[]>}
   */
  async getSpecialties() {
    const select =
      "#filterP > div > div.drawer-content > div.directory-facets-group > " +
      "div > div > div:nth-child(2) > fieldset > div > label";

    const p1 = this._page.do(selector => {
      // noinspection JSUnresolvedVariable
      return Array.from(document.querySelectorAll(selector)).map(a =>
        a.textContent
          .trim()
          .split("\n")[0]
          .trim()
      );
    }, select);

    const p2 = this._page.$$(select + " > input");

    return Promise.all([p1, p2]);
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
  catchSearch() {
    const v =
      "https://hcpdirectory.cigna.com/web/public/providers/searchresults";
    return this._page.onResponse(response => {
      if (response.url().indexOf(v) !== 0) {
        return;
      }

      this._lastSearchHeaders = response.request().headers();
      this._lastURL = response.url();

      response.text().then(body => this.processSearchResults(body));
    });
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

  async applySpecialty() {
    const [specialties, elements] = await this.getSpecialties();
    const specialtyName = SPECIALTIES[this._currentSpecialtyIndex];
    const idx = specialties.indexOf(specialtyName);
    if (idx < 0) {
      e(`Problem finding specialty ${specialtyName}`);
      process.exit(1);
    }
    await elements[idx].click();
    await jitterWait(500, 250);
    return this.clickApply();
  }

  async applyDistance() {
    // Drag the distance selector
    const selector = "span.ui-slider-handle.ui-state-default.ui-corner-all";
    await this._page.waitForSelector(selector);
    const handle = await this._page.$(selector);
    const box = await handle.boundingBox();
    const mouse = this._page.mouse();
    await mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await mouse.down();
    await jitterWait(250, 100);
    await mouse.move(200, 0);
    await mouse.up();
    await jitterWait(500, 250);
    await this.clickApply();
  }

  saveList(uid, stripped, name) {
    this._rHSet(PROVIDER_LIST_KEY, uid, stripped).then(result =>
      l(`${uid} : ${name}`, !!result ? "+" : "o")
    );
  }

  async processSearchResults(rawHTML) {
    let $ = null;
    try {
      $ = cheerio.load(rawHTML);
    } catch (e) {
      console.log(e);
      return;
    }

    this._currentPage++;

    const result = $("tr[data-search-result-id]");
    result.each((i, el) => {
      const capture = $(el);
      const a = capture.find("a[name]").eq(0);
      const uid = a.attr("name");
      const name = a.text();
      const stripped = capture.html().replace(/[\t\n\r]/gm, "");
      this.saveList(uid, stripped, name);
    });

    console.log("result count", result.get().length);
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
    if (this._page) {
      this._page.close();
      this._page = null;
    }

    const page = await Page.newPageFromBrowser(this._browser);
    this._page = page;
    this._ua = page.getUserAgent();
    await page.goThenWait(BASE);
    const searchSelector = "input#searchLocation";
    await page.click(searchSelector);
    await jitterWait(250, 250);
    await page.repeatDeleteKey(50);
    await jitterWait(250, 250);
    await page.type(searchSelector, "New York, NY", 35);
    await jitterWait(500, 250);
    await page.clickAndWaitForNav("button#search");
    await jitterWait(500, 500);
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
      SPECIALTIES[this._currentSpecialtyIndex]
    } (${this.totalResults()} records, ${this.totalPages()} pages)`;
  }

  async searchIsEnded() {
    const s = ".nfinite-scroll-trigger.cigna-button.cigna-button-purple-light";
    return this._page.do(sel => {
      const elt = document.querySelector(sel);
      if (!elt) {
        return false;
      }
      return elt.nextSibling ? !!elt.nextSibling.nextSibling : false;
    }, s);
  }

  async crawl() {
    await this.setupNewPage();

    do {
      await jitterWait(500, 500);
      await this.applyDistance();
      await jitterWait(500, 500);
      await this.applySpecialty();
      await jitterWait(500, 500);

      let stopSearch = this.catchSearch();

      await this.clickApply();
      await jitterWait(500, 500);
      await this.updatePaginationData();

      l(this.describeSearch());

      while (
        this._currentPage < this.totalPages() ||
        (await this.searchIsEnded())
      ) {
        await this.moreResults();
      }

      stopSearch();

      await this.resetSearch();
      await jitterWait(2000, 1000);
      l(`Finished ${this.describeSearch()}`);
    } while (++this._currentSpecialtyIndex < SPECIALTIES.length);

    l("Search appears to be completed.");

    await this._page.close();
    this._page = null;

    l("Waiting 5 seconds to make sure there's no more search saving.");
    return wait(5000);
  }
}
