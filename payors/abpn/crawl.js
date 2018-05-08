import { promisify } from "util";
import { e, l } from "../log";
import Page, { stripWhitespace } from "../../page";
import cheerio from "cheerio";
import request from "request";
import { jitterWait, wait } from "../time-utils";

const SEARCH_KEY = "abpn:last-search";
const PROVIDER_LIST_KEY = "abpn:provider-list";
const PROVIDER_DETAIL_KEY = "abpn:provider-detail";

const BASE_URL = "https://application.abpn.com/verifycert/verifyCert.asp?a=4";
const DETAIL_URL =
  "https://application.abpn.com/verifycert/verifyCert_details.asp?p=";

const SEARCH_STATE = "NY";

const SPECIALTIES = [
  "Addiction Psychiatry*",
  "Brain Injury Medicine*",
  "Child and Adolescent Psychiatry",
  "Clinical Neurophysiology*",
  "Forensic Psychiatry*",
  "Geriatric Psychiatry*",
  "Neurodevelopmental Disabilities*",
  "Neurology with Special Qualification in Child Neurology",
  "Neurology",
  "Neuropsychiatry",
  // "Psychiatry",
  "Psychosomatic Med/Consultation-Liaison Psychiatry*"
];

export default class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;
    this._ua = null;

    this._specialtyIndex = 0;

    // noinspection JSUnresolvedVariable
    this._rHSet = promisify(redis.hset).bind(redis);
    // noinspection JSUnresolvedVariable
    this._rHGet = promisify(redis.hget).bind(redis);
    // noinspection JSUnresolvedVariable
    this._rHExists = promisify(redis.hexists).bind(redis);

    this._rSet = promisify(redis.set).bind(redis);
    this._rGet = promisify(redis.get).bind(redis);

    const sigHandle = () => {
      console.log("Caught SIGTERM! Stopping...");
      process.exit(1);
    };

    process.on("SIGINT", sigHandle);
  }

  static getDefaultSearchState() {
    return [0];
  }

  /**
   *
   * @returns {string}
   */
  describeSearch() {
    return this.getCurrentSpeciality();
  }

  /**
   *
   * @returns {string}
   */
  getCurrentSpeciality() {
    return SPECIALTIES[this._specialtyIndex];
  }

  async setSelectValue(selector, value) {
    return this._page.do(
      ({ selector, value }) => (document.querySelector(selector).value = value),
      { selector, value }
    );
  }

  async storeSearchState() {
    const payload = JSON.stringify([this._specialtyIndex]);
    await this._rSet(SEARCH_KEY, payload);
    l("Stored state " + this.describeSearch());
  }

  async loadSearchState() {
    const raw = await this._rGet(SEARCH_KEY);
    [this._specialtyIndex] = raw
      ? JSON.parse(raw)
      : Crawl.getDefaultSearchState();
    l("Loaded search state " + this.describeSearch());
  }

  async resetSearchState() {
    await this._rSet(SEARCH_KEY, JSON.stringify(Crawl.getDefaultSearchState()));
    l("Reset search state.");
  }

  /**
   * Get a map of specialty names (see above) to select values.
   * @returns {Promise<Object.<string, string>>}
   */
  async getSpecialtyValueMap() {
    return this._page.do(() => {
      const ret = {};
      Array.from(
        document.querySelector('select[name="selSpclty"]').children
      ).forEach(a => (ret[a.innerHTML] = a.value));
      return ret;
    });
  }

  /**
   * Assuming we're on the search page, select the current specialty
   * @returns {Promise<void>}
   */
  async selectCurrentSpeciality() {
    const specialtySelector = 'select[name="selSpclty"]';
    const map = await this.getSpecialtyValueMap();
    return this.setSelectValue(
      specialtySelector,
      map[this.getCurrentSpeciality()]
    );
  }

  /**
   * Increment search pagination counters and whathave you.
   * @returns {boolean} True if there is more to search
   */
  searchPageCompleted() {
    this._specialtyIndex++;

    if (this._specialtyIndex >= SPECIALTIES.length) {
      this._specialtyIndex = 0;
      return false;
    }

    return true;
  }

  /**
   * Strip a bunch of crap out of the HTML column results
   * @param rawHTML
   * @returns {string}
   */
  static cleanColumnHTML(rawHTML) {
    return stripWhitespace(rawHTML)
      .replace(/&#xA0;/g, "")
      .trim();
  }

  /**
   *
   * @param rawHTML {string}
   * @returns {{ name: string, city: string, state: string, specialty: string,
   *   history: string, status: boolean, pid: number }}
   */
  static processSearchResults(rawHTML) {
    const $ = cheerio.load(`<table>${rawHTML}</table>`);

    const tds = $("a")
      .get()
      .map(a => a.parent.parent);

    return tds.map(node => {
      const [name, city, state, specialty, history, rawStatus] = $(node)
        .children("td")
        .get()
        .map(n =>
          $(n)
            .html()
            .toString()
        )
        .map(Crawl.cleanColumnHTML);

      const status = rawStatus.indexOf("Certified") === 0;
      const pid = parseInt(
        $(node)
          .find("a")
          .attr("onclick")
          .split("(")[1]
          .split(")")[0]
      );

      return { name, city, state, specialty, history, status, pid };
    });
  }

  /**
   * Return true if there is a detail for this pid
   * @param entry {{ pid: number, name: string }}
   * @returns {Promise<boolean>}
   */
  async saveProviderListEntry(entry) {
    const payload = JSON.stringify(entry);
    const added = await this._rHSet(PROVIDER_LIST_KEY, entry.pid, payload);
    l(entry.name + " : " + entry.pid, added ? "+" : "o");
    return !!(await this._rHExists(PROVIDER_DETAIL_KEY, entry.pid));
  }

  /**
   * Load, process, and store provider detail from a PID
   * @param pid {number}
   * @returns {Promise<boolean>}
   */
  async doProviderDetail(pid) {
    const url = DETAIL_URL + pid;
    const gzip = true;
    const timeout = 10000;

    const rawHTML = await new Promise((resolve, reject) => {
      request({ url, gzip, timeout }, (error, response, body) => {
        if (error) {
          switch (error.code) {
            case "ETIMEDOUT":
              e("Request to " + url + " timed out.");
              break;
            case "ESOCKETTIMEDOUT":
              e("Request to " + url + " socket timeout.");
              break;
            default:
              e(`Request to ${url} failed with code ${error.code}`);
              break;
          }
          reject(error);
          return;
        }

        if (response.statusCode !== 200) {
          e(`Request to ${url} failed with status ${response.statusCode}`);
          reject(response.statusCode);
          return;
        }

        resolve(body);
      });
    });

    const $ = cheerio.load(rawHTML);
    const table = $("body > table.border");
    const payload = Crawl.cleanColumnHTML(table.html().toString());

    const added = await this._rHSet(PROVIDER_DETAIL_KEY, pid, payload);
    l("DETAIL " + pid, added ? "+" : "o");

    return !!added;
  }

  /**
   * Do one search and return true if there are more pages to be done
   * @returns {Promise<boolean>}
   */
  async search() {
    await this.storeSearchState();

    // Set up the page
    await this._page.goThenWait(BASE_URL, true);
    const stateSelector = 'select[name="selSt"]';
    await this._page.waitForSelector(stateSelector);
    await this.setSelectValue(stateSelector, SEARCH_STATE);
    await this.selectCurrentSpeciality();

    await jitterWait(250, 250);

    // Click the search button
    const searchButton = 'input[name="vcBtnSrc"]';
    console.time(this.describeSearch());
    await this._page.clickAndWaitForNav(searchButton, 50, true);
    console.timeEnd(this.describeSearch());

    // Get the results from the search
    const resultsSelector = "#body > tbody";
    l("Waiting for page render");
    await this._page.waitForSelector(resultsSelector);
    await wait(500);
    l("Getting results");
    const rawHTML = await this._page.do(
      sel => document.querySelector(sel).outerHTML,
      resultsSelector
    );

    // Make an array of all the results
    const results = Crawl.processSearchResults(rawHTML);
    l("Got " + results.length + " results");

    // Save them all and extract ones for which we dont have details
    const detailExists = await Promise.all(
      results.map(result => this.saveProviderListEntry(result))
    );

    // For all the details that dont exist, get them
    let detailPromises = [];
    let total = 0;
    const max = 10;
    for (let i = 0; i < results.length; i++) {
      if (detailExists[i]) {
        continue;
      }

      detailPromises.push(this.doProviderDetail(results[i].pid));
      total++;
      await jitterWait(75, 125);

      if (detailPromises.length >= max) {
        await Promise.all(detailPromises);
        detailPromises = [];
      }
    }

    await Promise.all(detailPromises);
    l("Saved " + total + " detail listings.");

    return this.searchPageCompleted();
  }

  async crawl() {
    await this.loadSearchState();

    l("Initializing session.");
    this._page = await Page.newPageFromBrowser(this._browser);
    await this._page.goThenWait(BASE_URL, true);
    this._ua = this._page.getUserAgent();

    l("Beginning search.");
    while (await this.search()) {}

    l("Search appears to be complete!");
    return this.resetSearchState();
  }
}
