import UnitedCrawl from "../united/crawl";

export default class OxfordCrawl extends UnitedCrawl {
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

  providerTypes() {
    return [
      "Psychology - Clinical",
      "Neurology and Psychiatry",
      "Licensed Professional Counselor",
      "Social Work",
    ];
  }
}
