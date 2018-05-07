import { gunzip } from "zlib";
// Apparently this isn't added yet because it's stage 1 experimental
// noinspection NpmUsedModulesInstalled
import http2 from "http2";

export default class Http2Client {
  /**
   *
   * @param url {string}
   * @param authority {string}
   */
  constructor(url, authority) {
    this._url = url;
    this._authority = authority;
    this.regenerateClient();
  }

  regenerateClient() {
    this._client = http2.connect(this._url);
    this._client.on("error", error => {
      console.error("!! HTTP2 LIBRARY ERROR !!");
      console.error(error);
    });
    this._client.on("goaway", () => {
      console.log("!! goaway");
    });
  }

  async req(path, headers, acceptUnencodedResponses) {
    const options = {
      ":authority": this._authority,
      ":method": "GET",
      ":scheme": "https",
      ":path": path,
      ...headers
    };

    const req = this._client.request(options);

    let encoding = null;

    req.on("response", headers => {
      encoding = headers["content-encoding"];
    });

    const data = [];
    req.on("data", chunk => data.push(chunk));

    return new Promise((resolve, reject) => {
      req.on("end", () => {
        if (!encoding && !acceptUnencodedResponses && encoding !== "gzip") {
          console.error(
            "Server did not send a gzip encoded response!",
            encoding
          );
          console.log(data);
          reject("bad encoding");
          return;
        }

        if (!encoding) {
          resolve(data.join(""));
          return;
        }

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
