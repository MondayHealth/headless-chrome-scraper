import Page from "../../page";
import { jitterWait, wait } from "../time-utils";
import { ZIP_CODES } from "../emblem/ny_zip_codes";
import { promisify } from "util";
import { e, l } from "../log";
import { getDetail } from "./detail";

const SEARCH_URL = "https://apps.cignabehavioral.com/web/retrieveProviders.do";

const BASE = "https://apps.cignabehavioral.com/web/consumer.do#/findAtherapist";

const SEARCH_KEY = "cignabhd:last-search";

const DETAIL_KEY = "cignabhd:provider-detail";

const PROVIDER_LIST = "cignabhd:provider-listing";

const noop = () => undefined;
const document = { querySelector: noop, querySelectorAll: noop };
const angular = {
  element: () => {
    return {
      scope: () => {
        return {
          list_specialtyCategories: { data: null },
          list_Relationships: { data: null },
          list_population: { data: null },
          list_Timings: { data: null }
        };
      }
    };
  }
};

export default class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;
    this._ua = null;

    this._currentZipCode = null;
    this._currentSpecialty = null;

    /**
     *
     * @type {[{ id: string, name: string }]}
     * @private
     */
    this._specialtyData = [];

    // noinspection JSUnresolvedVariable
    this._rHSet = promisify(redis.hset).bind(redis);
    // noinspection JSUnresolvedVariable
    this._rHGet = promisify(redis.hget).bind(redis);
    // noinspection JSUnresolvedVariable
    this._rSet = promisify(redis.set).bind(redis);
    // noinspection JSUnresolvedVariable
    this._rGet = promisify(redis.get).bind(redis);
    // noinspection JSUnresolvedVariable
    this._rHExists = promisify(redis.hexists).bind(redis);

    const sigHandle = () => {
      console.log("Caught SIGTERM! Stopping...");
      process.exit(1);
    };

    process.on("SIGINT", sigHandle);
  }

  /**
   *
   * @param newData {[{id: string, name: string}]}
   */
  setSpecialtyData(newData) {
    // It's unclear why this inspection triggers here.
    // noinspection JSUnusedGlobalSymbols
    this._specialtyData = newData;
  }

  async updateSpecialtyData() {
    const result = await this._page.do(
      () =>
        angular.element(document.querySelector("[ng-controller]")).scope()
          .list_specialtyCategories.data
    );

    if (!result) {
      e("Couldn't get specialties.");
      process.exit(1);
    }

    this.setSpecialtyData(result);
  }

  /**
   *
   * @returns {Promise<Array.<Object>>}
   */
  async catchSearch() {
    return new Promise((resolve, reject) => {
      const stop = this._page.onResponse(response => {
        if (response.url().indexOf(SEARCH_URL) !== 0) {
          return;
        }

        if (response.status() !== 200) {
          reject("Bad status " + response.status());
          stop();
          return;
        }

        const dist = JSON.parse(response.request().postData()).distance;
        l("Search distance: " + dist);

        response.text().then(body => {
          stop();

          const result = JSON.parse(body);

          if (result.error !== false) {
            e("Bad result.");
            console.log(result);
            reject(result);
          } else {
            // noinspection JSUnresolvedVariable
            resolve(result.providers);
          }
        });
      });
    });
  }

  async doSearch() {
    const behavioralHealthSwitchSelector =
      "#ContentsAreaHolder > div.ng-scope > div > div > div:nth-child(1) > " +
      "div:nth-child(12) > form > div:nth-child(3) > div > table > tbody > " +
      "tr > td:nth-child(2) > input:nth-child(1)";
    const fiveMileSelector =
      "#ContentsAreaHolder > div.ng-scope > div > div > div:nth-child(1) > " +
      "div:nth-child(12) > form > div:nth-child(7) > div > table > tbody > " +
      "tr > td:nth-child(2) > input:nth-child(1)";
    const optionSelector =
      "#individualOrClinic3 > div > table > tbody > tr > td:nth-child(2) > " +
      "select:nth-child(1) > option:nth-child(" +
      (this._currentSpecialty + 1) +
      ")";

    await this._page.waitForSelector(behavioralHealthSwitchSelector);

    await jitterWait(50, 50);
    await this._page.click(behavioralHealthSwitchSelector);
    await jitterWait(50, 50);
    await this._page.click(fiveMileSelector);
    await jitterWait(50, 50);
    await this._page.click(optionSelector);
    await jitterWait(50, 50);
    const rightArrowSelector = "#individualOrClinic3 #moveright";
    await jitterWait(50, 50);
    await this._page.click(rightArrowSelector);
    await jitterWait(50, 50);

    const zipCodeSelector = 'input[name="zipCode"]';
    const zip = await this._page.$(zipCodeSelector);
    await zip.type(String(this.currentZipCode()), { delay: 30 });

    await jitterWait(50, 50);

    // Do a one mile search
    await this.injectSearchModifier(1);

    const searchResult = this.catchSearch();
    await this._page.clickAndWaitForNav('input[type="submit"]');
    return searchResult;
  }

  /**
   * Modify the angular SPA to change all distance requests to the passed amount
   * @param newDistance {number}
   * @returns {Promise<void>}
   */
  async injectSearchModifier(newDistance) {
    await this._page.do(d => {
      const SCOPE = angular
        .element(document.querySelector("[ng-controller]"))
        .scope();
      const OLD = SCOPE.submitForm;
      SCOPE.submitForm = formData => {
        formData.distance = String(d);
        return OLD.call(SCOPE, formData);
      };
    }, newDistance);
  }

  currentSpecialtyName() {
    return this._specialtyData[this._currentSpecialty]
      ? this._specialtyData[this._currentSpecialty].name
      : this._currentSpecialty;
  }

  describeSearch() {
    return `${this.currentSpecialtyName()} in ${this.currentZipCode()}`;
  }

  currentZipCode() {
    return ZIP_CODES[this._currentZipCode];
  }

  async loadSearchState() {
    const raw = await this._rGet(SEARCH_KEY);
    [this._currentSpecialty, this._currentZipCode] = raw
      ? JSON.parse(raw)
      : [0, 0];
    l(this.describeSearch(), "&");
  }

  async storeSearchState() {
    const val = JSON.stringify([this._currentSpecialty, this._currentZipCode]);
    await this._rSet(SEARCH_KEY, val);
    l("Stored search state: " + val);
  }

  async search() {
    if (this._page) {
      await this._page.close();
      this._page = null;
    }

    await this.storeSearchState();

    this._page = await Page.newPageFromBrowser(this._browser);
    this._ua = this._page.getUserAgent();
    await this._page.goThenWait(BASE, true);

    // I don't like this sort of thing but it needs to eval the JS first
    await wait(500);
    await this.updateSpecialtyData();

    const providers = await this.doSearch();

    const newProviders = [];

    await Promise.all(
      providers.map(async payload => {
        const pid = payload.providerId;
        const lid = payload.locationId;
        const json = JSON.stringify(payload);
        const uid = [pid, lid].join(":");
        const newProvider = !!(await this._rHSet(PROVIDER_LIST, uid, json));
        if (!(await this._rHExists(DETAIL_KEY, pid))) {
          newProviders.push(pid);
        }
        // noinspection JSUnresolvedVariable
        l(
          `${payload.firstName} ${payload.lastName}, ${
            payload.licenseCode
          } (${uid})`,
          newProvider ? "+" : "o"
        );
      })
    );

    l("Scanning for " + newProviders.length + " providers with no detail.");

    const cookies = await this._page.cookies();
    for (let i = 0; i < newProviders.length; i++) {
      let pid = newProviders[i];
      let detail = await getDetail(cookies, this._ua, pid);
      // noinspection JSUnresolvedVariable
      let title = detail.providerDemographicInfo.profileTitle;
      let added = await this._rHSet(DETAIL_KEY, pid, JSON.stringify(detail));
      l(title, !!added ? "+" : "o");
      await jitterWait(100, 50);
    }

    this._currentSpecialty++;

    if (this._currentSpecialty >= this._specialtyData.length) {
      this._currentSpecialty = 0;
      this._currentZipCode++;
    }

    return this._currentZipCode < ZIP_CODES.length;
  }

  async crawl() {
    await this.loadSearchState();

    while (await this.search()) {}

    l("Search appears to be complete!");

    this._currentSpecialty = 0;
    this._currentZipCode = 0;
    return this.storeSearchState();
  }
}
