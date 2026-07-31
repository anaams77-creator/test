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

const BASE = "https://olympustaff.com";

function cards(document, base) {
  const roots = document.querySelectorAll("div.listupd div.bsx, div.tx-grid a.tx-card");
  const out = [];
  for (const root of roots) {
    const link = root.querySelector("a") || root;
    const id = abs(base, link.attr("href"));
    const title = cleanText(link.attr("title") || (root.querySelector("h3") && root.querySelector("h3").text()) || link.text());
    if (!id || !title) continue;
    let cover = imageUrl(base, root.querySelector("img"));
    if (cover) cover = cover.replace("thumbnail_", "");
    out.push({ id, title, cover });
  }
  return uniq(out, (x) => x.id);
}

async function popular(offset) {
  const page = pageFromOffset(offset);
  const url = BASE + "/series/" + (page > 1 ? "?page=" + page : "");
  return cards(await doc(url), url);
}

async function search(query) {
  const url = BASE + "/search?keyword=" + encodeURIComponent(query || "");
  return cards(await doc(url), url);
}

async function detail(id) {
  const document = await doc(id);
  const titleEl = document.querySelector("div.author-info-title h1") || document.querySelector("h1");
  const descEl = document.querySelector("div.review-content") || document.querySelector("div.review-content p");
  const coverEl = document.querySelector("div.text-right img");
  let status;
  let author;
  const smalls = document.querySelectorAll("div.full-list-info small");
  for (let i = 0; i < smalls.length; i++) {
    const label = cleanText(smalls[i].text());
    const value = smalls[i + 1] ? cleanText(smalls[i + 1].text()) : "";
    if (/الحالة/.test(label)) status = parseStatus(value);
    if (/الرسام|المؤلف/.test(label) && value && value !== "غير معروف") author = value;
  }
  return { id, title: cleanText(titleEl ? titleEl.text() : id), cover: imageUrl(id, coverEl), description: cleanText(descEl ? descEl.text() : ""), status, author };
}

function chapterRows(document, base) {
  const out = [];
  for (const el of document.querySelectorAll("div.chapter-card")) {
    if (el.querySelector("span.locked")) continue;
    const a = el.querySelector("a");
    const id = a && abs(base, a.attr("href"));
    if (!id) continue;
    const n = cleanText(el.attr("data-number"));
    const t = cleanText((el.querySelector("div.chapter-info div.chapter-title") || {}).text ? el.querySelector("div.chapter-info div.chapter-title").text() : "");
    const timestamp = Number(el.attr("data-date"));
    out.push({ id, chapter: n || numericChapter(t), title: t || (n ? "الفصل " + n : cleanText(a.text())), volume: null, pages: 0, language: "ar", publishAt: timestamp ? new Date(timestamp * 1000).toISOString() : undefined });
  }
  return out;
}

async function chapters(id) {
  const first = await doc(id);
  let out = chapterRows(first, id);
  const nums = first.querySelectorAll("ul.pagination a.page-link").map((a) => Number(cleanText(a.text()))).filter((x) => Number.isFinite(x));
  const last = Math.min(Math.max.apply(null, [1].concat(nums)), 8);
  for (let p = 2; p <= last; p++) {
    try { out = out.concat(chapterRows(await doc(id + (id.includes("?") ? "&" : "?") + "page=" + p), id)); } catch (_) { break; }
  }
  return uniq(out, (x) => x.id);
}

async function pageUrls(chapterId) {
  const document = await doc(chapterId);
  return uniq(document.querySelectorAll("div.image_list canvas[data-src], div.image_list img[src]").map((el) => imageUrl(chapterId, el)).filter(Boolean));
}

const plugin = { id: "teamx-ar", name: "Team X (Arabic)", popular, search, detail, chapters, pageUrls };
