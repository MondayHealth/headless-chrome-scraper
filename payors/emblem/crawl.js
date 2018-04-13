export default class Crawl {
  constructor(browser, redis) {
    this._browser = browser;
  }

  getFormData(zip) {
    const network = "EMBLEM - COMMERCIAL NON HMO 28 COUNTIES ONLY";

    const listdiscipline = [
      "ABA,BCABA,BCBA",
      "CADC,CPC,CSW,LCSW,LMFC,LMFT,LMHC,LPC,MFC,MFT,MSW,OCSW,PAT,PC,QMHP,RN,RNCS",
      "EDD,OPSY,PHD,PHDE,PSYD,LP",
      "LLP,MA,PSYE",
      "AD,DO,MD,MDC",
      "PPA",
      "APRN",
      "MH CENTER,OP CLINIC",
      "EAP,LPN,MDNONPSY,MSN,OTHER,P GROUP,RNA,TCM,UNKNOWN"
    ]
      .map(e => "listdiscipline=" + e)
      .join("&");

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
      txtCity: "New+York",
      listState: "NY",
      txtZip: zip,
      listRetrieved: "100",
      listMiles: "3",
      lastname: "",
      firstname: "",
      practitionerName: "",
      txtCounty: "",
      library: "O",
      listNetwork: network.replace(" ", "+"),
      chkVipProvider: "false",
      chkBoardCertifiedOnly: "false",
      chkMedicareProviderOnly: "false",
      listdiscipline,
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
    data.forEach(([k, v]) => ret.push(`${k}=${v}`));
    return ret.join("&");
  }

  async initialize() {
    console.log(this.getFormData(10009));
  }
}
