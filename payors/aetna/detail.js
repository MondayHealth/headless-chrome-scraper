import Base from "./base";
import Page from "../../page";
import sessionState from "./session_state.json";

const BASE =
  "healthcare/prod/navigator/v3/publicdse_providerdetails/" +
  "publicdse_individualproviderdetails";

const DETAIL_SET_KEY = "aetna:detail";

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default class Detail extends Base {
  constructor(browser, redis) {
    super(browser, redis);
    this._locationID = null;
  }

  async initialize() {
    await super.initialize(true);
    await this._page.setSessionState(sessionState);
  }

  static extractLastUpdate(result) {
    return result.providerResponse.readProviderResponse.listInfoExchanges
      .listInfoExchange[0].values.value[0].value;
  }

  static extractProviderDetail(result) {
    return result.providerResponse.readProviderResponse.providerDetailsResponse;
  }

  static getProviderPageURL(pid, lid, individual) {
    const page = individual ? "providerDetails" : "providerOrgDetails";
    const pType = individual ? "Individual" : "Organization";
    return (
      Base.getReferrer() +
      "#/contentPage?page=" +
      page +
      "&proId=" +
      pid +
      "&locId=" +
      lid +
      "&distance=0.04&pType=" +
      pType +
      "&site_id=dse&language=en"
    );
  }

  async catchRequest(subString, page) {
    return new Promise(resolve => {
      const stop = page.onResponse(intercepted => {
        if (intercepted.url().indexOf(subString) < 0) {
          return;
        }

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

    const existingData = await this.getProviderDataForID(providerID);
    const lid = existingData.providerLocations.locationID;
    const individual = existingData.providerInformation.type === "Individual";

    if (
      !individual &&
      existingData.providerInformation.type !== "Organization"
    ) {
      console.error("UNKNOWN TYPE", existingData.type);
    }

    const page = await Page.newPageFromBrowser(this._browser);

    // install watchers
    const waitForDetails = this.catchRequest(BASE, page);
    const waitForOtherOffices = this.catchRequest("lastRecordOnPage", page);
    const waitForPlanData = this.catchRequest(
      "providerplanandnetworkdetails",
      page
    );

    const url = Detail.getProviderPageURL(providerID, lid, individual);
    await page.goThenWait(url);

    // Get details
    const providerDetails = await waitForDetails;

    // Get other office details

    const officeSelector = "a#headingOtherOffice";
    await page.waitForSelector(officeSelector);
    await page.click(officeSelector);
    console.log("wait for office");
    const otherOffices = await waitForOtherOffices;

    await wait(500);

    // Wait for plan data
    const planSelector = "a#headingPlanDetails";
    await page.waitForSelector(planSelector);
    await page.click(planSelector);
    console.log("wait for data");
    const planData = await waitForPlanData;

    const ret = {
      details: providerDetails,
      offices: otherOffices,
      plans: planData
    };

    this._rHSet(DETAIL_SET_KEY, providerID, JSON.stringify(ret, null, 2));

    return page;
  }
}
