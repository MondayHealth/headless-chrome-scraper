/*
 Set a page up to be searched since there appears to be a bug where you cant
 link to them.
 */

import { e, l, w } from "../log";
import { FEDERAL, PLANS, SEARCH_SETTINGS, SEARCHES } from "./data";
import { jitterWait, wait } from "../time-utils";
import { promisify } from "util";
import { NETWORK_NAME } from "./crawl";
import { searchStateKeyForName } from "../util";

export const RETRY = Symbol("RETRY");

const ADVANCED_SEARCH_SUFFIX =
  "app/public/#/one/city=&" +
  "state=&postalCode=&country=&insurerCode=BCBSA_I&b" +
  "randCode=BCBSANDHF&alphaPrefix=&bcbsaProductId/ad" +
  "vanced-search";

const SEARCH_KEY = searchStateKeyForName(NETWORK_NAME);

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
  currentPlanName() {
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
    return `${this.currentPlanName()} / ${search} (Page ${this._pageIndex})`;
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
    l(`Stored search state ${state}`);
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
      const timeout = setTimeout(() => {
        e(`Waited for search result for more than five minutes!`);
        process.exit(1);
      }, 5 * 60 * 1000);

      let stop = null;

      const stopFailureCheck = this._page.onRequestFailed(request => {
        if (request.url().indexOf("public/service/search") < 0) {
          return;
        }

        w(`Request failed for URL ${request.url()}!`);

        if (stop) {
          stop();
        }

        stopFailureCheck();

        resolve(RETRY);
      });

      stop = this._page.onResponse(response => {
        if (response.url().indexOf("public/service/search") < 0) {
          return;
        }

        const headers = response.request().headers();
        this._distilAjax = headers[DISTL_AJAX_HEADER];

        l("Caught search results");

        response.text().then(body => {
          clearTimeout(timeout);
          stopFailureCheck();
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
      await this._page.waitForSelector(selector, 4000);
      await jitterWait(250, 250);
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
    const sel = 'div[data-test="as-provider-type-section-body"]';

    await this._page.waitForSelector(sel);

    await wait(1000);

    return this._page.do(selector => {
      // noinspection JSUnresolvedVariable
      const b = document.querySelector(selector);
      // noinspection JSUnresolvedFunction
      return Array.from(
        b.querySelectorAll(
          "label.custom-radio > span.custom-control-description"
        )
      ).map(s => s.innerHTML);
    }, sel);
  }

  /**
   *
   * @returns {Promise<Array.<string>>}
   */
  async createProviderSubOptionMap() {
    const sel = 'div[data-test="as-provider-type-section-body"]';

    await this._page.waitForSelector(sel);

    await wait(1000);

    return this._page.do(selector => {
      // noinspection JSUnresolvedVariable
      const b = document.querySelector(selector);
      // noinspection JSUnresolvedFunction
      return Array.from(
        b.querySelectorAll(
          "label.custom-checkbox > span.custom-control-description"
        )
      ).map(s => s.innerHTML);
    }, sel);
  }

  async selectProviderSubOption(idx) {
    const elts = await this._page.$$(
      'div[data-test="as-provider-type-section-body"] label.custom-checkbox'
    );

    console.assert(elts.length);

    await elts[idx].click();
    return jitterWait(250, 500);
  }

  async selectProvider(idx) {
    const selector =
      'div[data-test="as-provider-type-section-body"] > div > ' +
      "div.ember-view > div:nth-child(" +
      (idx + 1) +
      ") > div.form-group > label";

    const elt = await this._page.$(selector);

    if (!elt) {
      console.error("Failed to find element for provider selector");
      console.log(selector);
      process.exit(1);
    }

    await elt.click();
    return jitterWait(1000, 500);
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
    const {
      providerName,
      specialtyNames,
      requireSpecialtySelection,
      subOptions
    } = SEARCH_SETTINGS[this.getCurrentConfiguration()];

    // Select the provider type by index
    const providerMap = await this.createProviderMap();

    if (!providerMap || providerMap.length < 1) {
      console.error("Failed to generate provider map!");
      process.exit(1);
    }

    await this.selectProvider(providerMap.indexOf(providerName));

    const specs = await this.createSpecialtyMap();

    let selected = 0;

    for (let i = 0; i < specialtyNames.length; i++) {
      let idx = specs.indexOf(specialtyNames[i]);
      if (idx < 0) {
        l(
          `${providerName} specialty "${
            specialtyNames[i]
          }" not found for plan ${this.currentPlanName()}. Skipping.`
        );
        continue;
      }
      await this.selectSpecialty(idx);
      selected++;
    }

    if (!selected && requireSpecialtySelection) {
      e(`Failed to select ANY providers for ${this.currentPlanName()}!`);
      console.log(specs);
      return false;
    }

    return true;
  }

  async beginSearch() {
    l(this.describeSearch(), ">");

    const url = `https://${this.domain()}/${ADVANCED_SEARCH_SUFFIX}`;
    l("Going to search page and waiting for networkidle0");
    await this._page.goThenWait(url, true, 90000);

    const plan = this.getCurrentPlan();

    // Federal is a plan, so no selection necessary
    if (plan.productCode !== FEDERAL) {
      // Continue by selecting the specific plan
      const spSelect = 'button[data-test="search-by-plan-trigger"]';
      await this._page.waitForSelector(spSelect);

      // Don't start doing anything until this goes away
      l("Waiting to to make sure feedback popup isnt there");
      await this.declineFeedback();

      await this._page.click(spSelect);
      await jitterWait(750, 750);
      const rbSelect = "button.rad-button.btn.mt-3.btn-link.btn-unstyled";
      await this._page.waitForSelector(rbSelect);
      await this._page.click(rbSelect);
      await jitterWait(750, 750);

      // Search plan by name
      const spbnSelector = 'div[role="dialog"] input.form-control';
      await this._page.click(spbnSelector);
      await jitterWait(750, 750);
      await this._page.type(spbnSelector, plan.name, 25);

      await jitterWait(750, 750);

      // Click the top link
      const topPlanSelector = 'button[data-test="planfix-plan"]';
      await this._page.waitForSelector(topPlanSelector);
      await this._page.click(topPlanSelector);
      await jitterWait(750, 750);
    } else {
      // Don't start doing anything until this goes away
      await this.declineFeedback();
    }

    // Type in location. This may not be necessary if the scrape is run in NYC
    /**
    const inputSelector = "input#doctors-basics-location";
    await this._page.click(inputSelector);
    await this._page.repeatDeleteKey(50);
    await this._page.type(inputSelector, "New York, NY", 25);
    await jitterWait(500, 500);
     */

    if (!(await this.selectProviderTypeAndSpecialties())) {
      w("Plan / provider combination appears to be invalid. Skipping.");
      return null;
    }

    // Initiate the search by clicking form submission button
    let searchResults = this.catchSearch();
    this.declineFeedback().then(() => undefined);
    await this._page.clickAndWaitForNav('button[data-test="as-submit-form"]');

    // Wait for the search results to return
    const possibleReturnValue = await searchResults;

    // Check to see if we need to modify anything about the search since you
    // can not select radius from the advanced page
    const href = await this._page.href();
    let newLoc = href.replace("radius=25", "radius=" + SEARCH_RADIUS);
    if (this._pageIndex > 1) {
      newLoc = newLoc.replace("page=1", "page=" + this._pageIndex);
    }

    // If there's nothing to change, return the search results we caught
    if (href === newLoc) {
      return possibleReturnValue;
    }

    // Otherwise we need to redirect, so do so and resend results
    l("Search params need updating. Redirecting");
    this.declineFeedback().then(() => undefined);
    searchResults = this.catchSearch();
    await this._page.goThenWait(newLoc);
    return searchResults;
  }

  nextSearch() {
    this._pageIndex = 1;
    this._searchConfigurationIndex++;

    // Do we have more search configurations?
    if (this._searchConfigurationIndex < SEARCHES.length) {
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
    let element = await this._page.$(buttonSelector);

    if (!element) {
      return null;
    }

    const promise = this.catchSearch();
    await this._page.click(buttonSelector);
    this.declineFeedback().then(() => undefined);
    this._pageIndex++;
    l("Moving to page " + this._pageIndex);
    await this._page.waitForSelector("div.js-headerContainer");
    l("Moved to page " + this._pageIndex);
    return promise;
  }
}
