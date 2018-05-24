import puppeteer from "puppeteer";
import redis from "redis";
import { getCrawlFunction, getPurifierFunction } from "./payors";
import { l } from "./payors/log";

/**
 *
 * @returns {Object.<string, string|bool>}
 */
function getArguments() {
  const ret = {};
  process.argv.forEach(val => {
    const tokens = val.split("=");
    ret[tokens[0]] = tokens.length > 1 ? tokens[1] : true;
    if (ret[tokens[0]] === "false") {
      ret[tokens[0]] = false;
    }
  });
  return ret;
}

/**
 *
 * @param args {Object.<string, string>}
 * @returns {Promise<void>}
 */
async function scrape(args) {
  const network = args.network;
  const crawl = getCrawlFunction(network);
  const headless = args.headless === undefined ? true : args.headless;

  l(`Crawling ${network} in ${headless ? "headless" : "headful"} mode.`);

  const redisClient = redis.createClient();
  const browser = await puppeteer.launch({ headless });

  try {
    await crawl(browser, redisClient);
  } catch (e) {
    console.error(e);
  }

  console.log("Closing browser...");
  browser.close().catch(e => console.error(e));
  redisClient.quit();
}

/**
 *
 * @param args {Object.<string, string>}
 * @returns {Promise<void>}
 */
async function purify(args) {
  const host = args.redis ? args.redis : "localhost";

  const redisClient = redis.createClient({ host });

  l(`Purifying Redis @ ${host}`);

  const networks = [
    "abpn",
    "aetna",
    "bcbs",
    "cigna",
    "cignabhd",
    "emblem",
    "gt",
    "oscar",
    "pt",
    "united"
  ];

  const purifyNetwork = async name => {
    const Constructor = getPurifierFunction(name);
    const instance = new Constructor(redisClient);
    await instance.purify();
    return instance.destroy();
  };

  try {
    if (args.purify !== true) {
      // Here we assume its purify=network_name
      const networkSet = new Set(networks);
      const networkName = args.purify;
      if (!networkSet.has(networkName)) {
        throw new Error(`Unknown network: ${args.purify}`);
      }
      await purifyNetwork(networkName);
    } else {
      l("No network specified. Purifying all networks.");
      for (let i = 0; i < networks.length; i++) {
        await purifyNetwork(networks[i]);
      }
    }
  } finally {
    redisClient.quit();
  }
}

// noinspection JSUnusedGlobalSymbols
export async function bootstrap() {
  const args = getArguments();

  if (args.network) {
    await scrape(args);
  } else if (args.purify) {
    await purify(args);
  } else {
    throw new Error(
      "Currently only 'network' and 'purify' options are supported."
    );
  }
}
