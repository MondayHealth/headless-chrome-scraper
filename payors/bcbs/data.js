import { jitterWait } from "../time-utils";

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
  },
];

async function selectSpecialty(page, idx) {
  await page.click(
    'div[data-test="as-specialties-section-body"] > div.filter-content > ' +
      "div.filter-content-container.pl-1 > div:nth-child(" +
      (idx + 1) +
      ") > label"
  );
  return jitterWait(250, 100);
}

/**
 * Returns an array of specialties
 * @param page
 * @returns {Promise<Array.<string>>}
 */
async function createSpecialtyMap(page) {
  return page.do(selector => {
    const b = document.querySelector(selector);
    return Array.from(
      b.querySelectorAll("span.custom-control-description")
    ).map(s => s.innerHTML);
  }, 'div[data-test="as-specialties-section"] > div > div > div.filter-content-container.pl-1');
}

async function createProvider ma

async function selectProviderTypeAndSpecialties(page, index, specList) {
  const select =
    'div[data-test="as-provider-type-section-body"] label.custom-radio';
  const elements = await page.$$(select);
  elements[index].click();
  await jitterWait(750, 500);

  const specs = await createSpecialtyMap(page);

  for (let i = 0; i < specList.length; i++) {
    let idx = specs.indexOf(specList[i]);
    console.assert(idx > -1, specList[i]);
    await selectSpecialty(page, idx);
    await jitterWait(250, 100);
  }
}

export const SEARCHES = [
  // Select Assistant & Nursing Providers
  async page => {
    return selectProviderTypeAndSpecialties(page, 5, [
      "Nursing - Psychiatry",
      "Physician Assistant - Psychiatry",
      "Psychiatric Nurse"
    ]);
  },

  // Select physician
  async page => {
    return selectProviderTypeAndSpecialties(page, 4, [
      "Addiction Medicine",
      "Developmental Behavioral Pediatrics",
      "Child Psychiatry",
      "Psychiatry &amp; Neurology",
      "Psychiatry",
      "Psychoanalysis"
    ]);
  },

  // Select counselor with no modifications
  async page => {
    const select =
      'div[data-test="as-provider-type-section-body"] label.custom-radio';
    const elements = await page.$$(select);
    elements[0].click();
    await jitterWait(250, 100);
  }
];
