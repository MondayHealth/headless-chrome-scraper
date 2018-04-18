import { gunzip } from "zlib";

// Apparently this isn't added yet because it's stage 1 experimental
// noinspection NpmUsedModulesInstalled
import http2 from "http2";

export default class Http2Client {
  constructor(url, authority) {
    this._client = http2.connect(url);
    this._authority = authority;
    this._client.on("error", error => {
      console.error("!! HTTP2 LIBRARY ERROR !!");
      console.error(error);
    });
  }

  async req(path, headers) {
    const options = {
      ":authority": this._authority,
      ":method": "GET",
      ":scheme": "https",
      ":path": path,
      ...headers
    };

    const req = this._client.request(options);

    req.on("response", headers => {
      const encoding = headers["content-encoding"];
      if (!encoding || encoding !== "gzip") {
        console.error("Server did not send a gzip encoded response!", encoding);
      }
    });

    const data = [];
    req.on("data", chunk => data.push(chunk));

    return new Promise((resolve, reject) => {
      req.on("end", () => {
        gunzip(Buffer.concat(data), (err, buffer) => {
          if (err) {
            reject("failed to decode response from " + path);
          } else {
            resolve(buffer.toString());
          }
        });
      });

      req.end();
    });
  }

  dispose() {
    this._client.close();
    this._client = null;
  }
}
