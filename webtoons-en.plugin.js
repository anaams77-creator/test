const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

function pageFromOffset(offset) {
  return Math.floor((Number(offset) || 0) / 48) + 1;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return cleanText(String(value || "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'"));
}

function abs(base, value) {
  if (!value) return undefined;
  let url = cleanText(value).split(/\s+/)[0];
  if (!url || url.startsWith("data:")) return undefined;
  try { return new URL(url, base).toString(); } catch (_) { return undefined; }
}

function imageUrl(base, el) {
  if (!el) return undefined;
  const srcset = el.attr("srcset");
  return abs(base,
    el.attr("data-cfsrc") ||
    el.attr("data-src") ||
    el.attr("data-lazy-src") ||
    (srcset ? srcset.split(",").pop().trim().split(/\s+/)[0] : "") ||
    el.attr("src")
  );
}

function uniq(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    if (!item) continue;
    const key = keyFn ? keyFn(item) : item;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function text(url, opts) {
  const res = await harbor.http(url, Object.assign({
    responseType: "text",
    headers: { "user-agent": UA, "accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" },
    timeoutMs: 20000,
  }, opts || {}));
  if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?") + " for " + url);
  return res.body || "";
}

async function jsonGet(url, opts) {
  const value = await harbor.http(url, Object.assign({
    responseType: "json",
    headers: { "user-agent": UA, "accept": "application/json,text/plain,*/*" },
    timeoutMs: 20000,
  }, opts || {}));
  if (value === null || value === undefined) throw new Error("Invalid JSON from " + url);
  return value;
}

async function doc(url, opts) {
  return harbor.parseHtml(await text(url, opts));
}

function formBody(obj) {
  return Object.keys(obj).map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(obj[k] == null ? "" : obj[k])).join("&");
}

function parseStatus(value) {
  const s = cleanText(value).toLowerCase();
  if (!s) return undefined;
  if (/complete|completed|finished|مكتمل|مكتملة|منتهي/.test(s)) return "completed";
  if (/hiatus|pause|متوقف|معلق/.test(s)) return "hiatus";
  if (/cancel|dropped|متروك|ملغي/.test(s)) return "cancelled";
  if (/ongoing|publishing|مستمرة|مستمر|قادم/.test(s)) return "ongoing";
  return s;
}

function numericChapter(value) {
  const m = cleanText(value).match(/(?:chapter|chap|ch\.?|الفصل|حلقة|episode|ep\.?)\s*([0-9]+(?:\.[0-9]+)?)/i)
    || cleanText(value).match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? m[1] : null;
}

const BASE = "https://www.webtoons.com";
const MOBILE = "https://m.webtoons.com";

function cards(document, base) {
  const out = [];
  for (const a of document.querySelectorAll(".webtoon_list li a")) {
    const titleEl = a.querySelector(".title");
    const id = abs(base, a.attr("href"));
    const title = cleanText(titleEl ? titleEl.text() : a.text());
    if (!id || !title) continue;
    out.push({ id, title, cover: imageUrl(base, a.querySelector("img")) });
  }
  return uniq(out, (x) => x.id);
}

async function popular(offset) {
  const page = pageFromOffset(offset);
  const modes = ["trending", "popular", "originals", "canvas"];
  const mode = modes[Math.min(page - 1, modes.length - 1)];
  const url = BASE + "/en/ranking/" + mode;
  return cards(await doc(url), url);
}
async function search(query, offset) {
  const page = pageFromOffset(offset);
  const url = BASE + "/en/search?keyword=" + encodeURIComponent(query || "") + (page > 1 ? "&page=" + page : "");
  return cards(await doc(url), url);
}

async function detail(id) {
  const document = await doc(id);
  const titleEl = document.querySelector("h1.subj") || document.querySelector("h3.subj") || document.querySelector("h1");
  const detailHeader = document.querySelector(".detail_header .info");
  const aside = document.querySelector("#_asideDetail");
  const authorEl = detailHeader && (detailHeader.querySelector(".author") || detailHeader.querySelector(".author_area"));
  const desc = aside && aside.querySelector("p.summary");
  const meta = document.querySelector("meta[property='og:image']");
  const dayInfo = aside && aside.querySelector("p.day_info");
  return { id, title: cleanText(titleEl ? titleEl.text() : id), cover: abs(id, meta && meta.attr("content")), description: cleanText(desc ? desc.text() : ""), status: parseStatus(dayInfo ? dayInfo.text() : ""), author: cleanText(authorEl ? authorEl.text() : "") || undefined };
}

function titleNo(id) {
  const u = new URL(id);
  return u.searchParams.get("title_no") || u.searchParams.get("titleNo");
}
async function chapters(id) {
  const n = titleNo(id);
  if (!n) throw new Error("Missing title_no");
  const isCanvas = /\/canvas\//.test(new URL(id).pathname) || /\/challenge\//.test(new URL(id).pathname);
  let url = MOBILE + "/api/v1/" + (isCanvas ? "canvas" : "webtoon") + "/" + encodeURIComponent(n) + "/episodes?pageSize=99999";
  if (isCanvas) url += "&readingLanguageCode=en";
  const data = await jsonGet(url);
  const list = data && data.result && data.result.episodeList ? data.result.episodeList : [];
  return list.map((ep, i) => ({ id: abs(BASE, ep.viewerLink), chapter: numericChapter(ep.episodeTitle) || String(i + 1), title: cleanText(ep.episodeTitle), volume: null, pages: 0, language: "en", publishAt: ep.exposureDateMillis ? new Date(ep.exposureDateMillis).toISOString() : undefined })).reverse();
}

async function pageUrls(chapterId) {
  const document = await doc(chapterId);
  return uniq(document.querySelectorAll("div#_imageList > img").map((x) => abs(chapterId, x.attr("data-url") || x.attr("src"))).filter(Boolean));
}

const plugin = { id: "webtoons-en", name: "Webtoons.com", popular, search, detail, chapters, pageUrls };
