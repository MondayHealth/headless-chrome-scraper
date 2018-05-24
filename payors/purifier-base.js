import { generateHGet, generateHKeys, generateHSet } from "./redis-util";
import {
  detailKeyForName,
  listingKeyForName,
  purifiedKeyForName
} from "./util";
import { l, w } from "./log";

export default class PurifierBase {
  /**
   *
   * @param redis {RedisClient}
   * @param networkName {string}
   */
  constructor(redis, networkName) {
    this._hget = generateHGet(redis);
    this._hkeys = generateHKeys(redis);
    this._hset = generateHSet(redis);
    this._networkName = networkName;
    this._listKey = listingKeyForName(networkName);
    this._detailKey = detailKeyForName(networkName);
    this._purifiedKey = purifiedKeyForName(networkName);
  }

  /**
   *
   * @param key {string}
   * @param oldValue {string|null}
   * @return {{key: string, value: Object}}
   */
  processListing(key, oldValue) {
    throw new Error("Subclass must override processListing()");
  }

  /**
   *
   * @param key {string}
   * @param oldValue {string|null}
   * @return {{key: string, value: Object}}
   */
  processDetail(key, oldValue) {
    throw new Error("Subclass must override processDetail()");
  }

  /**
   *
   * @param hashKey {string}
   * @param processFunction {function(string, string): {key: string, value:
   *   Object<string, *>}}
   * @return {Promise<number>}
   */
  async doHash(hashKey, processFunction) {
    const oldKeys = await this._hkeys(hashKey);
    const count = oldKeys.length;
    for (let i = 0; i < count; i++) {
      let oldKey = oldKeys[i];
      console.assert(oldKey);
      let oldValue = await this._hget(hashKey, oldKey);
      let { key, value } = processFunction.call(this, oldKey, oldValue);
      await this._hset(this._purifiedKey, key, JSON.stringify(value));
    }
    return count;
  }

  /**
   *
   * @return {Promise<number>}
   */
  async purify() {
    l(`Purifying ${this._networkName}...`);
    const lkeys = await this.doHash(this._listKey, this.processListing);
    const dkeys = await this.doHash(this._detailKey, this.processDetail);
    l(`Purified ${lkeys} list entries and ${dkeys} detail entries.`);
    return lkeys + dkeys;
  }

  destroy() {}
}
