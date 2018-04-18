import UnitedCrawl from "./crawl";

export async function crawl(browser, redis) {
  const c = new UnitedCrawl(browser, redis);
  await c.crawl();
  await c.destroy();
}
