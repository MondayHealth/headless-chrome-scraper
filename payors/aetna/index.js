import List from "./list";

export async function scanProviders(browser, redis) {
  const a = new List(browser, redis);
  await a.initialize();
  await a.scanProviders();
  await a.destroy();
}