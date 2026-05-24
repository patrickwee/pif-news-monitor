const https = require("node:https");

const DEFAULT_QUERY = '"Public Investment Fund" OR "Saudi PIF" OR ("PIF" AND Saudi)';

module.exports = async function handler(request, response) {
  try {
    const query = getQueryValue(request, "query") || DEFAULT_QUERY;
    const timespan = getQueryValue(request, "timespan") || "7d";
    const maxrecords = Number(getQueryValue(request, "maxrecords") || 250);
    const rssUrl = new URL("https://news.google.com/rss/search");
    rssUrl.searchParams.set("q", query + " when:" + timespan);
    rssUrl.searchParams.set("hl", "en-US");
    rssUrl.searchParams.set("gl", "US");
    rssUrl.searchParams.set("ceid", "US:en");

    const xml = await getText(rssUrl);
    sendJson(response, 200, {
      source: "Google News RSS",
      articles: parseGoogleNewsItems(xml).slice(0, maxrecords)
    });
  } catch (error) {
    sendJson(response, 200, {
      source: "Fallback",
      articles: [],
      error: error && error.message ? error.message : "News feed failed"
    });
  }
};

function getQueryValue(request, key) {
  if (request.query && request.query[key]) {
    return Array.isArray(request.query[key]) ? request.query[key][0] : request.query[key];
  }

  const requestUrl = new URL(request.url || "/api/news", "https://local.vercel.app");
  return requestUrl.searchParams.get(key);
}

function getText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "accept": "application/rss+xml, application/xml, text/xml",
        "user-agent": "PIF News Monitor"
      },
      timeout: 12000
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error("Google News RSS returned " + res.statusCode));
        }
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("Google News RSS timed out"));
    });
    req.on("error", reject);
  });
}

function parseGoogleNewsItems(xml) {
  const matches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return matches.map((item) => {
    const rawTitle = decodeXml(readTag(item, "title"));
    const source = decodeXml(readTag(item, "source")) || sourceFromGoogleTitle(rawTitle);
    const title = stripGoogleSource(rawTitle, source);
    const pubDate = new Date(decodeXml(readTag(item, "pubDate")));

    return {
      url: decodeXml(readTag(item, "link")),
      title: title || "Untitled mention",
      domain: source || "Google News",
      sourcecountry: "Unknown",
      language: "English",
      seendate: toGdeltDate(pubDate),
      snippet: stripTags(decodeXml(readTag(item, "description")))
    };
  });
}

function readTag(xml, tag) {
  const match = xml.match(new RegExp("<" + tag + "(?: [^>]*)?>([\\s\\S]*?)<\\/" + tag + ">"));
  return match ? match[1] : "";
}

function decodeXml(value) {
  return String(value)
    .split("<![CDATA[").join("")
    .split("]]>").join("")
    .split("&amp;").join("&")
    .split("&lt;").join("<")
    .split("&gt;").join(">")
    .split("&quot;").join('"')
    .split("&#39;").join("'")
    .split("&apos;").join("'");
}

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function sourceFromGoogleTitle(title) {
  const parts = String(title).split(" - ");
  return parts.length > 1 ? parts[parts.length - 1].trim() : "";
}

function stripGoogleSource(title, source) {
  const suffix = " - " + source;
  return source && title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

function toGdeltDate(date) {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toISOString().replace(/\D/g, "").slice(0, 14);
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(payload));
}
