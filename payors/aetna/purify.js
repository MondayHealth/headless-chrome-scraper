import PurifierBase from "../purifier-base";

export default class PurifyAetna extends PurifierBase {
  /**
   *
   * @param redis {RedisClient}
   */
  constructor(redis) {
    super(redis, "aetna");
  }

  /**
   *
   * @param key {string}
   * @param value {string|null}
   * @return {{key: string, value: Object}}
   */
  processListing(key, value) {}

  /**
   *
   * @param key {string}
   * @param value {string|null}
   * @return {{key: string, value: Object}}
   */
  processDetail(key, value) {}
}
