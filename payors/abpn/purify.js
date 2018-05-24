import PurifierBase from "../purifier-base";

export default class PurifyABPN extends PurifierBase {
  /**
   *
   * @param redis {RedisClient}
   */
  constructor(redis) {
    super(redis, "abpn");
  }

  /**
   *
   * @param key {string}
   * @param oldValue {string|null}
   * @return {{key: string, value: Object}}
   */
  processListing(key, oldValue) {
    console.assert(oldValue, "no value for key " + key);

    /**
     *
     * @type {{specialty: string, name: string}}
     */
    const value = JSON.parse(oldValue);

    const nameTokens = value.name.split(",").map(elt => elt.trim());

    console.assert(nameTokens.length === 2, "weird name: " + value.name);

    value.lastName = nameTokens[0];

    const specialty = value.specialty;
    delete value.specialty;

    value.certificates = {};

    const [spec, cert] = specialty.split("<br>");
    value.certificates[spec] = cert;

    return { key, value };
  }

  /**
   *
   * @param key {string}
   * @param value {string|null}
   * @return {{key: string, value: Object}}
   */
  processDetail(key, value) {}
}
