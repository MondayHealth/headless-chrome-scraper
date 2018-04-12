import puppeteer from "puppeteer";
import { scanProviders, loadDetail } from "./payors/aetna";
import redis from "redis";
import { crawl } from "./payors/pt";

// noinspection JSUnusedGlobalSymbols
export async function bootstrap() {
  const redisClient = redis.createClient();
  const browser = await puppeteer.launch();

  try {
    // await scanProviders(browser, redisClient);
    // await loadDetail(browser, redisClient);
    await crawl(browser, redisClient);
  } catch (e) {
    console.error(e);
  }

  console.log("Closing browser...");
  browser.close().catch(e => console.error(e));
  redisClient.quit();
}
