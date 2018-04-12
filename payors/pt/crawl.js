import Page from "../../page";
import { promisify } from "util";

const BASE = "https://www.psychologytoday.com";

export default class Crawler {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;
    this._userAgent = null;

    this._rGet = promisify(redis.get).bind(redis);
    this._rSet = promisify(redis.set).bind(redis);
  }

  static getSubmitButtonSelector() {
    return (
      "body > div.container.my-3 > div > div.col-12.col-sm-10.col-lg-12 " +
      "> div > div.row.align-items-inherit.no-gutters.pt-sm-4.pb-sm-0.pb" +
      "-4.td_callout > div.td_callout__fat.px-sm-5.py-lg-5.py-sm-4.py-0 " +
      "> div > div.td_callout__form.form__input-lg.clearfix > form > div" +
      "> button"
    );
  }

  static getBreadcrumSelector() {
    return "#geo1 > nav > a.breadcrumb-item.hidden-xs";
  }

  async initialize() {
    this._page = await Page.newPageFromBrowser(this._browser);
    this._userAgent = this._page.getUserAgent();
    const opts = { waitUntil: "networkidle2" };
    await this._page.go(BASE, opts);
    const loc = "new york";

    // noinspection JSUnresolvedFunction
    await this._page.do(value => ($$("#searchField")[1].value = value), loc);

    await this._page.clickAndWaitForNav(Crawler.getSubmitButtonSelector());
    await this._page.clickAndWaitForNav(Crawler.getBreadcrumSelector());

    const results = this._page.do(baseSelector => {
      // noinspection JSUnresolvedFunction
      $$(baseSelector).map(
        elt => elt.querySelector("div.result-actions > a").href
      );
    }, "div[data-result-url]");

    console.log(results);
  }
}
