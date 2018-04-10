import List from "./list";
import Detail from "./detail";

export async function scanProviders(browser, redis) {
  const a = new List(browser, redis);
  await a.initialize();
  await a.scanProviders();
  await a.destroy();
}

export async function loadDetail(browser, redis) {
  const d = new Detail(browser, redis);
  const initPromise = d.initialize();
  const providerIDs = await d.getProviderIDs();
  await initPromise;
  await d.getDetailForProvider(providerIDs[0]);
}