import { promisify } from "util";

/**
 *
 * @param redis {RedisClient}
 * @returns {function(string, string): Promise.<string|null>}
 */
export function generateHGet(redis) {
  // noinspection JSUnresolvedVariable
  return promisify(redis.hget).bind(redis);
}

/**
 *
 * @param redis {RedisClient}
 * @returns {function(string, string): Promise.<Array.<string>|null>}
 */
export function generateHKeys(redis) {
  // noinspection JSUnresolvedVariable
  return promisify(redis.hkeys).bind(redis);
}

/**
 *
 * @param redis {RedisClient}
 * @returns {function(string, string, string): Promise.<number>}
 */
export function generateHSet(redis) {
  // noinspection JSUnresolvedVariable
  return promisify(redis.hset).bind(redis);
}

