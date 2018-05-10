import request from "request";
import Page from "../../page";
import cheerio from "cheerio";
import { jitterWait, wait } from "../time-utils";
import { ZIP_CODES } from "./ny_zip_codes";
import { promisify } from "util";
import { l } from "../log";
import {
  listingKeyForName,
  networkKeyForName,
  searchStateKeyForName
} from "../util";

const NETWORKS = [
  "EMBLEM - COMMERCIAL NON HMO 28 COUNTIES ONLY",
  "EMBLEM - MEDICAID",
  "EMBLEM FIDA PLAN",
  "EMBLEM- COMMERCIAL ESSENTIAL"
];

const DISCIPLINES = [
  "ABA,BCABA,BCBA",
  "CADC,CPC,CSW,LCSW,LMFC,LMFT,LMHC,LPC,MFC,MFT,MSW,OCSW,PAT,PC,QMHP,RN,RNCS",
  "EDD,OPSY,PHD,PHDE,PSYD,LP",
  "LLP,MA,PSYE",
  "AD,DO,MD,MDC",
  "PPA",
  "APRN",
  "MH CENTER,OP CLINIC",
  "EAP,LPN,MDNONPSY,MSN,OTHER,P GROUP,RNA,TCM,UNKNOWN"
];

const DISCIPLINE_NAMES = [
  "Applied behavior Analyst",
  "Counselor, Master's Level",
  "Psychologist, Doctoral Level",
  "Psychologist, Master's Level",
  "Psychiatrist & Medical Doctor",
  "prescribing psychologists",
  "Nurses w/ Prescriptive Authority",
  "NOP Clinic / MH Center",
  "Other"
];

const NETWORK_NAME = "emblem";
const PROVIDER_SET = listingKeyForName(NETWORK_NAME);
const LAST_SEARCH_KEY = searchStateKeyForName(NETWORK_NAME);
const NETWORK_SET = networkKeyForName(NETWORK_NAME);

export default class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._ua = null;
    this._page = null;
    this._jsid = null;

    this._rGet = promisify(redis.get).bind(redis);
    this._rSet = promisify(redis.set).bind(redis);
    this._rHSet = promisify(redis.hset).bind(redis);
    this._rHGet = promisify(redis.hget).bind(redis);

    this._listRequests = [];

    this._networkID = null;
  }

  getFormData(zip, network, disciplines) {
    const listSpecialtyGroups = [2, 10, 6, 7, 11, 9, 16, 15, 8, 13, 17, 3]
      .map(e => `&listSpecialtyGroups=${e}`)
      .join("&");

    const data = {
      viewspecialties: "YES",
      reload: "",
      selProduct: "",
      selSpecialty: "",
      desciplinesByClient: false,
      mrldDesciplines: false,
      txtStreet: "",
      txtCity: "",
      listState: "NY",
      txtZip: zip,
      listRetrieved: "100",
      listMiles: "2",
      lastname: "",
      firstname: "",
      practitionerName: "",
      txtCounty: "",
      library: "O",
      listNetwork: network.replace(new RegExp(" ", "g"), "+"),
      chkVipProvider: "false",
      chkBoardCertifiedOnly: "false",
      chkMedicareProviderOnly: "false",
      listdiscipline: disciplines,
      listSpecialtyGroups,
      listSpecialty: "",
      listLanguages: "",
      listAge: "",
      listGender: "",
      listEthnicity: "",
      txtHandicapp: false,
      txtPubTransport: false,
      acptNewPat: false
    };

    let ret = [];
    Object.entries(data).forEach(([k, v]) => ret.push(`${k}=${v}`));
    return ret.join("&");
  }

  static getFunctionURL(name) {
    const BASE = "https://www.valueoptions.com/referralconnect/";
    return BASE + name + ".do";
  }

  async drainQueue(queue, queueDistance, max) {
    let backoffTime = queueDistance / 8;
    while (queue.length >= max) {
      l(`Too many requests. Backing off ${backoffTime / 1000} seconds.`);
      await wait(backoffTime);
      backoffTime *= 2;
      let now = new Date();
      queue = queue.filter(req => now - req < queueDistance);
    }

    return queue;
  }

  async doListQuery(zipID, networkID, disciplineID) {
    const zipCode = ZIP_CODES[zipID];
    const network = NETWORKS[networkID];
    const disciplines = DISCIPLINES[disciplineID];
    const body = this.getFormData(zipCode, network, disciplines);
    const headers = this.getRequestHeaders();
    const gzip = true;
    const url = Crawl.getFunctionURL("providerSearchResults");

    l(`${networkID} ${zipCode} (${zipID}) ${DISCIPLINE_NAMES[disciplineID]}`);

    // If you do this more then ~10 times per minute you get a spam block
    this._listRequests = await this.drainQueue(this._listRequests, 65000, 10);
    this._listRequests.push(new Date());

    return new Promise((resolve, reject) => {
      request.post({ url, body, headers, gzip }, (e, r, body) => {
        if (e) {
          reject(e);
          return;
        }

        if (r.statusCode !== 200) {
          console.error("Req failed:", r.statusCode);
          reject(body);
          return;
        }

        resolve(body);
      });
    });
  }

  async doDetailQuery(id) {
    const headers = this.getDetailHeaders();
    const gzip = true;
    const url = `${Crawl.getFunctionURL("providerDetails")}?id=${id}&library=0`;

    return new Promise((resolve, reject) => {
      request({ url, headers, gzip }, (error, response, body) => {
        if (error) {
          reject(error);
          return;
        }

        if (response.statusCode !== 200) {
          console.error("Req failed:", response.statusCode);
          reject(body);
          return;
        }

        resolve(body);
      });
    });
  }

  extractProvidersFromListing(rawHTML) {
    const $ = cheerio.load(rawHTML);
    const extraction = $("tr.regRow div#name_layout a")
      .map((i, el) => {
        return {
          ...el.attribs,
          name: $(el)
            .text()
            .trim()
        };
      })
      .get();

    const ret = extraction.map(elt => {
      const components = {};
      elt.href
        .split("?")[1]
        .split("&")
        .map(elt => elt.split("="))
        .forEach(([key, value]) => (components[key] = value));
      return { name: elt.name, id: components.id };
    });

    if (!ret.length) {
      const text = $("#providerSearchForm").text();
      if (text.indexOf("providers found") < 0) {
        if (rawHTML.indexOf("automated program has been detected")) {
          console.error(`${new Date()} !! CAPCHA BLOCK`);
          process.exit();
        }
        console.error("!! No results page doesn't look normal!");
        console.log(rawHTML);
        process.exit();
      }
    }

    return ret;
  }

  static extractProviderDetail(rawHTML) {
    const $ = cheerio.load(rawHTML);

    // The data are stored in trs which each have two tds
    const pairs = $("div.panel tr")
      .map((i, el) => $(el).children("td"))
      .get();

    const data = {};
    const noKey = [];
    pairs.forEach(pair => {
      const key = $(pair[0])
        .text()
        .trim()
        .replace(":", "")
        .replace(/\s/g, "");
      let value = $(pair[1]);

      switch (key) {
        case "OfficeHours":
        case "StateLicenses":
        case "Address":
        case "Specialty":
          value = value.html().replace(/\s\s+/g, " ");
          break;
        default:
          value = value
            .text()
            .trim()
            .replace(/\s\s+/g, " ");
          break;
      }

      if (key) {
        data[key] = value;
      } else if (value) {
        noKey.push(value);
      }
    });

    if (Object.entries(data).length < 4) {
      console.error(`${new Date()} ! Seemingly empty provider detail`);
      console.log(rawHTML);
      process.exit();
    }

    return { data, noKey };
  }

  async updateLastSearch(network, discipline, zip) {
    const val = JSON.stringify([network, discipline, zip]);
    return this._rSet(LAST_SEARCH_KEY, val);
  }

  async getLastSearch() {
    const raw = await this._rGet(LAST_SEARCH_KEY);
    const [network, discipline, zip] = raw ? JSON.parse(raw) : [0, 0, 0];
    return { network, discipline, zip };
  }

  static getUniqueID(name, result) {
    const npi = parseInt(result.data["NPIProviderNumber"]) || null;

    const address = cheerio
      .load(result.data["Address"])
      .text()
      .replace(/\s\s+/g, "");

    return `${npi}:${name}:${address}`
      .replace(/\s/g, "")
      .replace(/[._\-;,]/g, "");
  }

  async providerTakesNetwork(uid, networkID) {
    // Save the networks a provider appears in in a separate key
    const p = await this._rHGet(NETWORK_SET, uid);
    const networkSet = new Set(p ? JSON.parse(p) : []);
    networkSet.add(networkID);
    await this._rHSet(NETWORK_SET, uid, JSON.stringify(Array.from(networkSet)));
  }

  async saveProvider(name, rawResponse, networkID) {
    // Save the provider detail data as a unique id
    const result = Crawl.extractProviderDetail(rawResponse);
    result.name = name;
    const uid = Crawl.getUniqueID(name, result);

    const p1 = this._rHSet(PROVIDER_SET, uid, JSON.stringify(result));
    const p2 = this.providerTakesNetwork(uid, networkID);

    const [add] = await Promise.all([p1, p2]);
    return { add, uid };
  }

  async scan() {
    let { network, discipline, zip } = await this.getLastSearch();

    l(`Starting scan at ${ZIP_CODES[zip]} ${network} ${discipline}`);

    let hardStop = false;

    const sigHandle = () => {
      console.warn("Caught SIGTERM! Stopping...");
      hardStop = true;
    };

    process.on("SIGINT", sigHandle);

    for (; network < NETWORKS.length; network++) {
      if (hardStop) break;

      await this.setNetwork(network);

      for (; discipline < DISCIPLINES.length; discipline++) {
        if (hardStop) break;

        for (; zip < ZIP_CODES.length; zip++) {
          if (hardStop) break;

          let response = await this.doListQuery(zip, network, discipline);
          let providers = this.extractProvidersFromListing(response);
          let providerCount = providers.length;

          for (let pID = 0; pID < providerCount; pID++) {
            if (hardStop) break;

            let { name, id } = providers[pID];
            await jitterWait(1000, 1000);
            let detail = await this.doDetailQuery(id);
            let { add, uid } = await this.saveProvider(name, detail, network);

            // Keep track of when and how something was added
            l(uid, !!add ? "+" : "o");
          }

          // At the time im writing this, im pretty sure you only have to do
          // this here and not at the end of all three loops...
          await this.updateLastSearch(network, discipline, zip);

          await jitterWait(500, 500);
        }
        zip = 0;
      }
      discipline = 0;
    }

    process.removeListener("SIGINT", sigHandle);

    l("Scan complete!");
  }

  getRequestHeaders() {
    return {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp," +
        "image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
      "Cache-Control": "no-cache",
      "Content-Type": "application/x-www-form-urlencoded",
      Connection: "keep-alive",
      Cookie: "JSESSIONID=" + this._jsid,
      DNT: 1,
      Host: "www.valueoptions.com",
      Pragma: "no-cache",
      Referer:
        "https://www.valueoptions.com/referralconnect/" +
        "providerSearch.do?nextpage=nextpage",
      "Upgrade-Insecure-Requests": 1,
      "User-Agent": this._ua
    };
  }

  getDetailHeaders() {
    return {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp," +
        "image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      Cookie: "JSESSIONID=" + this._jsid,
      DNT: 1,
      Host: "www.valueoptions.com",
      Pragma: "no-cache",
      Referer:
        "https://www.valueoptions.com/referralconnect/providerSearchResults.do",
      "Upgrade-Insecure-Requests": 1,
      "User-Agent": this._ua
    };
  }

  async setNetwork(nid) {
    console.assert(nid >= 0);

    if (nid === this._networkID) {
      return;
    }

    l(`Changing to network "${NETWORKS[nid]}"`);

    if (this._page) {
      l("Page already open, closing...");
      await this._page.close();
    }

    const firstURL = Crawl.getFunctionURL("providerDirectory");
    this._page = await Page.newPageFromBrowser(this._browser);
    this._ua = this._page.getUserAgent();
    await this._page.goThenWait(firstURL);
    await jitterWait(1000, 1000);

    const sel = "#listClient";
    const networkList = await this._page.do(selector => {
      // noinspection JSUnresolvedFunction
      return $.makeArray($(selector).children("option")).map(y => [
        y.value,
        y.innerHTML
      ]);
    }, sel);

    const map = {};
    networkList.forEach(([short, long]) => (map[long] = short));

    // noinspection JSUnresolvedFunction
    await this._page.do(({ sel, val }) => $(sel).val(val), {
      sel,
      val: networkList[NETWORKS[nid]]
    });

    await this._page.clickAndWaitForNav("#go");
    await jitterWait(1000, 1000);

    await this._page.clickAndWaitForNav(
      'a[href="/referralconnect/providerSearch.do"]'
    );

    await jitterWait(1000, 1000);
    await this._page.clickAndWaitForNav('a[name="accept"]');
    await jitterWait(250, 250);

    const cookies = await this._page.cookies();
    cookies.forEach(({ name, value }) => {
      if (name === "JSESSIONID") {
        this._jsid = value;
      }
    });

    l("Session id: " + this._jsid);

    console.assert(this._jsid !== null);

    this._networkID = nid;
  }
}
