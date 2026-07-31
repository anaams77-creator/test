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

const BASE = "https://onma.me";

function rows(document, base) {
  const out = [];
  for (const el of document.querySelectorAll("div.chapter-container, div.media")) {
    const a = el.querySelector(".media-heading a") || el.querySelector(".manga-heading a") || el.querySelector("a");
    if (!a) continue;
    const id = abs(base, a.attr("href"));
    const title = cleanText(a.text());
    if (!id || !title) continue;
    out.push({ id, title, cover: imageUrl(base, el.querySelector("img")) });
  }
  return uniq(out, (x) => x.id);
}

async function popular(offset) {
  const page = pageFromOffset(offset);
  const url = BASE + "/filterList?page=" + page + "&sortBy=views&asc=false";
  return rows(await doc(url), url);
}

async function search(query, offset) {
  const page = pageFromOffset(offset);
  if (!query) return popular(offset);
  const data = await jsonGet(BASE + "/search?query=" + encodeURIComponent(query));
  const suggestions = (data && data.suggestions) || [];
  return suggestions.slice((page - 1) * 48, page * 48).map((x) => ({ id: BASE + "/manga/" + x.data, title: cleanText(x.value) })).filter((x) => x.title);
}

async function detail(id) {
  const document = await doc(id);
  const titleEl = document.querySelector(".panel-heading") || document.querySelector("h1");
  const coverEl = document.querySelector(".row img.img-responsive") || document.querySelector("img.img-responsive");
  const wells = document.querySelectorAll(".row .well").map((x) => cleanText(x.text())).filter(Boolean).sort((a,b) => b.length-a.length);
  let author, status;
  for (const h3 of document.querySelectorAll(".panel-body h3")) {
    const all = cleanText(h3.text());
    const valueEl = h3.querySelector("div.text");
    const value = cleanText(valueEl ? valueEl.text() : all.replace(/^[^:]+:/, ""));
    if (/المؤلف|author/i.test(all)) author = value;
    if (/الحالة|status/i.test(all)) status = parseStatus(value);
  }
  return { id, title: cleanText(titleEl ? titleEl.text() : id), cover: imageUrl(id, coverEl), description: wells[0], author, status };
}

async function chapters(id) {
  const document = await doc(id);
  const title = cleanText((document.querySelector(".panel-heading") || {}).text ? document.querySelector(".panel-heading").text() : "");
  const out = [];
  for (const li of document.querySelectorAll("ul.chapters > li")) {
    const klass = li.attr("class") || "";
    if (/\bbtn\b/.test(klass)) continue;
    const wrap = li.querySelector(".chapter-title-rtl") || li;
    const a = wrap.querySelector("a");
    if (!a) continue;
    const cid = abs(id, a.attr("href"));
    const raw = cleanText(wrap.text());
    const chTitle = title && raw.startsWith(title) ? cleanText(raw.slice(title.length)) : raw;
    const date = li.querySelector(".date-chapter-title-rtl");
    out.push({ id: cid, chapter: numericChapter(chTitle), title: chTitle, volume: null, pages: 0, language: "ar", publishAt: date ? cleanText(date.text()) : undefined });
  }
  return uniq(out, (x) => x.id);
}

async function pageUrls(chapterId) {
  const document = await doc(chapterId);
  return uniq(document.querySelectorAll("#all > img.img-responsive, #all img").map((x) => imageUrl(chapterId, x)).filter(Boolean));
}

const plugin = { id: "manga-online-ar", name: "مانجا اون لاين", popular, search, detail, chapters, pageUrls };
