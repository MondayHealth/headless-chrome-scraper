import Page from "../../page";
import { promisify } from "util";
import { jitterWait } from "../time-utils";

const BASE = "https://www.psychologytoday.com/us/therapists/ny/new-york";

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

  async initialize() {
    this._page = await Page.newPageFromBrowser(this._browser);

    const goog =
      "https://www.google.com/search?q=psychologytoday+find+a+ther" +
      "apist+new+york&oq=psychologytoday+find+a+therapist+new+york" +
      "&aqs=chrome..69i57.5820j0j7&sourceid=chrome&ie=UTF-8";
    await this._page.goThenWait(goog);
    await this._page.goThenWait(BASE);
    await this._page.clickAndWaitForNav(Crawler.getBreadcrumSelector());

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

      console.log(id);
      this._hSet("pt:providers", id, content);
    });

    await this._page.close();
  }
}
