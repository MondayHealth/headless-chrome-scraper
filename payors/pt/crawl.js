import Page from "../../page";
import { promisify } from "util";
import { jitterWait } from "../time-utils";

const BASE = "https://www.psychologytoday.com/us/therapists/ny/new-york";

const LAST_PAGE_KEY = "pt:last-page";

const PROVIDER_HASH_KEY = "pt:providers";

export default class Crawler {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;

    this._rGet = promisify(redis.get).bind(redis);
    this._rSet = promisify(redis.set).bind(redis);
    this._hSet = promisify(redis.hset).bind(redis);
  }

  static getBreadcrumSelector() {
    return "#geo1 > nav > a.breadcrumb-item.hidden-xs";
  }

  async openProviderPage(url) {
    const newPage = await Page.newPageFromBrowser(this._browser);
    await newPage.goThenWait(url);
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

    const next = this._page.$(nextSelector);

    // This is the end of the list condition
    if (!next) {
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
  }

  async initialize() {
    this._page = await Page.newPageFromBrowser(this._browser);

    const resumeURL = await this._rGet(LAST_PAGE_KEY);

    if (resumeURL) {
      return this._page.goThenWait(resumeURL);
    }

    const goog =
      "https://www.google.com/search?q=psychologytoday+find+a+ther" +
      "apist+new+york&oq=psychologytoday+find+a+therapist+new+york" +
      "&aqs=chrome..69i57.5820j0j7&sourceid=chrome&ie=UTF-8";
    await this._page.goThenWait(goog);
    await this._page.goThenWait(BASE);

    return this._page.clickAndWaitForNav(Crawler.getBreadcrumSelector());
  }
}
