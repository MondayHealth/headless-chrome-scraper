import Page, { stripWhitespace } from "../../page";
import { jitterWait, wait } from "../time-utils";
import { e, l } from "../log";
import cheerio from "cheerio";
import { promisify } from "util";
import { DetailScraper } from "./detail";
import { listingKeyForName, searchStateKeyForName } from "../util";

const BASE = "https://hcpdirectory.cigna.com/web/public/providers";

const SCRAPE_DETAILS = false;

const SEARCHES = [
  "Behavioral Health Provider: Mental Health Counselor",
  "Behavioral Health Provider: Psychiatrist",
  "Behavioral Health Provider: Psychologist",
  "Behavioral Health Provider: Social Work"
];

const noop = () => undefined;

const document = {
  querySelector: s => {
    return { s, innerHTML: "foo", outerHTML: "bar" };
  },
  querySelectorAll: noop,
  body: { clientHeight: 0, offsetParent: 0 }
};

const window = { scrollTo: noop };

const NETWORK_NAME = "cigna";
const PROVIDER_LIST_KEY = listingKeyForName(NETWORK_NAME);
const SEARCH_STATE_KEY = searchStateKeyForName(NETWORK_NAME);

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
    // noinspection JSUnresolvedVariable
    this._rSet = promisify(redis.set).bind(redis);
    // noinspection JSUnresolvedVariable
    this._rGet = promisify(redis.get).bind(redis);
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

  async searchIsEnded() {
    const selector =
      "#DoctorsContainer > div.resultsList > div.nfinite-scroll-container" +
      ".nfinite-last-result > nav > p > span";

    const elt = await this._page.$(selector);

    if (!elt) {
      return false;
    }

    return (await this._page.do(e => e.innerHTML, elt)) === "End of results";
  }

  /**
   * Keeps manipulating the page until there are no more results. Returns true
   * if there ARE more results, false otherwise.
   * @returns {Promise<boolean>}
   */
  async moreResults() {
    // Do the first results
    await this.processCurrentResults();

    if (this._currentPage >= this.totalPages()) {
      l("We appear to be at a greater page than the total.");
      return false;
    }

    const ended = await this.searchIsEnded();

    if (ended) {
      l("searchIsEnded() returned true.");
      return false;
    }

    const selector = "button.nfinite-scroll-trigger.cigna-button";
    const elt = await this._page.$(selector);

    if (!elt) {
      l("The nfinite scroll trigger button isnt on the page.");
      return false;
    }

    // Pause here to avoid a ban
    await jitterWait(750, 500);

    // Check to see if its visible
    const visible = await this._page.do(
      sel => !!document.querySelector(sel).offsetParent,
      selector
    );

    if (!visible) {
      await this._page.do(() =>
        window.scrollTo(0, document.body.clientHeight - 100)
      );
    } else {
      await elt.click();
    }

    return true;
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

  async updatePaginationData() {
    const nFiniteSelector = "div.nfinite-scroll-container";
    this._paginationData = await this._page.do(selector => {
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
    await this.storeSearchState();

    const search = SEARCHES[this._currentSearchIndex];
    l(`Beginning new search: ${search}`);

    // Do the new page boilerplate
    if (this._page) {
      l("Making a new page.");
      this._page.close();
      await jitterWait(1000, 1000);
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
    const elt = await page.$(termInputSelector);
    await elt.type(search, { delay: 27 });
    await jitterWait(1000, 250);
    await elt.press("ArrowDown");
    await jitterWait(450, 150);
    await elt.press("Enter");

    // Wait for the "continue with my search" dialog
    await jitterWait(500, 500);
    const cwmsSelector = "#cbm-dialog-1 > div > div.margin-top-md > button";
    await page.waitForSelector(cwmsSelector);
    await page.click(cwmsSelector);

    await jitterWait(500, 250);
    await this.applyDistance();

    await jitterWait(500, 250);
    return await this.clickApply();
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

  /**
   * Human readable search description
   * @returns {string}
   */
  describeSearch() {
    return `${
      SEARCHES[this._currentSearchIndex]
    } (${this.totalResults()} records, ${
      this._currentPage
    } / ${this.totalPages()} pages)`;
  }

  /**
   * Save the current search state
   * @returns {Promise<number>}
   */
  async storeSearchState() {
    return this._rSet(SEARCH_STATE_KEY, this._currentSearchIndex);
  }

  /**
   * Resurrect the last saved search state
   * @returns {Promise<void>}
   */
  async loadSearchState() {
    const ret = await this._rGet(SEARCH_STATE_KEY);
    this._currentSearchIndex = ret ? parseInt(ret) : 0;
    l("Loaded search state: " + ret);
  }

  /**
   *
   * @param $ {Object}
   * @returns {boolean}
   */
  static checkHTMLForRateLimit($) {
    // noinspection JSValidateTypes
    const h1 = $("h1");
    if (!h1.length) {
      return false;
    }
    return h1.eq(0).html() === "Hold up there!";
  }

  saveListing(uid, stripped, name) {
    this._rHSet(PROVIDER_LIST_KEY, uid, stripped).then(result =>
      l(`List : ${uid} : ${name}`, !!result ? "+" : "o")
    );
  }

  /**
   *
   * @param elements {Array}
   * @returns {Promise<Array.<string>>}
   */
  async processListEntries(elements) {
    const rawHTML = await Promise.all(
      elements.map(element => this._page.do(elt => elt.innerHTML, element))
    );

    return rawHTML.map(raw => {
      const $ = cheerio.load(raw);
      const a = $("a[name]").eq(0);
      const uid = a.attr("name");
      const name = a.text();
      const stripped = stripWhitespace(raw);
      this.saveListing(uid, stripped, name);

      // Check this shit out
      const script = "return " + a.attr("onclick").slice(22, -15);
      return new Function(script)();
    });
  }

  /**
   * Process all results on the page right now then remove them
   * @returns {Promise<void>}
   */
  async processCurrentResults() {
    const listEntrySelector = "tr[data-search-result-id]";

    l(`Processing search results.`);
    await this._page.waitForSelector(listEntrySelector, 7000);
    const entries = await this._page.$$(listEntrySelector);
    const detailParams = await this.processListEntries(entries);
    await this.updatePaginationData();

    if (SCRAPE_DETAILS) {
      const ds = new DetailScraper(this._page);
      await ds.getDetails(detailParams, this._rHSet);
    }

    // Remove existing results we just scanned from the page
    l("Removing scraped list entries.");
    return this._page.do(
      s => Array.from(document.querySelectorAll(s)).forEach(e => e.remove()),
      "tr[data-search-result-id]"
    );
  }

  async crawl() {
    await this.loadSearchState();

    do {
      await this.setupNewPage();

      l(this.describeSearch());

      while (await this.moreResults()) {}
      l(`Reached the end of ${this.describeSearch()}`);
    } while (++this._currentSearchIndex < SEARCHES.length);

    l("Search appears to be completed.");

    await this._page.close();
    this._page = null;

    this._currentSearchIndex = 0;
    await this.storeSearchState();

    l("Waiting 5 seconds to make sure there's no more search saving.");
    return wait(5000);
  }
}
