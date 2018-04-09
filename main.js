import puppeteer from "puppeteer";
import { Aetna } from "./payors/aetna";
import redis from "redis";

// noinspection JSUnusedGlobalSymbols
export async function bootstrap() {
  const client = redis.createClient();
  const browser = await puppeteer.launch();

  const a = new Aetna(browser, client);

  try {
    await a.initialize();
    await a.scanProviders();
    await a.destroy();
  } catch (e) {
    console.error(e);
  }

  console.log("Closing browser...");

  browser
    .close()
    .then(() => console.log("Browser closed."))
    .catch(e => console.error(e));

  client.quit();

  console.log("Should exit now.");
}
