import Page from "../../page";
import { l } from "../log";
import { jitterWait } from "../time-utils";
import { promisify } from "util";

const BASE =
  "https://www.goodtherapy.org/newsearch/search.html?search[stateid]=1";

const PROVIER_BASE = "https://www.goodtherapy.org/therapists/profile/";

const PROVIDER_KEY = "gt:providers";

const PREVIOUS_SEARCH = "gt:last-page";

export class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;

    this._rGet = promisify(redis.get).bind(redis);
    this._rDel = promisify(redis.del).bind(redis);
    this._rSet = promisify(redis.set).bind(redis);
    this._rHSet = promisify(redis.hset).bind(redis);
    this._rHGet = promisify(redis.hget).bind(redis);
  }

  static nextButtonSelector() {
    return "#resultsDiv > table:nth-child(6) > tbody > tr > td:nth-child(2) > a";
  }

  async getDetail(uid) {
    const page = await Page.newPageFromBrowser(this._browser);
    const selector = "div.page_content_main_container";
    await page.goThenWait(PROVIER_BASE + uid);
    const content = await page.do(sel => $(sel).html(), selector);
    const result = this._rHSet(PROVIDER_KEY, uid, content);
    l(`${uid} (${content.length})`, !!result ? "+" : "o");
  }

  async scrapeProvidersOnCurrentPage() {
    // This gets loaded async by jQuery, so wait until it shows up
    await this._page.waitForSelector("ul.therapist-list");

    const hrefs = await this._page.do(() => {
      return $.makeArray(
        $("span.view-profile")
          .children("a")
          .map((i, elt) => elt.href)
      );
    });

    const len = hrefs.length;
    for (let i = 0; i < len; i++) {
      await this.getDetail(hrefs[i].split("/").pop());
      await jitterWait(1000,1000);
    }
  }

  async restoreSearchPosition() {
    const previous = await this._rGet(PREVIOUS_SEARCH);
    return this._page.goThenWait(previous ? previous : BASE);
  }

  async saveSearchPosition() {
    return this._rSet(PREVIOUS_SEARCH, this._page.url());
  }

  async scan() {
    // Bad to do multiple scans from the same host
    console.assert(!this._page);

    let hardStop = false;

    const sigHandle = () => {
      console.warn("Caught SIGTERM! Stopping...");
      hardStop = true;
    };

    process.on("SIGINT", sigHandle);

    l("Starting new New York search");

    this._page = await Page.newPageFromBrowser(this._browser);
    this._ua = this._page.getUserAgent();
    await this.restoreSearchPosition();

    let nextButton = null;

    do {
      // If anything after this fails, we want to resume here
      await this.saveSearchPosition();

      // Do the actual work
      await this.scrapeProvidersOnCurrentPage();

      // Give it a second
      await jitterWait(1000,1000);

      nextButton = await this._page.$(Crawl.nextButtonSelector());

      if (nextButton) {
        await this._page.clickAndWaitForNav(Crawl.nextButtonSelector());
      } else {
        l("No next button found. Deleting search state.");
        await this._rDel(PREVIOUS_SEARCH);
      }
    } while (nextButton && !hardStop);

    process.removeListener("SIGINT", sigHandle);

    await this._page.close();
    this._page = null;

    l("Scan complete");
  }
}
