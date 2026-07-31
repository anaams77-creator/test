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

const BASES = ["https://www.natomanga.com", "https://www.nelomanga.com", "https://www.nelomanga.net", "https://www.manganato.gg"];

async function first(path) {
  let last;
  for (const b of BASES) {
    const url = new URL(path, b).toString();
    try { return { document: await doc(url), url }; } catch (e) { last = e; }
  }
  throw last || new Error("All mirrors failed");
}

function normalize(q) {
  return cleanText(q).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function cards(document, base) {
  const roots = document.querySelectorAll("div.list-truyen-item-wrap, div.list-comic-item-wrap, div.story_item");
  const out = [];
  for (const el of roots) {
    const a = el.querySelector("h3 a") || el.querySelector("a[data-id]") || el.querySelector("a");
    if (!a) continue;
    const id = abs(base, a.attr("href"));
    const title = cleanText(a.text() || a.attr("title"));
    if (!id || !title) continue;
    out.push({ id, title, cover: imageUrl(base, el.querySelector("img")) });
  }
  return uniq(out, (x) => x.id);
}

async function popular(offset) {
  const got = await first("/manga-list/hot-manga?page=" + pageFromOffset(offset));
  return cards(got.document, got.url);
}

async function search(query, offset) {
  const got = await first("/search/story/" + normalize(query || "") + "?page=" + pageFromOffset(offset));
  return cards(got.document, got.url);
}

async function detail(id) {
  const document = await doc(id);
  const info = document.querySelector("div.manga-info-top") || document.querySelector("div.panel-story-info");
  const titleEl = info && (info.querySelector("h1") || info.querySelector("h2"));
  const coverEl = document.querySelector("div.manga-info-pic img") || document.querySelector("span.info-image img");
  const descEl = document.querySelector("div#noidungm") || document.querySelector("div#panel-story-info-description") || document.querySelector("div#contentBox");
  const textInfo = cleanText(info ? info.text() : "");
  let author;
  for (const a of info ? info.querySelectorAll("a") : []) {
    const href = a.attr("href") || "";
    if (/author/i.test(href)) { author = cleanText(a.text()); break; }
  }
  return { id, title: cleanText(titleEl ? titleEl.text() : id), cover: imageUrl(id, coverEl), description: cleanText(descEl ? descEl.text() : ""), status: parseStatus(textInfo), author };
}

function slugFromId(id) { return new URL(id).pathname.split("/").filter(Boolean).pop(); }

async function chapters(id) {
  const slug = slugFromId(id);
  const origin = new URL(id).origin;
  const data = await jsonGet(origin + "/api/manga/" + encodeURIComponent(slug) + "/chapters?limit=-1");
  const list = data && data.data && data.data.chapters ? data.data.chapters : [];
  return list.map((ch) => ({
    id: origin + "/manga/" + slug + "/" + ch.chapter_slug,
    chapter: ch.chapter_num == null ? numericChapter(ch.chapter_name) : String(ch.chapter_num),
    title: cleanText(ch.chapter_name) || undefined,
    volume: null,
    pages: 0,
    language: "en",
    publishAt: ch.updated_at || undefined,
  })).filter((x) => x.id && chSafe(x));
}
function chSafe(x) { return !!x.id; }

function parseJsArray(html, name) {
  const re = new RegExp(name + "\\s*=\\s*\\[([^\\]]*)\\]", "i");
  const m = re.exec(html);
  if (!m) return [];
  return m[1].split(",").map((x) => x.trim().replace(/^['\"]|['\"]$/g, "").replace(/\\\//g, "/").replace(/\/$/, "")).filter(Boolean);
}

async function pageUrls(chapterId) {
  const html = await text(chapterId);
  const chapterImages = parseJsArray(html, "chapterImages");
  const cdns = parseJsArray(html, "cdns").concat(parseJsArray(html, "backupImage"));
  if (chapterImages.length && cdns.length) {
    const root = cdns[0] + "/";
    return chapterImages.map((p) => abs(root, p)).filter(Boolean);
  }
  const document = await harbor.parseHtml(html);
  return uniq(document.querySelectorAll("div.container-chapter-reader img").map((x) => imageUrl(chapterId, x)).filter(Boolean));
}

const plugin = { id: "manganato-en", name: "Manganato", popular, search, detail, chapters, pageUrls };
