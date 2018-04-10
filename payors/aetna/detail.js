import Base, { queryStringFromParams } from "./base";
import Page from "../../page";
import sessionState from "./session_state.json";

const BASE =
  "healthcare/prod/navigator/v3/publicdse_providerdetails/" +
  "publicdse_individualproviderdetails";

export default class Detail extends Base {
  constructor(browser, redis) {
    super(browser, redis);
    this._providerID = null;
    this._locationID = null;
    this._oldPage = null;
  }

  getQueryString() {
    const paramMap = {
      providerIdentifier: this._providerID,
      serviceLocationIdentifier: this._locationID,
      listFieldSelections: "affiliations",
      suppressFutureProv: false,
      suppressFutureGroup: false
    };

    let ret = queryStringFromParams(paramMap);

    ret += "&&responseLanguagePreference=en&siteId=dse";

    return ret;
  }

  async initialize() {
    await super.initialize(true);
    this._oldPage = this._page;
    this._page = null;
    await this._oldPage.setSessionState(sessionState);
  }

  static extractLastUpdate(result) {
    return result.providerResponse.readProviderResponse.listInfoExchanges
      .listInfoExchange[0].values.value[0].value;
  }

  static extractProviderDetail(result) {
    return result.providerResponse.readProviderResponse.providerDetailsResponse;
  }

  async destroy() {
    await super.destroy();
    if (this._oldPage) {
      await this._oldPage.close();
    }
  }

  getProviderPageURL(individual) {
    const page = individual ? "providerDetails" : "providerOrgDetails";
    const pType = individual ? "Individual" : "Organization";
    return (
      Base.getReferrer() +
      "#/contentPage?page=" +
      page +
      "&proId=" +
      this._providerID +
      "&locId=" +
      this._locationID +
      "&distance=0.04&pType=" +
      pType +
      "&site_id=dse&language=en"
    );
  }

  async snoopRequests() {
    return new Promise(resolve => {
      const stop = this._page.listenForRequests(intercepted => {
        console.log(">", intercepted.url());
      });
      resolve(stop);
    });
  }

  async catchRequest(subString) {
    return new Promise(resolve => {
      const stop = this._page.onResponse(intercepted => {
        if (intercepted.url().indexOf(subString) < 0) {
          return;
        }

        console.log("CAUGHT", intercepted.url());

        if (intercepted.request().method() !== "GET") {
          return;
        }

        intercepted.text().then(body => {
          stop();
          resolve(JSON.parse(body));
        });
      });
    });
  }

  async getDetailForProvider(providerID) {
    if (providerID === this._providerID) {
      return;
    }

    const existingData = await this.getProviderDataForID(providerID);
    this._providerID = providerID;
    this._locationID = existingData.providerLocations.locationID;

    if (this._page) {
      this._page.close();
    }

    this._page = await Page.newPageFromBrowser(this._browser);
    const stopSnooping = await this.snoopRequests();

    const waitForDetails = this.catchRequest(BASE);
    const waitForPlanData = this.catchRequest("providerplanandnetworkdetails");
    const networkIdle = this._page.goThenWait(this.getProviderPageURL(true));

    // Get the base provider details
    const providerDetails = await waitForDetails;

    await networkIdle;

    // @TODO: Get other offices

    this._page.click("a#headingPlanDetails");

    // Wait for plan data
    const planData = await waitForPlanData;

    console.log(JSON.stringify(planData, null, 4));
    return stopSnooping();
  }
}
