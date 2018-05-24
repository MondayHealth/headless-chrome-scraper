// For now, this file will be copy/pasted into scraper-archiver which is sub-
// optimal, but these values shouldn't change that often.

/**
 * Key name for the hash map of provider id -> detail
 * @param name {string}
 * @returns {string}
 */
export function detailKeyForName(name) {
  return name + ":provider-detail";
}

/**
 * Key name of the current search state for a provider
 * @param name {string}
 * @returns {string}
 */
export function searchStateKeyForName(name) {
  return name + ":last-search";
}

/**
 * Key name for any ambiguous providers
 * @param name {string}
 * @returns {string}
 */
export function ambiguousKeyForName(name) {
  return name + ":provider-ambiguous";
}

/**
 * Key name for provider id -> search result mapping
 * @param name {string}
 * @returns {string}
 */
export function listingKeyForName(name) {
  return name + ":provider-list";
}

/**
 * Key name for provider id -> insurance network mapping
 * @param name {string}
 * @returns {string}
 */
export function networkKeyForName(name) {
  return name + ":provider-network";
}

export function purifiedKeyForName(name) {
  return name + ":purified";
}