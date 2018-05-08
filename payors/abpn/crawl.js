import { promisify } from "util";
import { l } from "../log";
import Page from "../../page";

const SEARCH_KEY = "abpn:last-search";
const PROVIDER_LIST_KEY = "abpn:provider-list";
const PROVIDER_DETAIL_KEY = "abpn:provider-detail";

const BASE_URL = "https://application.abpn.com/verifycert/verifyCert.asp?a=4";

const SPECIALTIES = [
  "Addiction Psychiatry*",
  "Brain Injury Medicine*",
  "Child and Adolescent Psychiatry",
  `Clinical Neurophysiology*`,
  `Epilepsy*`,
  `Forensic Psychiatry*`,
  `Geriatric Psychiatry*`,
  `Neurodevelopmental Disabilities*`,
  `Neurology Neurology with Special Qualification in Child Neurology`,
  `Neuropsychiatry`,
  `Psychiatry`,
  `Psychosomatic Med/Consultation-Liaison Psychiatry*`
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

  async search() {}

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
