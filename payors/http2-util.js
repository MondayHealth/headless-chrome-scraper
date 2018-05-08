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
    if (this._client) {
      this.dispose();
    }

    this._client = http2.connect(this._url);
    this._client.on("error", error => {
      console.error("!! HTTP2 LIBRARY ERROR !!");
      console.error(error);
    });
    this._goAway = false;

    this._client.on("goaway", () => (this._goAway = true));
  }

  async req(path, headers, acceptUnencodedResponses) {
    const options = {
      ":authority": this._authority,
      ":method": "GET",
      ":scheme": "https",
      ":path": path,
      ...headers
    };

    if (!this._client || this._goAway) {
      l("Reopening connection.");
      this.regenerateClient();
    }

    const self = this;

    return new Promise((resolve, reject) => {
      const retry = () => {
        l("Retrying .");
        return self
          .req(path, headers, acceptUnencodedResponses)
          .then(a => resolve(a))
          .catch(a => reject(a));
      };

      const goAwayHandler = code => {
        w("goaway: " + code);
        self._goAway = true;
        return retry();
      };

      self._client.on("goaway", goAwayHandler);

      const req = self._client.request(options);
      let responseHeaders = null;
      const data = [];
      req.on("data", chunk => data.push(chunk));
      req.on("response", head => (responseHeaders = head));

      req.on("end", () => {
        // Were we interrupted?
        if (self._goAway) {
          return;
        }

        self._client.removeListener("goaway", goAwayHandler);

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
          console.log(responseHeaders);
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
    if (this._client) {
      this._client.close();
      this._client = null;
    }
  }
}
