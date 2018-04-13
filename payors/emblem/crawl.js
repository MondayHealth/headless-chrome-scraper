import request from "request";
import Page from "../../page";
import { jitterWait } from "../time-utils";
import { ZIP_CODES } from "./ny_zip_codes";

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

export default class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
    this._ua = null;
    this._page = null;
    this._jsid = null;
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

  async doQuery(zipID, networkID, disciplineID) {
    const zipCode = ZIP_CODES[zipID];
    const network = NETWORKS[networkID];
    const disciplines = DISCIPLINES[disciplineID];
    const body = this.getFormData(zipCode, network, disciplines);
    const headers = this.getRequestHeaders();
    const gzip = true;
    const url = Crawl.getFunctionURL("providerSearchResults");

    console.debug(`${new Date()} ${zipCode} ${network} ${disciplineID}`);

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

  async scan() {
    for (let networkID = 0; networkID < NETWORKS.length; networkID++) {
      for (let discID = 0; discID < DISCIPLINES.length; discID++) {
        for (let zipID = 0; zipID < ZIP_CODES.length; zipID++) {
          const response = await this.doQuery(zipID, networkID, discID);

          console.log(response);

          return;
        }
      }
    }
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

    console.assert(this._jsid !== null);
  }
}
