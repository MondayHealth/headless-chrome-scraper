import Crawl from "./crawl";

export async function crawl(browser, redis) {
  const c = new Crawl(browser, redis);
  await c.crawl();
  await c.destroy();
}
