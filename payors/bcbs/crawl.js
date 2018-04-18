import { FEDERAL, PLANS, SEARCHES } from "./data";

export default class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
  }

  static queryStringForObject(obj) {
    return Object.entries(obj)
      .map(([key, value]) => key + "=" + value)
      .join("&");
  }

  searchURL(planIndex, searchSettingsIndex, page) {
    const plan = PLANS[planIndex];

    const searchSettings = SEARCHES[searchSettingsIndex];
    const providerType = searchSettings.providerType;
    const specialties = searchSettings.specialties.join("&specialties=");
    const providerSubTypes = searchSettings.providerSubTypes.join(
      "&providerSubTypes="
    );

    const domain = plan.domain ? plan.domain : "provider.bcbs.com";
    const base = `https://${domain}/app/public/#/one/`;

    const firstParams = Crawl.queryStringForObject({
      city: "",
      state: "",
      postalCode: "",
      country: "",
      insurerCode: "BCBSA_I",
      brandCode: plan.brandCode ? plan.brandCode : "BCBSANDHF",
      alphaPrefix: "",
      bcbsaProductId: ""
    });

    const secondPath = "/results/";

    const secondParams = Crawl.queryStringForObject({
      acceptingNewPatients: false,
      alphaPrefix: "",
      boardCertified: "",
      hasExtendedHours: false,
      gender: "",
      isEligiblePCP: false,
      location: "New%2520York%252C%2520NY",
      maxLatitude: "",
      maxLongitude: "",
      minLatitude: "",
      minLongitude: "",
      name: "",
      page: page, // Starts at 1
      patientAgeRestriction: "",
      patientGenderRestriction: "",
      providerCategory: "P",
      providerSubTypes,
      providerType,
      qualityRecognitions: "",
      searchType: "default",
      radius: 50, // 1, 5, 25, 50, 100, 150
      size: 10,
      sort: "DEFAULT",
      specialties
    });

    let ret = base + firstParams + secondPath + secondParams;

    if (plan.productCode !== FEDERAL) {
      ret += "&productCode=" + plan.productCode;
    }

    return ret;
  }

  async crawl() {
    console.log(this.searchURL());
  }
}
