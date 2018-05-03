import request from "request";
import { e } from "../log";

function generateCookieString(cookies) {
  const map = {};
  const ret = [];
  cookies.forEach(({ name, value }) => {
    if (name.indexOf("PD_STATEFUL") === 0) {
      ret.unshift(name + "=" + value);
    } else {
      map[name] = value;
    }
  });

  const ltm = "cigna-ltm-cookie=" + map["cigna-ltm-cookie"];
  const jsid = "JSESSIONID=" + map["JSESSIONID"];

  ret.unshift(ltm);
  ret.push(jsid);
  ret.push(ltm);

  return ret.join("; ");
}

function getHeaders(cookies, ua) {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Length": 0,
    Cookie: generateCookieString(cookies),
    DNT: 1,
    Host: "apps.cignabehavioral.com",
    Origin: "https://apps.cignabehavioral.com",
    Pragma: "no-cache",
    Referer: "https://apps.cignabehavioral.com/web/consumer.do",
    "User-Agent": ua
  };
}

export async function getDetail(cookies, ua, providerId) {
  const headers = getHeaders(cookies, ua);
  const json = true;
  const gzip = true;

  const url =
    "https://apps.cignabehavioral.com/web/retrieveProviderDetails.do" +
    "?providerId=" +
    providerId;

  return new Promise((resolve, reject) => {
    request.post({ url, headers, json, gzip }, (error, response, result) => {
      if (error) {
        e(`Detail request for ${providerId} failed.`);
        console.log(error);
        reject(error);
        return;
      }

      if (response.statusCode !== 200) {
        e(`Non-200 response for ${providerId}: ${response.statusCode}`);
        reject(response.statusCode);
        return;
      }

      resolve(result);
    });
  });
}
