export function getCrawlFunction(networkName) {
  const name = "./" + networkName;
  return require(name).crawl;
}
