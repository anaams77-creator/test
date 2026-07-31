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

const BASE = "https://azorafly.com";
const API = "https://api.azorafly.com";

function mangaId(post) { return String(post.slug) + "#" + String(post.id); }
function splitMangaId(id) { const s = String(id).split("#"); return { slug: s[0], id: s[1] }; }
function mangaSummary(post) {
  return {
    id: mangaId(post),
    title: cleanText(post.postTitle),
    altTitle: cleanText(post.alternativeTitles) || undefined,
    cover: abs(BASE, post.featuredImage),
    description: stripHtml(post.postContent),
    status: parseStatus(post.seriesStatus),
    author: cleanText(post.author) || undefined,
  };
}

async function browse(query, offset, popularMode) {
  const page = pageFromOffset(offset);
  const url = API + "/api/query?page=" + page + "&perPage=48&searchTerm=" + encodeURIComponent(query || "") +
    "&orderBy=" + (popularMode ? "totalViews" : "lastChapterAddedAt") + "&orderDirection=desc";
  const data = await jsonGet(url);
  return (data.posts || []).filter((p) => !p.isNovel && String(p.seriesType || "").toLowerCase() !== "novel").map(mangaSummary);
}

async function popular(offset) { return browse("", offset, true); }
async function search(query, offset) { return browse(query, offset, false); }

async function detail(id) {
  const parts = splitMangaId(id);
  const data = await jsonGet(API + "/api/post?postSlug=" + encodeURIComponent(parts.slug));
  return mangaSummary(data.post || {});
}

function chapterItem(ch, seriesSlug) {
  const locked = ch.isLocked === true || ch.isTimeLocked === true || (ch.chapterPurchased === false && Number(ch.price || 0) !== 0);
  if (locked) return null;
  const number = String(ch.number == null ? "" : ch.number);
  return {
    id: String(ch.id) + "#" + String(ch.slug || "") + "#" + seriesSlug,
    chapter: number || null,
    title: cleanText(ch.title) || (number ? "Chapter " + number : undefined),
    volume: null,
    pages: 0,
    language: "ar",
    group: ch.createdBy && ch.createdBy.name ? cleanText(ch.createdBy.name) : undefined,
    publishAt: ch.createdAt || undefined,
  };
}

async function chapters(id) {
  const parts = splitMangaId(id);
  const data = await jsonGet(API + "/api/post?postSlug=" + encodeURIComponent(parts.slug));
  let list = (data.post && data.post.chapters) || [];
  if (data.totalChapterCount && list.length < data.totalChapterCount) {
    const more = await jsonGet(API + "/api/chapters?postId=" + encodeURIComponent(parts.id || data.post.id));
    list = (more.post && more.post.chapters) || list;
  }
  return list.map((x) => chapterItem(x, parts.slug)).filter(Boolean);
}

async function pageUrls(chapterId) {
  const chapterNumericId = String(chapterId).split("#")[0];
  const data = await jsonGet(API + "/api/chapter?chapterId=" + encodeURIComponent(chapterNumericId));
  const ch = data.chapter || {};
  if (ch.isPermanentlyLocked || ch.isLockedByCoins || ch.isShortLinkLocked) throw new Error("Locked chapter");
  return (ch.images || []).slice().sort((a, b) => Number(a.order || 999999) - Number(b.order || 999999)).map((x) => abs(BASE, String(x.url || "").replace(/ /g, "%20"))).filter(Boolean);
}

async function tags() {
  const data = await jsonGet(API + "/api/genres");
  return (Array.isArray(data) ? data : []).map((g) => ({ id: String(g.id), name: cleanText(g.name), group: "Genre" })).filter((x) => x.id && x.name);
}

const plugin = { id: "azora-ar", name: "Azora (Arabic)", popular, search, detail, chapters, pageUrls, tags };
