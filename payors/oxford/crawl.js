import UnitedCrawl from "../united/crawl";
import { l } from "../log";
import { jitterWait } from "../time-utils";

export default class OxfordCrawl extends UnitedCrawl {
  constructor(browser, redis) {
    super(browser, redis);

    this._planIndex = 0;
  }

  baseURLAbbreviation() {
    return "oxhp";
  }

  payorAbbreviation() {
    return "uhc.oxhp";
  }

  payorName() {
    return "oxford";
  }

  static plans() {
    return ["Freedom", "Garden State", "Liberty", "Metro"];
  }

  currentPlan() {
    return OxfordCrawl.plans()[this._planIndex];
  }

  providerTypes() {
    return [
      "Psychology - Clinical",
      "Neurology and Psychiatry",
      "Licensed Professional Counselor",
      "Social Work"
    ];
  }

  coverageType() {
    return "medical";
  }

  async loadPlanIndex() {
    const planIndex = await this._rHGet(this.searchStateKey(), "planIndex");
    this._planIndex = !!planIndex ? parseInt(planIndex) : 0;
  }

  async storePlanIndex(newIndex) {
    console.assert(newIndex >= 0);
    const planCount = OxfordCrawl.plans().length;
    console.assert(newIndex <= planCount);

    this._planIndex = newIndex;

    if (newIndex === planCount) {
      l(`Plan rolled over.`);
      return;
    }

    l(`Plan updated to ${this.currentPlan()}`);

    return this._rHSet(this.searchStateKey(), "planIndex", newIndex);
  }

  async newSearch() {
    l("Selecting " + this.currentPlan());
    const planSelector = `#step-0 > div.nodeContainer > ul > li:nth-child(${this
      ._planIndex + 1}) > h3 > div > button`;

    await this._page.waitForSelector(planSelector);
    await this._page.click(planSelector);
    await jitterWait(750, 500);

    const providerType = this.currentProviderType();

    await this._page.type("input#search", providerType, 50);

    const buttonSelector = `button[track="${providerType}"]`;
    await this._page.waitForSelector(buttonSelector);
    await jitterWait(150, 100);
    await this._page.click(buttonSelector);
  }

  async crawl() {
    while (this._planIndex < OxfordCrawl.plans().length) {
      await this.loadPlanIndex();
      l(`Beginning crawl for oxford plan ${this.currentPlan()}`);
      await super.crawl();
      await this.storePlanIndex(this._planIndex + 1);
    }

    l(`Search for all plans complete. Discarding state.`);
    await this.storePlanIndex(0);
  }
}
