export const FEDERAL = Symbol("Federal Employee Program");

export const PLANS = [
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

  // Cant search for physicians
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
  },
  {
    name: "BlueCard PPO/EPO",
    productCode: "BCBSAPPO"
  }
];

export const NURSING = Symbol();

export const PHYSICIAN = Symbol();

export const COUNSELOR = Symbol();

export const SEARCH_SETTINGS = {
  [NURSING]: {
    providerName: "Physician Assistant &amp; Nursing Providers",
    specialtyNames: [
      "Nursing - Psychiatry",
      "Physician Assistant - Psychiatry",
      "Psychiatric Nurse"
    ],
    requireSpecialtySelection: true
  },

  [PHYSICIAN]: {
    providerName: "Physician",
    specialtyNames: [
      "Addiction Medicine",
      "Developmental Behavioral Pediatrics",
      "Child Psychiatry",
      "Psychiatry &amp; Neurology",
      "Psychiatry",
      "Psychoanalysis",
      "Behavioral/Mental Health"
    ],
    subOptions: ["Behavioral/Mental Health"],
    requireSpecialtySelection: true
  },

  [COUNSELOR]: { providerName: "Counselor/Therapist", specialtyNames: [] }
};

export const SEARCHES = Object.getOwnPropertySymbols(SEARCH_SETTINGS);
