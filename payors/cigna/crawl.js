import Page from "../../page";
import { jitterWait } from "../time-utils";

const BASE = "https://hcpdirectory.cigna.com/web/public/providers";

export default class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._page = null;
    this._ua = null;
  }

  async crawl() {
    // Put this in the right place
    const page = await Page.newPageFromBrowser(this._browser);
    this._ua = page.getUserAgent();
    await page.goThenWait(BASE);
    const searchSelector = "input#searchLocation";
    await page.click(searchSelector);
    await jitterWait(250, 250);
    await page.repeatDeleteKey(50);
    await jitterWait(250, 250);
    await page.type(searchSelector, "New York, NY", 35);
    await jitterWait(500, 250);
    await page.clickAndWaitForNav("button#search");
    await jitterWait(500, 500);

    const selector = 'span.ui-slider-handle.ui-state-default.ui-corner-all';
    const handle = await page.$(selector);
    const box = await handle.boundingBox();
    const mouse = page.mouse();
    await mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await mouse.down();
    await jitterWait(100, 100);
    await mouse.move(100, 200);
    await mouse.up();

  }
}
