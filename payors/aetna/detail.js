import Base, { NETWORK_NAME } from "./base";
import Page from "../../page";
import sessionState from "./session_state.json";
import { jitterWait } from "../time-utils";
import List from "./list";
import { detailKeyForName } from "../util";

const BASE =
  "healthcare/prod/navigator/v3/publicdse_providerdetails/" +
  "publicdse_individualproviderdetails";

const DETAIL_SET_KEY = detailKeyForName(NETWORK_NAME);

export default class Detail extends Base {
  constructor(browser, redis) {
    super(browser, redis);
  }

  async initialize() {
    await super.initialize(true);
    await this._page.setSessionState(sessionState);
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

  async getAll(overwrite) {
    const providerIDs = await this.getProviderIDs();
    const keyArray = await this._hKeys(DETAIL_SET_KEY);
    const alreadyLoaded = new Set(keyArray);
    const len = providerIDs.length;
    const loadPromises = new Set();
    const MAX_CONCURRENT = 10;

    let hardStop = false;

    const sigHandle = () => {
      console.log("Caught SIGTERM! Stopping...");
      hardStop = true;
    };

    process.on("SIGINT", sigHandle);

    let index = 0;
    const findNextProviderID = () => {
      while (index < len) {
        let id = providerIDs[index++];
        if (!alreadyLoaded.has(id) || overwrite) {
          alreadyLoaded.add(id);
          return id;
        }
      }

      return null;
    };

    const loadAndClose = async providerID => {
      if (hardStop) {
        return;
      }
      console.debug(`${new Date()} : loading ${providerID} ${index}/${len}`);
      const page = await this.getDetailForProvider(providerID);

      // A null response means that we're not gonna process this one
      if (page !== null) {
        await jitterWait(2500, 2500);
        page.close();
        await jitterWait(2500, 2500);
      }

      // If there are still more to be processed, check them
      const nextID = findNextProviderID();
      if (nextID !== null && !hardStop) {
        return loadAndClose(nextID);
      }
    };

    // Start a limited amount of processes
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      const nextID = findNextProviderID();
      if (nextID === null || hardStop) {
        break;
      }
      let prom = loadAndClose(nextID);
      loadPromises.add(prom.catch(e => console.error(e)));
      await jitterWait(1000, 2000);
    }

    // Wait for all page closures to return
    console.log("Waiting for all page promises to resolve...");
    await Promise.all(Array.from(loadPromises));

    process.removeListener("SIGINT", sigHandle);
  }

  async getDetailForProvider(providerID) {
    const existingData = await this.getProviderDataForID(providerID);
    const lid = existingData.providerLocations.locationID;

    if (!List.listEntryIsAnIndividual(existingData)) {
      return null;
    }

    const page = await Page.newPageFromBrowser(this._browser);

    // install watchers
    const waitForDetails = this.catchRequest(BASE, page);
    const waitForOtherOffices = this.catchRequest("lastRecordOnPage", page);
    const waitForPlanData = this.catchRequest(
      "providerplanandnetworkdetails",
      page
    );

    const url = Detail.getProviderPageURL(providerID, lid, true);
    await page.goThenWait(url);

    // Get details
    const details = await waitForDetails;

    const clickPageSelector = async (select, promise) => {
      await jitterWait(500, 250);
      await page.click(select);
      await jitterWait(500, 250);
      await page.click(select);
      return promise;
    };

    // Get other office details
    const offices = await clickPageSelector(
      "a#headingOtherOffice",
      waitForOtherOffices
    );

    // Wait for plan data
    let plans = await clickPageSelector(
      "a#headingPlanDetails",
      waitForPlanData
    );

    const save = JSON.stringify({ details, offices, plans });
    this._rHSet(DETAIL_SET_KEY, providerID, save);

    return page;
  }
}
