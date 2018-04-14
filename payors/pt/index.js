import Crawl from "./crawl";

const COUNTIES = [
  "new york",
  "richmond",
  "kings",
  "bronx",
  "queens"
];

export async function crawl(browser, redis) {
  const c = new Crawl(browser, redis);
  await c.initialize("queens");
  await c.scan();
  await c.destroy();
}
