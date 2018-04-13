import Page from "../../page";
import { promisify } from "util";
import { jitterWait } from "../time-utils";

const BASE = "https://www.psychologytoday.com/us/therapists/ny/";

const LAST_PAGE_KEY = "pt:last-page";

const PROVIDER_HASH_KEY = "pt:providers";

const CURRENT_SEARCH_COUNTY = "pt:county";

export default class Crawler {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;

    this._rGet = promisify(redis.get).bind(redis);
    this._rSet = promisify(redis.set).bind(redis);
    this._rDel = promisify(redis.del).bind(redis);
    this._hSet = promisify(redis.hset).bind(redis);
  }

  async openProviderPage(url) {
    const newPage = await Page.newPageFromBrowser(this._browser);
    await newPage.goThenWait(url);
    await newPage.waitForSelector("html");
    const content = await newPage.getHTML();
    await jitterWait(1000, 1000);
    await newPage.close();
    return { content, url };
  }

  async saveAllProviders() {
    // noinspection JSUnresolvedFunction
    const results = await this._page.do(
      select => $.makeArray($(select)).map(a => a.href),
      "div.result-actions > a"
    );

    const openMap = [];
    const len = results.length;
    for (let i = 0; i < len; i++) {
      await jitterWait(1000, 1000);
      openMap.push(this.openProviderPage(results[i]));
    }

    const content = await Promise.all(openMap);

    content.forEach(({ content, url }) => {
      const tokens = url.split("/");
      const ptID = tokens[6].split("?")[0];
      const id = tokens[5] + "/" + ptID;

      this._hSet(PROVIDER_HASH_KEY, id, content);
    });

    return content.length;
  }

  async clickNext() {
    const nextSelector =
      "body > div.prof-results.psychologytoday > div.conta" +
      "iner.main-content > div.results-bottom1 > div > div" +
      " > div > div.hidden-xs-down > a.btn.btn-default.btn" +
      "-next";

    const nextButton = await this._page.$(nextSelector);
    if (nextButton === null) {
      console.log("No 'next' button!");
      return null;
    }

    await this._page.clickAndWaitForNav(nextSelector);
    return this._page.url();
  }

  async destroy() {
    await this._page.close();
    this._page = null;
  }

  async scan() {
    let total = 0;
    let newURL = this._page.url();
    let hardStop = false;

    const sigHandle = () => {
      console.log("Caught SIGTERM! Stopping...");
      hardStop = true;
    };

    process.on("SIGINT", sigHandle);

    console.log("Starting scan at", newURL);

    do {
      let count = await this.saveAllProviders();

      total += count;
      console.log(`${new Date()} - saved ${count} providers (${total})`);
      newURL = await this.clickNext();
      console.log(`${new Date()} - continuing to ${newURL}`);

      await this._rSet("pt:last-page", newURL);
      await jitterWait(1000, 1000);
    } while (newURL && !hardStop);

    process.removeListener("SIGINT", sigHandle);

    console.log("Complete!");

    if (newURL === null) {
      console.log("Seem to have completed scrape, deleting last page key.");
      await this._rDel(LAST_PAGE_KEY);
      await this._rDel(CURRENT_SEARCH_COUNTY);
    }
  }

  static getCountyBaseURL(county) {
    console.assert(county);
    return BASE + county.replace(" ", "-") + "-county";
  }

  async initialize(county) {
    this._page = await Page.newPageFromBrowser(this._browser);

    const resumeURL = await this._rGet(LAST_PAGE_KEY);

    if (resumeURL) {
      const lastCounty = await this._rSet(CURRENT_SEARCH_COUNTY, county);
      if (lastCounty !== county) {
        console.warn(
          "The county being resumed",
          lastCounty,
          "is different from the one passed",
          county
        );
      }
      await this._page.goThenWait(resumeURL);
      return true;
    }

    console.log("Beginning new traversal of", county, "starting with google.");
    await this._rSet(CURRENT_SEARCH_COUNTY, county);

    const goog =
      "https://www.google.com/search?q=psychologytoday+find+a+ther" +
      "apist+new+york&oq=psychologytoday+find+a+therapist+new+york" +
      "&aqs=chrome..69i57.5820j0j7&sourceid=chrome&ie=UTF-8";
    await this._page.goThenWait(goog);
    await this._page.goThenWait(Crawler.getCountyBaseURL(county));
    return false;
  }
}
