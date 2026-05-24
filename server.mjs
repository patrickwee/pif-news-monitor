import { createReadStream, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createServer } from "node:http";

const root = resolve(".");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (url.pathname === "/api/news") {
    proxyNews(url.searchParams, response);
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = resolve(join(root, pathname));

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": types[extname(filePath)] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  console.log(`PIF News Monitor running at http://${host}:${port}`);
});

async function proxyNews(searchParams, response) {
  const gdeltUrl = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  searchParams.forEach((value, key) => gdeltUrl.searchParams.set(key, value));

  try {
    const upstream = await fetch(gdeltUrl, {
      headers: {
        "accept": "application/json",
        "user-agent": "PIF News Monitor local dashboard"
      }
    });
    const body = await upstream.text();

    if (upstream.ok) {
      const data = JSON.parse(body);
      sendJson(response, 200, { ...data, source: "GDELT" });
      return;
    }

    const fallback = await fetchGoogleNews(searchParams);
    sendJson(response, 200, fallback);
  } catch (error) {
    try {
      const fallback = await fetchGoogleNews(searchParams);
      sendJson(response, 200, fallback);
    } catch (fallbackError) {
      sendJson(response, 502, { error: fallbackError.message || error.message });
    }
  }
}

async function fetchGoogleNews(searchParams) {
  const timespan = searchParams.get("timespan") || "7d";
  const query = searchParams.get("query") || '"Public Investment Fund" OR "Saudi PIF"';
  const rssUrl = new URL("https://news.google.com/rss/search");
  rssUrl.searchParams.set("q", `${query} when:${timespan}`);
  rssUrl.searchParams.set("hl", "en-US");
  rssUrl.searchParams.set("gl", "US");
  rssUrl.searchParams.set("ceid", "US:en");

  const upstream = await fetch(rssUrl, {
    headers: { "user-agent": "PIF News Monitor local dashboard" }
  });

  if (!upstream.ok) {
    throw new Error(`Google News RSS returned ${upstream.status}`);
  }

  const xml = await upstream.text();
  return {
    source: "Google News RSS",
    articles: parseGoogleNewsItems(xml).slice(0, Number(searchParams.get("maxrecords") || 250))
  };
}

function parseGoogleNewsItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
    const item = match[1];
    const rawTitle = decodeXml(readTag(item, "title"));
    const source = decodeXml(readTag(item, "source")) || sourceFromGoogleTitle(rawTitle);
    const title = stripGoogleSource(rawTitle, source);
    const pubDate = new Date(decodeXml(readTag(item, "pubDate")));

    return {
      url: decodeXml(readTag(item, "link")),
      title,
      domain: source || "Google News",
      sourcecountry: "Unknown",
      language: "English",
      seendate: toGdeltDate(pubDate),
      snippet: stripTags(decodeXml(readTag(item, "description")))
    };
  });
}

function readTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?: [^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1] : "";
}

function decodeXml(value) {
  return String(value)
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function stripTags(value) {
  return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function sourceFromGoogleTitle(title) {
  const parts = String(title).split(" - ");
  return parts.length > 1 ? parts.at(-1).trim() : "";
}

function stripGoogleSource(title, source) {
  const suffix = ` - ${source}`;
  return source && title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

function toGdeltDate(date) {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toISOString().replace(/\D/g, "").slice(0, 14);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}
