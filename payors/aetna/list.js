import ProgressBar from "progress";
import Base from "./base";

const RESULTS_PER_PAGE = 25;

const PAGINATION_KEY = "aetna:last-page";
const RESULT_SET_KEY = "aetna:providers";
const TOTAL_FROM_LAST = "aetna:total-last";

export default class List extends Base {
  constructor(browser, redis) {
    super(browser, redis);
    this._currentPage = 0;
  }

  async updatePagination(data) {
    this._currentPage = parseInt(data.paging.page);
    this._currentTotal = parseInt(data.paging.total);
    const p1 = this._rSet(PAGINATION_KEY, this._currentPage);
    const p2 = this._rSet(TOTAL_FROM_LAST, this._currentTotal);
    return Promise.all([p1, p2]);
  }

  async initialize() {
    await super.initialize();
    this._currentPage = parseInt((await this._rGet(PAGINATION_KEY)) || 0);
  }

  static extractProviderList(responseBody) {
    return responseBody.providersResponse.readProvidersResponse
      .providerInfoResponses;
  }

  static extractPagingData(responseBody) {
    return responseBody.providersResponse.readProvidersResponse.interfacePaging;
  }

  providerInfoQuery() {
    // The first request is very different from the others. Copy it directly.
    if (!this._currentPage) {
      return (
        "healthcare/prod/v3/publicdse_providersearch?searchText=Behavior" +
        "al%20Health%20Professionals&listFieldSelections=affiliations&is" +
        "GuidedSearch=false&state=NY&distance=25&latitude=40.71429999999" +
        "9994&longitude=-74.0067&postalCode=10102&firstRecordOnPage=1&la" +
        "stRecordOnPage=0&&responseLanguagePreference=en&siteId=dse"
      );
    }

    const lastOnPage = RESULTS_PER_PAGE * (this._currentPage + 1);

    const params = {
      searchText: "Behavioral%20Health%20Professionals",
      listFieldSelections: "affiliations",
      isGuidedSearch: false,
      state: "NY",
      distance: 25,
      latitude: 40.7427,
      longitude: -73.99340000000001,
      postalCode: 10199,
      direction: "next",
      total: this._currentTotal,
      firstRecordOnPage: RESULTS_PER_PAGE * this._currentPage + 1,
      lastRecordOnPage: Math.min(lastOnPage, this._currentTotal)
    };
    const param_string = Object.entries(params)
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    const base = "healthcare/prod/v3/publicdse_providersearch";

    // We want to make sure this URL looks EXACTLY like what the SPA produces
    const last = "&&responseLanguagePreference=en&siteId=dse";

    return `${base}?${param_string}${last}`;
  }

  async scanPage() {
    const url = this.providerInfoQuery();
    const headers = this.headersForAPIRequest();
    const { result } = Base.apiRequest(url, headers);
    const providers = List.extractProviderList(result);
    const pagination = List.extractPagingData(result);

    providers.forEach(provider => {
      const id = provider.providerInformation.providerID;
      const raw = JSON.stringify(provider);
      this._rHSet(RESULT_SET_KEY, id, raw);
    });

    return await this.updatePagination(pagination);
  }

  getTotalPages() {
    return this._currentTotal / RESULTS_PER_PAGE;
  }

  async scanProviders() {
    let hardStop = false;

    const sigHandle = () => {
      bar.interrupt("Caught SIGTERM! Stopping...");
      hardStop = true;
    };

    process.on("SIGTERM", sigHandle);
    process.on("SIGINT", sigHandle);

    console.log("Preliminary scrape");
    await this.scanPage();
    console.log("Done.", this._currentTotal, "providers");

    const barFmt = " scraping [:bar] :current / :total :percent :etas";
    const bar = new ProgressBar(barFmt, {
      total: this.getTotalPages(),
      curr: this._currentPage,
      complete: "=",
      incomplete: " ",
      width: 20
    });

    // @TODO: Is <= correct ?
    while (this._currentPage <= this.getTotalPages() && !hardStop) {
      await this.scanPage();
      bar.tick(1, null);
    }

    process.removeListener("SIGINT", sigHandle);
    process.removeListener("SIGTERM", sigHandle);

    console.log("\nComplete!");
  }
}
