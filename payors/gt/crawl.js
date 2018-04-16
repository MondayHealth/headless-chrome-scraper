import Page from "../../page";
import { l } from "../log";
import { jitterWait } from "../time-utils";

const BASE =
  "https://www.goodtherapy.org/newsearch/search.html?search[stateid]=1";

export class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;
  }

  static nextButtonSelector() {
    return "#resultsDiv > table:nth-child(6) > tbody > tr > td:nth-child(2) > a";
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

    /**
     * Make this request
     *
     * :authority: www.goodtherapy.org
     :method: GET
     :path: /therapists/profile/natalie-ludewig-20161022
     :scheme: https
     accept: text/html,application/xhtml+xml,application/xml;q (get full thing)
    accept-encoding: gzip, deflate, br
    accept-language: en-US,en;q=0.9,ja;q=0.8
    cache-control: no-cache
    cookie: PHPSESSID=74d03e038a6956e60f9dda63700c49f7; GTVisitor=285439525821
    dnt: 1
    pragma: no-cache
    referer: https://www.goodtherapy.org/newsearch/search.html?search[stateid]=1
      upgrade-insecure-requests: 1
    user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3325.181 Safari/537.36
     *
     */

    console.log(hrefs);
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
    await this._page.goThenWait(BASE);

    let nextButton = null;

    do {
      // Do the actual work
      await this.scrapeProvidersOnCurrentPage();

      await jitterWait(250000, 2500);

      nextButton = await this._page.$(Crawl.nextButtonSelector());

      if (nextButton) {
        await this._page.clickAndWaitForNav(Crawl.nextButtonSelector());
      } else {
        l("No next button found");
      }
    } while (nextButton && !hardStop);

    process.removeListener("SIGINT", sigHandle);

    await this._page.close();
    this._page = null;

    l("Scan complete");
  }
}
