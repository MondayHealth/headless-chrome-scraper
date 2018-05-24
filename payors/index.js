export function getCrawlFunction(networkName) {
  const name = "./" + networkName;
  return require(name).crawl;
}

export function getPurifierFunction(networkName) {
  const name = "./" + networkName + "/purify.js";
  return require(name).default;
}