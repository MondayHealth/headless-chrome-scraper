import { promisify } from "util";
import { e, l, w } from "../log";
import vm from "vm";
import cheerio from "cheerio";
import { wait } from "../time-utils";
import Page from "../../page";
import Http2Client from "../http2-util";

const AUTHORITY = "www.hioscar.com";
const HOST = "https://" + AUTHORITY;
const BASE_URL = HOST + "/search/";

const SEARCH_KEY = "oscar:last-search";
const PROVIDER_LIST_KEY = "oscar:provider-list";
const PROVIDER_DETAIL_KEY = "oscar:provider-detail";
const AMBIGUOUS_PROVIDER_KEY = "oscar:ambiguous-provider";

const SEARCH_ZIP = 10012;
const PAGINATION = 20;

/**
 *
 * @type {Array.<{name: string, id: string}>}
 */
const PROVIDER_TYPES = [
  { name: "Marriage and Family Therapist", id: "142" },
  { name: "Mental Health Counselor", id: "052" },
  { name: "Psychiatrist", id: "102" },
  { name: "Psychiatrist specializing in Pediatrics", id: "113" },
  { name: "Psychiatrist specializing in addiction problems", id: "002" },
  { name: "Psychiatrist specializing in geriatrics ", id: "031" },
  { name: "Psychologist", id: "103" },
  { name: "Social Worker", id: "109" }
];

/**
 *
 * @type {Array.<{name: string, id: string}>}
 */
const PLANS = [
  { name: "Individual", id: "INDIVIDUAL" },
  { name: "Employer", id: "O4B" }
];

export default class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;

    this._ua = "";

    this._providerIndex = 0;
    this._pageIndex = 0;
    this._planIndex = 0;

    this._currentPageTotal = -1;

    this._cookieHeader = "";

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

  async updateCookieHeader() {
    /**
     * landing_page="/search/?";
     * guid=c1005924-c1b5-45c0-a9c3-d1a8160491fe;
     * oscar_language=en;
     * session_oscar=.eJxNzMEK...
     */
    const cookies = await this._page.cookies();
    const map = { landing_page: '"search/?"' };
    cookies.forEach(({ name, value }) => (map[name] = name + "=" + value));
    const order = ["landing_page", "guid", "oscar_language", "session_oscar"];
    this._cookieHeader = order.map(name => map[name]).join("; ");
  }

  getReferer() {
    let base = `${HOST}/search/001/doctors?year=2018&planType=${this.planID()}`;
    if (this._pageIndex === 0) {
      return base;
    }
    base += `&search_id=${this.providerID()}&q=`;
    if (this._pageIndex === 1) {
      return base;
    }
    return base + "&page_start_idx=" + (this._pageIndex - 1) * PAGINATION;
  }

  getDetailHeaders() {
    return {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp," +
        "image/apng,*/*;q=0.8",
      "accept-encoding": "gzip, deflate, br",
      "accept-language": "en-US,en;q=0.9,ja;q=0.8",
      "cache-control": "no-cache",
      cookie: this._cookieHeader,
      dnt: 1,
      pragma: "no-cache",
      "upgrade-insecure-requests": 1,
      referer: this.getReferer(),
      "user-agent": this._ua
    };
  }

  getHeaders() {
    return {
      accept: "*/*",
      "accept-encoding": "gzip, deflate, br",
      "accept-language": "en-US,en;q=0.9",
      cookie: this._cookieHeader,
      referer: this.getReferer(),
      "user-agent": this._ua
    };
  }

  async storeSearchState() {
    const payload = JSON.stringify([
      this._pageIndex,
      this._providerIndex,
      this._planIndex
    ]);
    await this._rSet(SEARCH_KEY, payload);
    l("Stored state " + this.describeSearch());
  }

  async loadSearchState() {
    const raw = await this._rGet(SEARCH_KEY);
    [this._pageIndex, this._providerIndex, this._planIndex] = raw
      ? JSON.parse(raw)
      : [0, 0, 0];
    l("Loaded search state " + this.describeSearch());
  }

  async resetSearchState() {
    await this._rSet(SEARCH_KEY, JSON.stringify([0, 0, 0]));
    l("Reset search state.");
  }

  /**
   * Describe the current search in a human readable form
   * @returns {string}
   */
  describeSearch() {
    const page = this._pageIndex;

    let ret = `${this.planName()} : ${this.providerName()} : ${page}`;

    if (this._currentPageTotal > 0) {
      ret += ` / ${this._currentPageTotal}`;
    }

    return ret;
  }

  providerID() {
    return PROVIDER_TYPES[this._providerIndex].id;
  }

  providerName() {
    return PROVIDER_TYPES[this._providerIndex].name;
  }

  planID() {
    return PLANS[this._planIndex].id;
  }

  planName() {
    return PLANS[this._planIndex].name;
  }

  /**
   * Get the request path for the HTTP2 GET request for the current search page
   * @returns {string}
   */
  getPath() {
    return (
      "/search/api/001/doctors/" +
      this.providerID() +
      "?page_start_idx=" +
      this._pageIndex * PAGINATION +
      "&distance=20&zip_code=" +
      SEARCH_ZIP +
      "&year=2018&planType=" +
      this.planID()
    );
  }

  /**
   * Increment the current page and return if the search is over or not
   * @returns {boolean}
   */
  currentPageComplete() {
    this._pageIndex++;

    if (this._pageIndex >= this._currentPageTotal) {
      this._providerIndex++;
      this._pageIndex = 0;
    }

    if (this._providerIndex >= PROVIDER_TYPES.length) {
      this._planIndex++;
      this._providerIndex = 0;
    }

    const more = this._planIndex < PLANS.length;

    if (!more) {
      this._planIndex = 0;
    }

    return more;
  }

  async addToAmbiguousProvider(data) {
    const id = data.name;
    await this._rHSet(AMBIGUOUS_PROVIDER_KEY, id, JSON.stringify(data));
    w("Ambiguous provider: " + id);
  }

  /**
   *
   * @param provider {{name: string, npi: string, id: string, locations:{id:
   *   string}[]}}
   * @returns {Promise<{id: string, location: string}[]>}
   */
  async processProvider(provider) {
    if (!provider.npi) {
      await this.addToAmbiguousProvider(provider);
      return [];
    }

    const payload = JSON.stringify(provider);
    const added = await this._rHSet(PROVIDER_LIST_KEY, provider.npi, payload);

    l(`${provider.name} (NPI: ${provider.npi})`, !!added ? "+" : "o");

    const noDetail = [];
    if (!(await this._rHExists(PROVIDER_DETAIL_KEY, provider.npi))) {
      for (let i = 0; i < provider.locations.length; i++) {
        noDetail.push({
          id: provider.id,
          location: provider.locations[i].id
        });
      }
    }

    return noDetail;
  }

  /**
   *
   * @param detail {{augmented_provider: {provider: {npi: string} } }}
   * @returns {Promise<void>}
   */
  async processProviderDetail(detail) {
    const npi = detail.augmented_provider.provider.npi;

    if (!npi) {
      e("Provider detail has no NPI number");
      console.log(this.describeSearch());
      console.log(detail);
      process.exit(1);
    }

    const payload = JSON.stringify(detail);
    const added = await this._rHSet(PROVIDER_DETAIL_KEY, npi, payload);
    l("DETAIL " + npi, !!added ? "+" : "o");
  }

  /**
   * Get the GET request path for a provider detail page
   * @param id {string}
   * @param location {string}
   * @returns {string}
   */
  static getDetailPath(id, location) {
    return [HOST, "people", id, location].join("/") + "/";
  }

  static extractDetailFromPageHTML(rawHTML) {
    const $ = cheerio.load(rawHTML);
    const longestScript = $("script")
      .get()
      .filter(a => a.attribs.src === undefined && a.parent.name === "head")
      .map(a => a.firstChild.data)
      .reduce((a, b) => (a.length > b.length ? a : b));

    // noinspection JSUnusedGlobalSymbols
    const sandbox = {
      window: {},
      osc: {},
      oscFluxInitialState: { providerProfile: null },
      document: { getElementsByTagName: () => [{ className: "" }] }
    };

    const script = new vm.Script(longestScript);
    const context = vm.createContext(sandbox);
    script.runInContext(context);

    return sandbox.oscFluxInitialState.providerProfile;
  }

  /**
   * Do a search iteration
   * @returns {Promise<boolean>}
   */
  async search() {
    await this.storeSearchState();

    // Make the request
    const headers = this.getHeaders();

    const client = new Http2Client(HOST, AUTHORITY);

    // Oscar is smart enough not to gzip small text blobs
    l(this.getPath(), ">");
    const raw = await client.req(this.getPath(), headers, true);

    /**
     *
     * @type {{results: {totalResults: number, hits: {name: string, npi:
     *   string, id: string, locations:{id: string}[]}[]}}}
     */
    const result = JSON.parse(raw);
    this._currentPageTotal = Math.ceil(
      result.results.totalResults / PAGINATION
    );
    const providers = result.results.hits;

    // This array now contains all providers about which we have no details
    const fxn = this.processProvider.bind(this);
    const noDetailSet = await Promise.all(providers.map(fxn));
    const detailHeaders = this.getDetailHeaders();
    for (let i = 0; i < noDetailSet.length; i++) {
      // For each element in the array, there's an array of id:location pairs
      let noDetails = noDetailSet[i];
      for (let j = 0; j < noDetails.length; j++) {
        let { id, location } = noDetails[j];
        let path = Crawl.getDetailPath(id, location);

        l(path, ">");
        let rawResult = await client.req(path, detailHeaders);

        let detailResult = Crawl.extractDetailFromPageHTML(rawResult);

        if (!detailResult) {
          e("Failed to find detail result from request!");
          console.log(id, location);
          console.log(rawResult);
          process.exit(1);
        }

        await Promise.all([
          this.processProviderDetail(detailResult),
          wait(250)
        ]);
      }
    }

    client.dispose();

    return this.currentPageComplete();
  }

  async crawl() {
    await this.loadSearchState();

    l("Initializing session.");
    this._page = await Page.newPageFromBrowser(this._browser);
    await this._page.goThenWait(BASE_URL, true);
    this._ua = this._page.getUserAgent();
    await this.updateCookieHeader();

    l("Beginning search.");
    while (await this.search()) {}

    l("Search appears to be complete!");
    return this.resetSearchState();
  }
}
