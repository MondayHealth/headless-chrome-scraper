import request from "request";
import cheerio from "cheerio";
import { e } from "../log";

import { param } from "./old-jquery-serialize";
import { jitterWait, wait } from "../time-utils";

const ORIGIN = "https://hcpdirectory.cigna.com";

/**
 * Take a puppeteer page.cookies() object and transform it into a Cookie header
 * @param raw {Array.<Object.<string, string>>}
 */
function cookieString(raw) {
  return raw.map(({ name, value }) => name + "=" + value).join("; ");
}

export default class Requestor {
  constructor(href, cookie, ua) {
    this._cookie = cookieString(cookie);
    this._href = href;
    this._ua = ua;
  }

  getPOSTHeaders() {
    return {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Cookie: this._cookie,
      Host: "hcpdirectory.cigna.com",
      Origin: ORIGIN,
      Pragma: "no-cache",
      Referer: this._href.split("#")[0],
      "User-Agent": this._ua,
      "X-Requested-With": "XMLHttpRequest"
    };
  }

  /**
   * Make a POST body map for plan requests
   * @param criteria {Object}
   * @returns {{innerContainer: *, outerContainer: *, ajaxURL: *, searchTerm:
   *   *, productCodes: *, medicalProductCode: *, medicalNetworkCode: *,
   *   providerId: number, networkCode: *, newwindow: string, operation:
   *   string, changeURI: *, clearDetails: *, medicalMpoCode: *,
   *   medicalNpoCode: *}}
   */
  static generatePlanMap(criteria) {
    if (criteria.clickEvent === "viewProc") {
      let callbackObjStr = "{type:'viewProcAndCost'}";
      criteria.callback = "$.event.trigger(" + callbackObjStr + ");";
    }
    return {
      innerContainer: criteria.innerContainer,
      outerContainer: criteria.outerContainer,
      ajaxURL: criteria.ajaxURL,
      searchTerm: criteria.searchTerm,
      productCodes: criteria.productCodes,
      medicalProductCode: criteria.medicalProductCode,
      medicalNetworkCode: criteria.medicalNetworkCode,
      providerId: criteria.providerId,
      networkCode: criteria.networkCode,
      newwindow: "false",
      operation: criteria.operation,
      changeURI: criteria.changeURI,
      clearDetails: criteria.clearDetails,
      medicalMpoCode: criteria.medicalMpoCode,
      medicalNpoCode: criteria.medicalNpoCode
    };
  }

  /**
   * Make a POST body map for detail requests
   * @param criteria {Object}
   * @returns {{innerContainer: *, outerContainer: *, ajaxURL: *, searchTerm:
   *   *, productCodes: *, medicalProductCode: *, medicalNetworkCode: *,
   *   providerId: number, networkCode: *, newwindow: string, clickEvent: *,
   *   medicalMpoCode: *, medicalNpoCode: *}}
   */
  static generateDetailMap(criteria) {
    if (criteria.clickEvent === "viewProc") {
      let callbackObjStr = "{type:'viewProcAndCost'}";
      criteria.callback = "$.event.trigger(" + callbackObjStr + ");";
    }
    return {
      innerContainer: criteria.innerContainer,
      outerContainer: criteria.outerContainer,
      ajaxURL: criteria.ajaxURL,
      searchTerm: criteria.searchTerm,
      productCodes: criteria.productCodes,
      medicalProductCode: criteria.medicalProductCode,
      medicalNetworkCode: criteria.medicalNetworkCode,
      /*
       dentalProductCode: criteria.dentalProductCode,
       dentalNetworkCode: criteria.dentalNetworkCode,
       */
      providerId: criteria.providerId,
      networkCode: criteria.networkCode,
      newwindow: "false",
      /*
       operation: criteria.operation,
       changeURI: criteria.changeURI,
       clearDetails: criteria.clearDetails,
       pharmacyProductCode: criteria.pharmacyProductCode,
       pharmacyNetworkCode: criteria.pharmacyNetworkCode,
       callback: criteria.callback,
       medicalGroupCode: criteria.medicalGroupCode,
       */
      clickEvent: criteria.clickEvent,
      /*
       currentPage: criteria.currentPage,
       serviceCode: criteria.serviceCode,
       locationId: criteria.locationId,
       */
      medicalMpoCode: criteria.medicalMpoCode,
      medicalNpoCode: criteria.medicalNpoCode
      /*
       diceServiceCode: criteria.diceServiceCode
       */
    };
  }

  /**
   *
   * @param form {Object}
   * @returns {Promise<string>}
   */
  async getDetail(form) {
    const gzip = true;
    const url = ORIGIN + form.ajaxURL;
    const headers = this.getPOSTHeaders();
    const body = param(form);

    return new Promise((resolve, reject) => {
      request.post({ url, headers, gzip, body }, (err, resp, body) => {
        if (err) {
          e(err);
          console.log(resp);
          reject(err);
          return;
        }

        if (resp.statusCode >= 400) {
          e(`Bad response: ${url}`);
          reject(resp);
          return;
        }

        /**
         * There's a TS01b9ab41 cookie that comes back that we could store
         * though I don't think its related to the session.
        const newCookie = resp.headers["set-cookie"][0];

        if (newCookie) {
          self._cookie = newCookie;
        }
         */

        resolve(body);
      });
    });
  }

  /**
   *
   * @param rawHTML {string}
   * @returns {{info: string, name: string, detailParams: Object[]}}
   */
  processDetail(rawHTML) {
    const $ = cheerio.load(
      rawHTML.replace(/[\t\n\r]/gm, "").replace(/\s\s+/g, " ")
    );

    // We need to do this for the "new Function() thing later"
    // noinspection JSUnusedGlobalSymbols
    $.uriAnchor = {
      makeAnchorMap: () => {
        return { parent: "providerDetailsContainer" };
      },
      makeAnchorString: () => "",
      getVarType: a => {
        return void 0 === a
          ? "Undefined"
          : null === a
            ? "Null"
            : {}.toString.call(a).slice(8, -1);
      }
    };

    const info = $("div.container-fluid")
      .eq(1)
      .html()
      .toString();

    const name = $("h1")
      .html()
      .toString();

    // noinspection JSUnresolvedFunction
    const detailParams = Array.from(
      $("script")
        .map((i, elem) => {
          const raw = $(elem).html();
          const startIndex = raw.indexOf("function getDetails_");

          if (startIndex < 0 || startIndex > 50) {
            return null;
          }

          const script = raw.slice(raw.indexOf("getDetails(") + 11, -3);

          try {
            const plan = raw.split("function getDetails_")[1].split("(){")[0];
            const params = new Function("$", "return " + script)($);
            return { plan, params };
          } catch (err) {
            e("Failed to evaluate script:");
            console.log(script);
            return null;
          }
        })
        .get()
    );

    return { info, name, detailParams };
  }

  static processPlanInfo(rawHTML) {
    const $ = cheerio.load(
      rawHTML.replace(/[\t\n\r]/gm, "").replace(/\s\s+/g, " ")
    );

    // noinspection JSUnresolvedFunction
    return Array.from(
      $("td")
        .map((i, elem) => {
          $(elem).html();
        })
        .get()
    );
  }

  /**
   *
   * @param paramList {Object}
   * @returns {Promise<Object>}
   */
  async getPlans(paramList) {
    const forms = paramList.map(elt => Requestor.generatePlanMap(elt));
    const count = forms.length;
    const results = {};
    for (let i = 0; i < count; i++) {
      let { plan, params } = forms[i];
      let result = await this.getDetail(params);
      results[plan] = Requestor.processPlanInfo(result);
      await jitterWait(500, 500);
    }

    return results;
  }

  async getProvider(raw) {
    const result = await this.getDetail(Requestor.generateDetailMap(raw));
    const { info, name, detailParams } = this.processDetail(result);
    await jitterWait(500, 500);
    const planInfo = await this.getPlans(detailParams);
    await wait(5000000);
  }
}
