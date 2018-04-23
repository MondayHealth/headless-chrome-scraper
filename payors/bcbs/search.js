/*
 Set a page up to be searched since there appears to be a bug where you cant
 link to them.
 */

import { l } from "../log";
import { FEDERAL, PLANS, SEARCH_SETTINGS, SEARCHES } from "./data";
import { jitterWait } from "../time-utils";
import { promisify } from "util";

const ADVANCED_SEARCH_SUFFIX =
  "app/public/#/one/city=&" +
  "state=&postalCode=&country=&insurerCode=BCBSA_I&b" +
  "randCode=BCBSANDHF&alphaPrefix=&bcbsaProductId/ad" +
  "vanced-search";

const SEARCH_KEY = "bcbs:last-search";

const DISTL_AJAX_HEADER = "X-Distil-Ajax";

const SEARCH_RADIUS = 50;

export class BCBSSearch {
  constructor(redis) {
    this._page = null;
    this._searchConfigurationIndex = 0;
    this._planIndex = 0;
    this._pageIndex = 1;

    this._distilAjax = null;

    // noinspection JSUnresolvedVariable
    this._rHSet = promisify(redis.hset).bind(redis);
    // noinspection JSUnresolvedVariable
    this._rHGet = promisify(redis.hget).bind(redis);
  }

  setPage(page) {
    this._page = page;
  }

  /**
   * Get the current plans name
   * @returns {string}
   */
  currentPlan() {
    return PLANS[this._planIndex].name;
  }

  /**
   * Get the product code for the current plan
   * @returns {string}
   */
  currentProductCode() {
    return PLANS[this._planIndex].productCode;
  }

  currentSearchSetting() {
    const search = SEARCHES[this._searchConfigurationIndex];
    return SEARCH_SETTINGS[search].providerName;
  }

  /**
   * Get a human readable description of the search state
   * @returns {string}
   */
  describeSearch() {
    const search = this.currentSearchSetting();
    return `${this.currentPlan()} / ${search} (Page ${this._pageIndex})`;
  }

  /**
   * Save the search state
   * @returns {Promise<number>}
   */
  async storeSearchState() {
    const state = [
      this._planIndex,
      this._searchConfigurationIndex,
      this._pageIndex
    ];
    return this._rHSet(SEARCH_KEY, "searchState", JSON.stringify(state));
  }

  /**
   * Reset the search state
   * @returns {Promise<number>}
   */
  async clearSearchState() {
    return this._rHSet(SEARCH_KEY, "searchState", "");
  }

  lastDistilAjaxValue() {
    return this._distilAjax;
  }

  /**
   * Restore the search state
   * @returns {Promise<void>}
   */
  async loadSearchState() {
    const rawState = await this._rHGet(SEARCH_KEY, "searchState");
    [
      this._planIndex,
      this._searchConfigurationIndex,
      this._pageIndex
    ] = rawState ? JSON.parse(rawState) : [0, 0, 1];
    l(`Resuming search ${this.describeSearch()}`);
  }

  getCurrentConfiguration() {
    return SEARCHES[this._searchConfigurationIndex];
  }

  getCurrentPlan() {
    return PLANS[this._planIndex];
  }

  domain() {
    const plan = this.getCurrentPlan();
    return plan.domain ? plan.domain : "provider.bcbs.com";
  }

  /**
   * Catch the first search request that happens on the page and return the
   * contents
   * @returns {Promise<Array.<Object>>}
   */
  async catchSearch() {
    return new Promise(resolve => {
      const stop = this._page.onResponse(response => {
        if (response.url().indexOf("public/service/search") < 0) {
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

  /**
   * Checks for the feedback popup and dismisses it
   * @returns {Promise<void>}
   */
  async declineFeedback() {
    const selector = "a.acsInviteButton.acsDeclineButton";
    try {
      await this._page.waitForSelector(selector);
      await jitterWait(1000, 1000);
      await this._page.click(selector);
      l("Feedback declined.", "=");
    } catch (e) {
      l("No feedback button showed up.", "=");
    }
  }

  /**
   * Returns an array of specialties
   * @returns {Promise<Array.<string>>}
   */
  async createSpecialtyMap() {
    const specialtySelector =
      'div[data-test="as-specialties-section"] > div > div >' +
      "div.filter-content-container.pl-1";
    return this._page.do(selector => {
      // noinspection JSUnresolvedVariable
      const b = document.querySelector(selector);
      // noinspection JSUnresolvedFunction
      return Array.from(
        b.querySelectorAll("span.custom-control-description")
      ).map(s => s.innerHTML);
    }, specialtySelector);
  }

  /**
   *
   * @returns {Promise<Array.<string>>}
   */
  async createProviderMap() {
    return this._page.do(selector => {
      // noinspection JSUnresolvedVariable
      const b = document.querySelector(selector);
      // noinspection JSUnresolvedFunction
      return Array.from(
        b.querySelectorAll("span.custom-control-description")
      ).map(s => s.innerHTML);
    }, 'div[data-test="as-provider-type-section-body"]');
  }

  async selectProvider(idx) {
    const selector =
      'div[data-test="as-provider-type-section-body"] > div > div > ' +
      "div:nth-child(" +
      (idx + 1) +
      ") > div.form-group > label";

    const elt = await this._page.$(selector);

    if (!elt) {
      console.error("Failed to find element for provider selector");
      console.log(selector);
      process.exit(1);
    }

    await elt.click();
    return jitterWait(750, 250);
  }

  async selectSpecialty(idx) {
    const selector =
      'div[data-test="as-specialties-section-body"] > div.filter-content > ' +
      "div.filter-content-container.pl-1 > div:nth-child(" +
      (idx + 1) +
      ") > label";
    const elt = await this._page.$(selector);

    if (!elt) {
      console.error("Failed to find element for specialty selector");
      console.log(selector);
      process.exit(1);
    }

    await elt.click();
    return jitterWait(250, 100);
  }

  async selectProviderTypeAndSpecialties() {
    const { providerName, specialtyNames } = SEARCH_SETTINGS[
      this.getCurrentConfiguration()
    ];

    // Select the provider type by index
    const providerMap = await this.createProviderMap();
    await this.selectProvider(providerMap.indexOf(providerName));

    const specs = await this.createSpecialtyMap();

    for (let i = 0; i < specialtyNames.length; i++) {
      let idx = specs.indexOf(specialtyNames[i]);
      if (idx < 0) {
        l(
          `${providerName} specialty "${
            specialtyNames[i]
          }" not found for plan ${this.currentPlan()}. Skipping.`
        );
        continue;
      }
      await this.selectSpecialty(idx);
    }
  }

  async beginSearch() {
    l(this.describeSearch(), ">");

    const url = `https://${this.domain()}/${ADVANCED_SEARCH_SUFFIX}`;
    await this._page.goThenWait(url);
    await jitterWait(750, 750);

    const plan = this.getCurrentPlan();

    // Federal is a plan, so no selection necessary
    if (plan !== FEDERAL) {
      // Continue by selecting the specific plan
      await this._page.click('button[data-test="search-by-plan-trigger"]');
      await jitterWait(750, 750);
      await this._page.click(
        "button.rad-button.btn.mt-3.btn-link.btn-unstyled"
      );
      await jitterWait(750, 750);

      // Search plan by name
      const spbnSelector = 'div[role="dialog"] input.form-control';
      await this._page.click(spbnSelector);
      await jitterWait(750, 750);
      await this._page.type(spbnSelector, plan.name);

      // Click the top link
      const topPlanSelector = 'button[data-test="planfix-plan"]';
      await this._page.click(topPlanSelector);
      await jitterWait(750, 750);
    }

    // Type in location
    const inputSelector = "input#doctors-basics-location";
    await this._page.click(inputSelector);
    await this._page.repeatDeleteKey(50);
    await this._page.type(inputSelector, "New York City, NY");

    await jitterWait(500, 500);

    await this.selectProviderTypeAndSpecialties();

    await this._page.clickAndWaitForNav('button[data-test="as-submit-form"]');

    const searchResults = this.catchSearch();
    await this.setPageNumberAndRadius();
    return searchResults;
  }

  async setPageNumberAndRadius() {
    let href = await this._page.href();
    href = href.replace("radius=25", "radius=" + SEARCH_RADIUS);

    if (this._pageIndex > 1) {
      href = href.replace("page=1", "page=" + this._pageIndex);
    }

    await jitterWait(250, 250);

    this.declineFeedback().then(() => undefined);
    return this._page.goThenWait(href);
  }

  nextSearch() {
    this._pageIndex = 0;
    this._searchConfigurationIndex++;

    // Do we have more search configurations?
    if (this._searchConfigurationIndex < SEARCH_SETTINGS.length) {
      return true;
    }

    this._searchConfigurationIndex = 0;
    this._planIndex++;

    return this._planIndex < PLANS.length;
  }

  /**
   * Click the next button on the current search.
   * @returns {Promise<null|Object>} Null of no next button or the result of
   *   the next click
   */
  async nextPage() {
    const buttonSelector = 'button[data-test="right-arrow-pagination-link"]';
    const element = await this._page.$(buttonSelector);

    if (!element) {
      return null;
    }

    const promise = this.catchSearch();
    await this._page.click(buttonSelector);
    this.declineFeedback().then(() => undefined);
    this._pageIndex++;
    l("Moving to page " + this._pageIndex);
    return promise;
  }
}
