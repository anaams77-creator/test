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

const BASE = "https://mangapill.com";

function cards(document, base) {
  const out = [];
  for (const box of document.querySelectorAll("div.grid > div")) {
    const a = box.querySelector("a[href^='/manga/']");
    if (!a) continue;
    const id = abs(base, a.attr("href"));
    const titleEl = box.querySelector("div.line-clamp-2") || a;
    const title = cleanText(titleEl.text() || a.attr("title"));
    if (!id || !title) continue;
    out.push({ id, title, cover: imageUrl(base, box.querySelector("img")) });
  }
  return uniq(out, (x) => x.id);
}

async function popular() { return cards(await doc(BASE + "/"), BASE); }
async function search(query, offset) {
  const page = pageFromOffset(offset);
  const url = BASE + "/search?page=" + page + "&q=" + encodeURIComponent(query || "");
  return cards(await doc(url), url);
}

async function detail(id) {
  const document = await doc(id);
  const titleEl = document.querySelector("h1") || document.querySelector("h2");
  const images = document.querySelectorAll("div.container img");
  const paragraphs = document.querySelectorAll("div.container p").map((x) => cleanText(x.text())).filter(Boolean).sort((a,b) => b.length-a.length);
  const allText = cleanText((document.querySelector("div.container") || {}).text ? document.querySelector("div.container").text() : "");
  return { id, title: cleanText(titleEl ? titleEl.text() : id), cover: imageUrl(id, images[0]), description: paragraphs[0], status: parseStatus(allText) };
}

async function chapters(id) {
  const document = await doc(id);
  return document.querySelectorAll("#chapters > div > a").map((a) => {
    const title = cleanText(a.text());
    return { id: abs(id, a.attr("href")), chapter: numericChapter(title), title, volume: null, pages: 0, language: "en" };
  }).filter((x) => x.id);
}

async function pageUrls(chapterId) {
  const document = await doc(chapterId);
  return uniq(document.querySelectorAll("picture img").map((x) => imageUrl(chapterId, x)).filter(Boolean));
}

const plugin = { id: "mangapill-en", name: "MangaPill", popular, search, detail, chapters, pageUrls };
