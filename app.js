const DEFAULT_QUERY = '("Public Investment Fund" OR "Saudi PIF" OR ("PIF" AND Saudi))';
const SETTINGS_KEY = "pif-news-monitor-settings";
const GOOGLE_NEWS_RSS = "https://news.google.com/rss/search";
const CORS_PROXY = "https://api.allorigins.win/raw?url=";

const els = {
  queryInput: document.querySelector("#queryInput"),
  timespanSelect: document.querySelector("#timespanSelect"),
  refreshSelect: document.querySelector("#refreshSelect"),
  refreshButton: document.querySelector("#refreshButton"),
  filterInput: document.querySelector("#filterInput"),
  connectionStatus: document.querySelector("#connectionStatus"),
  articleCount: document.querySelector("#articleCount"),
  articleWindow: document.querySelector("#articleWindow"),
  sourceCount: document.querySelector("#sourceCount"),
  countryCount: document.querySelector("#countryCount"),
  latestAge: document.querySelector("#latestAge"),
  lastUpdated: document.querySelector("#lastUpdated"),
  trendSubtitle: document.querySelector("#trendSubtitle"),
  trendChart: document.querySelector("#trendChart"),
  sourceList: document.querySelector("#sourceList"),
  feedMeta: document.querySelector("#feedMeta"),
  articleList: document.querySelector("#articleList"),
  articleTemplate: document.querySelector("#articleTemplate")
};

let state = {
  articles: [],
  timer: null,
  lastFetch: null,
  source: "",
  currentAbort: null
};

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    query: els.queryInput.value.trim(),
    timespan: els.timespanSelect.value,
    refresh: els.refreshSelect.value
  }));
}

function initControls() {
  const settings = loadSettings();
  els.queryInput.value = settings.query || DEFAULT_QUERY;
  els.timespanSelect.value = settings.timespan || "7d";
  els.refreshSelect.value = settings.refresh || "300";

  els.refreshButton.addEventListener("click", () => fetchNews({ manual: true }));
  els.filterInput.addEventListener("input", render);

  [els.queryInput, els.timespanSelect, els.refreshSelect].forEach((control) => {
    control.addEventListener("change", () => {
      saveSettings();
      fetchNews({ manual: true });
      scheduleRefresh();
    });
  });

  els.queryInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      saveSettings();
      fetchNews({ manual: true });
    }
  });
}

function buildUrl() {
  const params = new URLSearchParams({
    q: `${els.queryInput.value.trim() || DEFAULT_QUERY} when:${els.timespanSelect.value}`,
    hl: "en-US",
    gl: "US",
    ceid: "US:en"
  });

  return `${CORS_PROXY}${encodeURIComponent(`${GOOGLE_NEWS_RSS}?${params.toString()}`)}`;
}

async function fetchNews({ manual = false } = {}) {
  if (state.currentAbort) {
    state.currentAbort.abort();
  }

  const controller = new AbortController();
  state.currentAbort = controller;
  setStatus(manual ? "Refreshing" : "Updating", "online");
  els.refreshButton.disabled = true;

  try {
    const response = await fetch(buildUrl(), {
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`GDELT returned ${response.status}`);
    }

    const xml = await response.text();
    state.articles = normalizeArticles(parseGoogleNewsItems(xml));
    state.source = "Google News RSS";
    state.lastFetch = new Date();
    setStatus("Live RSS", "online");
    render();
  } catch (error) {
    if (error.name !== "AbortError") {
      setStatus("Feed error", "error");
      renderError(error);
    }
  } finally {
    if (state.currentAbort === controller) {
      state.currentAbort = null;
    }
    els.refreshButton.disabled = false;
  }
}

function normalizeArticles(articles) {
  const seen = new Set();
  return articles
    .map((article) => {
      const url = article.url || "";
      const seendate = parseGdeltDate(article.seendate);
      return {
        url,
        title: cleanText(article.title || "Untitled mention"),
        domain: cleanText(article.domain || getDomain(url) || "Unknown source"),
        country: cleanText(article.sourcecountry || "Unknown"),
        language: cleanText(article.language || ""),
        seendate,
        snippet: cleanText(article.snippet || article.sourceCollectionIdentifier || "")
      };
    })
    .filter((article) => {
      if (!article.url || seen.has(article.url)) return false;
      seen.add(article.url);
      return true;
    })
    .sort((a, b) => b.seendate - a.seendate);
}

function parseGoogleNewsItems(xml) {
  const matches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return matches.map((item) => {
    const rawTitle = decodeXml(readTag(item, "title"));
    const source = decodeXml(readTag(item, "source")) || sourceFromGoogleTitle(rawTitle);
    return {
      url: decodeXml(readTag(item, "link")),
      title: stripGoogleSource(rawTitle, source),
      domain: source || "Google News",
      sourcecountry: "Unknown",
      language: "English",
      seendate: toGdeltDate(new Date(decodeXml(readTag(item, "pubDate")))),
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

function parseGdeltDate(value) {
  if (!value) return new Date(0);
  const padded = String(value).padEnd(14, "0");
  const iso = `${padded.slice(0, 4)}-${padded.slice(4, 6)}-${padded.slice(6, 8)}T${padded.slice(8, 10)}:${padded.slice(10, 12)}:${padded.slice(12, 14)}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function cleanText(value) {
  const div = document.createElement("div");
  div.innerHTML = String(value);
  return div.textContent.replace(/\s+/g, " ").trim();
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function render() {
  const filter = els.filterInput.value.trim().toLowerCase();
  const articles = state.articles.filter((article) => {
    if (!filter) return true;
    return [article.title, article.domain, article.country, article.language, article.snippet]
      .join(" ")
      .toLowerCase()
      .includes(filter);
  });

  renderMetrics(articles);
  renderSources(articles);
  renderChart(articles);
  renderArticles(articles);
}

function renderMetrics(articles) {
  const domains = new Set(articles.map((article) => article.domain));
  const countries = new Set(articles.map((article) => article.country).filter(Boolean));
  const latest = articles[0]?.seendate;

  els.articleCount.textContent = numberFormat(articles.length);
  els.articleWindow.textContent = `Last ${formatWindow(els.timespanSelect.value)}`;
  els.sourceCount.textContent = numberFormat(domains.size);
  els.countryCount.textContent = numberFormat(countries.size);
  els.latestAge.textContent = latest ? relativeTime(latest) : "--";
  els.lastUpdated.textContent = state.lastFetch
    ? `Updated ${state.lastFetch.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "Not updated yet";
  els.feedMeta.textContent = articles.length
    ? `${numberFormat(articles.length)} matching articles from ${state.source || "news feed"}, newest first`
    : "No matching articles";
}

function renderSources(articles) {
  const counts = countBy(articles, "domain").slice(0, 8);
  const max = counts[0]?.count || 1;
  els.sourceList.replaceChildren();

  if (!counts.length) {
    els.sourceList.innerHTML = '<div class="empty-state">Sources appear after the first successful update.</div>';
    return;
  }

  counts.forEach(({ name, count }) => {
    const row = document.createElement("div");
    row.className = "source-row";
    row.innerHTML = `
      <strong>${escapeHtml(name)}</strong>
      <span>${numberFormat(count)}</span>
      <div class="bar"><span style="width: ${(count / max) * 100}%"></span></div>
    `;
    els.sourceList.append(row);
  });
}

function renderChart(articles) {
  const ctx = els.trendChart.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = els.trendChart.getBoundingClientRect();
  els.trendChart.width = Math.max(1, Math.floor(rect.width * dpr));
  els.trendChart.height = Math.floor(220 * dpr);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, 220);

  const buckets = dailyBuckets(articles);
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const pad = { top: 18, right: 18, bottom: 32, left: 34 };
  const width = rect.width - pad.left - pad.right;
  const height = 220 - pad.top - pad.bottom;

  ctx.strokeStyle = "#dfe5dd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + height);
  ctx.lineTo(pad.left + width, pad.top + height);
  ctx.stroke();

  if (!buckets.length) {
    ctx.fillStyle = "#66736c";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("No trend data yet", pad.left + 12, pad.top + 34);
    els.trendSubtitle.textContent = "Waiting for data";
    return;
  }

  const step = width / Math.max(buckets.length - 1, 1);
  const points = buckets.map((bucket, index) => ({
    x: pad.left + index * step,
    y: pad.top + height - (bucket.count / max) * height,
    ...bucket
  }));

  ctx.fillStyle = "rgba(23, 107, 83, 0.13)";
  ctx.beginPath();
  ctx.moveTo(points[0].x, pad.top + height);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points[points.length - 1].x, pad.top + height);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#176b53";
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  ctx.fillStyle = "#315b83";
  points.forEach((point) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#66736c";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  points.forEach((point, index) => {
    if (index === 0 || index === points.length - 1 || buckets.length <= 7) {
      ctx.fillText(point.label, point.x, pad.top + height + 22);
    }
  });

  ctx.textAlign = "left";
  ctx.fillText(String(max), 6, pad.top + 4);
  els.trendSubtitle.textContent = `${formatWindow(els.timespanSelect.value)} of mentions by first-seen date`;
}

function dailyBuckets(articles) {
  const days = Number.parseInt(els.timespanSelect.value, 10);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = [];

  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - index);
    buckets.push({
      key: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString([], { month: "short", day: "numeric" }),
      count: 0
    });
  }

  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  articles.forEach((article) => {
    const key = article.seendate.toISOString().slice(0, 10);
    if (bucketMap.has(key)) {
      bucketMap.get(key).count += 1;
    }
  });

  return buckets;
}

function renderArticles(articles) {
  els.articleList.replaceChildren();

  if (!articles.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.articles.length
      ? "No articles match the current filter."
      : "No articles loaded yet. Try refreshing or widening the search window.";
    els.articleList.append(empty);
    return;
  }

  articles.forEach((article) => {
    const card = els.articleTemplate.content.cloneNode(true);
    const meta = card.querySelector(".article-meta");
    const link = card.querySelector("a");
    const snippet = card.querySelector(".article-snippet");
    const country = card.querySelector(".country");
    const age = card.querySelector(".age");

    meta.innerHTML = `
      <span>${escapeHtml(article.domain)}</span>
      ${article.language ? `<span>${escapeHtml(article.language)}</span>` : ""}
    `;
    link.href = article.url;
    link.textContent = article.title;
    snippet.textContent = article.snippet || "No snippet available from the feed.";
    country.textContent = article.country;
    age.textContent = relativeTime(article.seendate);
    els.articleList.append(card);
  });
}

function renderError(error) {
  els.lastUpdated.textContent = state.lastFetch
    ? `Last successful update ${state.lastFetch.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : error.message;

  if (!state.articles.length) {
    els.articleList.innerHTML = `<div class="empty-state">Unable to reach the news feed. ${escapeHtml(error.message)}</div>`;
  }
}

function countBy(items, key) {
  const counts = new Map();
  items.forEach((item) => {
    const name = item[key] || "Unknown";
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function setStatus(text, variant = "") {
  els.connectionStatus.textContent = text;
  els.connectionStatus.className = `status-pill ${variant}`.trim();
}

function scheduleRefresh() {
  if (state.timer) {
    window.clearInterval(state.timer);
  }
  const seconds = Number.parseInt(els.refreshSelect.value, 10);
  state.timer = window.setInterval(() => fetchNews(), seconds * 1000);
}

function relativeTime(date) {
  const seconds = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1]
  ];
  const [unit, value] = units.find(([, value]) => seconds >= value) || units.at(-1);
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-Math.floor(seconds / value), unit);
}

function formatWindow(value) {
  if (value === "1d") return "24 hours";
  return `${Number.parseInt(value, 10)} days`;
}

function numberFormat(value) {
  return new Intl.NumberFormat().format(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.addEventListener("resize", () => renderChart(state.articles));

initControls();
render();
fetchNews();
scheduleRefresh();
