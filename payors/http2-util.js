import { gunzip } from "zlib";
// Apparently this isn't added yet because it's stage 1 experimental
// noinspection NpmUsedModulesInstalled
import http2 from "http2";
import { l, w } from "./log";

export default class Http2Client {
  /**
   *
   * @param url {string}
   * @param authority {string}
   */
  constructor(url, authority) {
    this._url = url;
    this._authority = authority;
    this._goAway = false;
    this.regenerateClient();
  }

  regenerateClient() {
    this._client = http2.connect(this._url);
    this._client.on("error", error => {
      console.error("!! HTTP2 LIBRARY ERROR !!");
      console.error(error);
    });
    this._goAway = false;
    this._client.on("goaway", (code, lastStream) => {
      w(["goaway", code, lastStream].join(" "));
      this._client = null;
      this._goAway = true;
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

    if (!this._client) {
      this.regenerateClient();
    }

    let responseHeaders = null;
    const data = [];

    const req = this._client.request(options);

    req.on("response", head => (responseHeaders = head));
    req.on("data", chunk => data.push(chunk));

    const self = this;

    return new Promise((resolve, reject) => {
      const retry = () => {
        l("Retrying ...");
        return self.req(path, headers, acceptUnencodedResponses)
          .then(a => resolve(a))
          .catch(a => reject(a));
      };

      req.on("close", e => {
        if (e) {
          console.log(e);
        }
      });

      req.on("error", e => {
        console.error(e);
        retry();
      });

      req.on("end", () => {
        // Were we interrupted?
        if (self._goAway) {
          retry();
          return;
        }

        const encoding = responseHeaders["content-encoding"];

        if (
          (!encoding && !acceptUnencodedResponses) ||
          (encoding && encoding !== "gzip")
        ) {
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

      if (self._goAway) {
        retry();
        return;
      }

      req.end();
    });
  }

  dispose() {
    this._client.close();
    this._client = null;
  }
}
