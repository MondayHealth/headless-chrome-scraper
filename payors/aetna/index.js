import List from "./list";
import Detail from "./detail";

async function scanProviders(browser, redis) {
  const a = new List(browser, redis);
  await a.initialize();
  await a.scanProviders();
  await a.destroy();
}

async function loadDetail(browser, redis) {
  const detail = new Detail(browser, redis);
  const initPromise = detail.initialize();
  await initPromise;

  await detail.getAll();

  console.log("Cleaning up");
  await detail.destroy();
}

export async function crawl(browser, redis) {

  const sigHandle = () => {
    console.log("Caught SIGTERM! Stopping...");
    process.exit(1);
  };

  process.on("SIGINT", sigHandle);

  // await scanProviders(browser, redis);
  await loadDetail(browser, redis);
}
