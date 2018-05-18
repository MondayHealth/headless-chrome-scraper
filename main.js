import puppeteer from "puppeteer";
import redis from "redis";
import { getCrawlFunction } from "./payors";
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
  const redisAddress = args.redis;
  l(`Purifying ${redisAddress ? redisAddress : "localhost"}`);

  
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
