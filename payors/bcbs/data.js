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
    name: "New York, BlueCross & BlueShield of Western",
    productCode: "NYNY8M"
  },
  {
    name: "New York, BlueShield of Northeastern",
    productCode: "NYNY0M"
  },
  {
    name: "New York, Empire Blue Cross Blue Shield",
    productCode: "NYNYM2"
  },
  {
    name: "New York, Excellus Blue Cross Blue Shield",
    productCode: "NYNYM3"
  },
  {
    name: "Federal Employee Program",
    domain: "provider.fepblue.org",
    productCode: FEDERAL,
    brandCode: "BCBSAFEP"
  }
];

export const NURSING = Symbol();

export const PHYSICIAN = Symbol();

export const COUNSELOR = Symbol();

export const SEARCHES = [NURSING, PHYSICIAN, COUNSELOR];

export const SEARCH_SETTINGS = {
  [NURSING]: {
    providerName: "Physician Assistant &amp; Nursing Providers",
    specialtyNames: [
      "Nursing - Psychiatry",
      "Physician Assistant - Psychiatry",
      "Psychiatric Nurse"
    ]
  },

  [PHYSICIAN]: {
    providerName: "Physician",
    specialtyNames: [
      "Addiction Medicine",
      "Developmental Behavioral Pediatrics",
      "Child Psychiatry",
      "Psychiatry &amp; Neurology",
      "Psychiatry",
      "Psychoanalysis"
    ]
  },

  [COUNSELOR]: { providerName: "Counselor/Therapist", specialtyNames: [] }
};
