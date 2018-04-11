import List from "./list";
import Detail from "./detail";

export async function scanProviders(browser, redis) {
  const a = new List(browser, redis);
  await a.initialize();
  await a.scanProviders();
  await a.destroy();
}

export async function loadDetail(browser, redis) {
  const detail = new Detail(browser, redis);
  const initPromise = detail.initialize();
  await initPromise;

  await detail.getAll();

  console.log("Cleaning up");
  await detail.destroy();
}
