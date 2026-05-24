const DEFAULT_QUERY = '"Public Investment Fund" OR "Saudi PIF" OR ("PIF" AND Saudi)';

export default {
  async fetch(request) {
    try {
      const requestUrl = new URL(request.url);
      const searchParams = requestUrl.searchParams;
      const gdeltUrl = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
      searchParams.forEach((value, key) => gdeltUrl.searchParams.set(key, value));

      try {
        const upstream = await fetch(gdeltUrl, {
          headers: {
            accept: "application/json",
            "user-agent": "PIF News Monitor"
          }
        });
        const body = await upstream.text();

        if (upstream.ok) {
          return json({ ...JSON.parse(body), source: "GDELT" });
        }
      } catch {
        // Google News RSS below is the reliability fallback.
      }

      return json(await fetchGoogleNews(searchParams));
    } catch (error) {
      return json({ error: error.message || "News feed failed" }, 502);
    }
  }
};

async function fetchGoogleNews(searchParams) {
  const timespan = searchParams.get("timespan") || "7d";
  const query = searchParams.get("query") || DEFAULT_QUERY;
  const rssUrl = new URL("https://news.google.com/rss/search");
  rssUrl.searchParams.set("q", `${query} when:${timespan}`);
  rssUrl.searchParams.set("hl", "en-US");
  rssUrl.searchParams.set("gl", "US");
  rssUrl.searchParams.set("ceid", "US:en");

  const upstream = await fetch(rssUrl, {
    headers: { "user-agent": "PIF News Monitor" }
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

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });
}
