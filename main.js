import puppeteer from "puppeteer";
import { Aetna } from "./payors/aetna";

// noinspection JSUnusedGlobalSymbols
export async function bootstrap() {
  const browser = await puppeteer.launch();
  const a = new Aetna(browser);

  try {
    await a.initialize();
    await a.scanProviders();
    await a.destroy();
  } catch (e) {
    console.error(e);
  }

  console.log("Closing browser...");
  await browser.close();
}
