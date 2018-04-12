import Page from "../../page";
import { promisify } from "util";
import { jitterWait } from "../time-utils";

const BASE = "https://www.psychologytoday.com/us/therapists/ny/new-york";

export default class Crawler {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;
    this._userAgent = null;

    this._rGet = promisify(redis.get).bind(redis);
    this._rSet = promisify(redis.set).bind(redis);
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

  async initialize() {
    this._page = await Page.newPageFromBrowser(this._browser);
    this._userAgent = this._page.getUserAgent();

    const goog =
      "https://www.google.com/search?q=psychologytoday+find+a+ther" +
      "apist+new+york&oq=psychologytoday+find+a+therapist+new+york" +
      "&aqs=chrome..69i57.5820j0j7&sourceid=chrome&ie=UTF-8";
    await this._page.goThenWait(goog);
    await this._page.goThenWait(BASE);
    await this._page.clickAndWaitForNav(Crawler.getBreadcrumSelector());

    const results = await this._page.do(
      select =>
        // noinspection JSUnresolvedFunction
        $.makeArray($(select)).map(a => a.href),
      "div.result-actions > a"
    );

    const openMap = results.map(async url => {
      await jitterWait(5000, 5000);
      return this.openProviderPage(url);
    });

    const content = await Promise.all(openMap);

    await this._page.close();
  }
}
