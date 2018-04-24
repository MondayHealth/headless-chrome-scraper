import Page from "../../page";
import { jitterWait } from "../time-utils";
import { l } from "../log";

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

export default class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;
    this._ua = null;

    this._lastSearchHeaders = null;
    this._lastURL = null;

    this._currentSpecialtyIndex = 0;
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

    const c = this.catchSearch();
    await this._page.click(searchButton);
    return c;
  }

  /**
   * Catch the first search request that happens on the page and return the
   * contents
   * @returns {Promise<Array.<Object>>}
   */
  async catchSearch() {
    const v =
      "https://hcpdirectory.cigna.com/web/public/providers/searchresults";
    return new Promise(resolve => {
      const stop = this._page.onResponse(response => {
        if (response.url().indexOf(v) !== 0) {
          return;
        }

        this._lastSearchHeaders = response.request().headers();
        this._lastURL = response.url();

        l("Caught search results");

        response.text().then(body => {
          stop();
          resolve(body);
        });
      });
    });
  }

  async clickMoreResults() {
    const selector = "button.nfinite-scroll-trigger.cigna-button";
    const c = this.catchSearch();
    await this._page.click(selector);
    return c;
  }

  async resetSearch() {
    const resetLink = "#filterClearAllP";
    const c = this.catchSearch();
    await this._page.click(resetLink);
    return c;
  }

  async applySpecialty() {
    const [specialties, elements] = await this.getSpecialties();
    const idx = specialties.indexOf(SPECIALTIES[this._currentSpecialtyIndex]);
    console.assert(idx > -1);
    await elements[idx].click;
    await jitterWait(500, 250);
    return this.clickApply();
  }

  async processSearchResults(results) {
    l("This is where i'd process search results");
    console.log(this._lastSearchHeaders.Cookie);
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

    // Drag the distance selector
    const selector = "span.ui-slider-handle.ui-state-default.ui-corner-all";
    await page.waitForSelector(selector);
    const handle = await page.$(selector);
    const box = await handle.boundingBox();
    const mouse = page.mouse();
    await mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await mouse.down();
    await jitterWait(250, 100);
    await mouse.move(200, 0);
    await mouse.up();
    await jitterWait(250, 300);
    await this.clickApply();
    await jitterWait(250, 300);
  }

  async crawl() {
    await this.setupNewPage();

    do {
      let result = await this.applySpecialty();
      await Promise.all([
        this.processSearchResults(result),
        jitterWait(750, 250)
      ]);

      result = await this.clickMoreResults();
      await Promise.all([
        this.processSearchResults(result),
        jitterWait(750, 250)
      ]);

      // Continue making requests until

      // Save query position?

      await this.resetSearch();
    } while (++this._currentSpecialtyIndex < SPECIALTIES.length);

    l("Search appears to be completed.");

    await this._page.close();
    this._page = null;
  }
}
