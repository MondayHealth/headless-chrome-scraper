import request from "request";
import Page from "../../page";
import cheerio from "cheerio";
import { jitterWait } from "../time-utils";
import { ZIP_CODES } from "./ny_zip_codes";
import { promisify } from "util";

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

const PROVIDER_SET = "emblem:providers";

const LAST_SEARCH_KEY = "emblem:last-search";

const NETWORK_SET = "emblem:providers-network";

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

  async doListQuery(zipID, networkID, disciplineID) {
    const zipCode = ZIP_CODES[zipID];
    const network = NETWORKS[networkID];
    const disciplines = DISCIPLINES[disciplineID];
    const body = this.getFormData(zipCode, network, disciplines);
    const headers = this.getRequestHeaders();
    const gzip = true;
    const url = Crawl.getFunctionURL("providerSearchResults");

    console.log(`${new Date()} - ${zipCode} ${networkID} ${disciplineID}`);

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
    const url = Crawl.getFunctionURL("providerDetails") + `?id=${id}&library=0`;

    return new Promise((resolve, reject) => {
      request({ url, headers, gzip }, (e, r, body) => {
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

    return extraction.map(elt => {
      const components = {};
      elt.href
        .split("?")[1]
        .split("&")
        .map(elt => elt.split("="))
        .forEach(([key, value]) => (components[key] = value));
      return { name: elt.name, id: components.id };
    });
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

    return { data, noKey };
  }

  async updateLastSearch(network, discipline, zip) {
    return this._rSet(LAST_SEARCH_KEY, [network, discipline, zip].join(","));
  }

  async getLastSearch() {
    const raw = await this._rGet(LAST_SEARCH_KEY);
    const [networkID, discID, zipID] = raw ? raw.split(",") : [0, 0, 0];
    return { networkID, discID, zipID };
  }

  static getUniqueID(name, result) {
    const npi = parseInt(result.data["NPIProviderNumber"]) || null;
    const address = cheerio
      .load(result.data["Address"])
      .text()
      .replace(/\s\s+/g, "");
    const uid = `${npi}:${name}:${address}`
      .replace(/\s/g, "")
      .replace(/[._\-;,]/g, "");
    return { uid, npi };
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
    const { npi, uid } = Crawl.getUniqueID(name, result);

    const p1 = this._rHSet(PROVIDER_SET, uid, JSON.stringify(result));
    const p2 = this.providerTakesNetwork(uid, networkID);

    const [add] = await Promise.all([p1, p2]);
    return { npi, add, uid };
  }

  async scan() {
    let { networkID, discID, zipID } = await this.getLastSearch();

    console.log(`${new Date()} - Starting ${networkID} ${discID} ${zipID}`);

    let hardStop = false;

    const sigHandle = () => {
      console.log("Caught SIGTERM! Stopping...");
      hardStop = true;
    };

    process.on("SIGINT", sigHandle);

    for (; networkID < NETWORKS.length; networkID++) {
      if (hardStop) break;

      for (; discID < DISCIPLINES.length; discID++) {
        if (hardStop) break;

        for (; zipID < ZIP_CODES.length; zipID++) {
          if (hardStop) break;

          let response = await this.doListQuery(zipID, networkID, discID);
          let providers = this.extractProvidersFromListing(response);
          let providerCount = providers.length;

          for (let pID = 0; pID < providerCount; pID++) {
            if (hardStop) break;

            let { name, id } = providers[pID];
            await jitterWait(1000, 1000);
            let detail = await this.doDetailQuery(id);
            let { npi, add, uid } = await this.saveProvider(
              name,
              detail,
              networkID
            );
            console.log(`${new Date()} ${!!add ? "+" : "o"} ${uid}`);
          }

          // At the time im writing this, im pretty sure you only have to do
          // this here and not at the end of all three loops...
          await this.updateLastSearch(networkID, discID, zipID);
        }
      }
    }

    process.removeListener("SIGINT", sigHandle);
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

  async initialize() {
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
      val: networkList[NETWORKS[0]]
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

    console.log("session id:", this._jsid);

    console.assert(this._jsid !== null);
  }
}
