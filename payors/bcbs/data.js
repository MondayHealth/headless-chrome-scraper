export const FEDERAL = Symbol("Federal Employee Program");

export const PLANS = [
  {
    name: "BlueCard PPO/EPO",
    productCode: "BCBSAPPO"
  },
  {
    name: "BlueCard PPO Basic",
    productCode: "BCBSABASIC"
  },
  {
    name: "BlueCard Traditional",
    productCode: "BCBSAPAR"
  },
  {
    name: "New York, BC&BS of Western",
    productCode: "NYNY8M"
  },
  {
    name: "New York, Blue Shield of Northeastern",
    productCode: "NYNY0M"
  },
  {
    name: "New York, Empire BCBS",
    productCode: "NYNYM2"
  },
  {
    name: "New York, Excellus BCBS",
    productCode: "NYNYM3"
  },
  {
    name: "Federal Employee Program",
    domain: "provider.fepblue.org",
    productCode: FEDERAL,
    brandCode: "BCBSAFEP"
  }
];

export const SEARCHES = [
  {
    providerType: "CNSLR",
    providerSubTypes: ["9807043", "CNSLR", "8837384", "8112342"],
    specialties: [
      "Addiction%2520Medicine",
      "Behavioral%2520Health%2520Analyst",
      "Clinical%2520Psychology",
      "Licensed%2520Professional%2520Counselor",
      "Marriage%2520%2526%2520Family%2520Therapy",
      "Psychoanalysis",
      "Psychology",
      "Sleep%2520Disorder%2520Diagnostics",
      "Social%2520Work%2520-%2520Chemical%2520Dependency%2520Counselor",
      "Social%2520Work%2520-%2520Clinical"
    ]
  },
  {
    providerType: "PHYSC",
    providerSubTypes: ["9807043", "8109393"],
    specialties: [
      "Addiction%2520Medicine",
      "Adolescent%2520Medicine",
      "Child%2520Psychiatry",
      "Licensed%2520Professional%2520Counselor",
      "Psychiatry",
      "Psychiatry%2520%2526%2520Neurology",
      "Psychoanalysis"
    ]
  },
  {
    providerType: "PHYAST",
    providerSubTypes: ["9807046"],
    specialties: [
      "Nursing%2520-%2520Psychiatry",
      "Physician%2520Assistant%2520-%2520Psychiatry",
      "Psychiatric%2520Nurse"
    ]
  }
];
