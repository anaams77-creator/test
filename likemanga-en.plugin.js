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

const BASE = "https://likemanga.ink";

function cards(document, base) {
  const out = [];
  for (const el of document.querySelectorAll("div.card-body div.card")) {
    const a = el.querySelector("a");
    const titleEl = el.querySelector(".title-manga");
    const id = a && abs(base, a.attr("href"));
    const title = cleanText(titleEl ? titleEl.text() : a ? a.text() : "");
    if (!id || !title) continue;
    out.push({ id, title, cover: imageUrl(base, el.querySelector("img")) });
  }
  return uniq(out, (x) => x.id);
}

async function browse(query, offset, popularMode) {
  const page = pageFromOffset(offset);
  let url = BASE + "/?act=searchadvance&f[sortby]=" + (popularMode ? "top-manga" : "lastest-chap");
  if (query) url += "&f[keyword]=" + encodeURIComponent(query);
  if (page > 1) url += "&pageNum=" + page;
  return cards(await doc(url), url);
}
async function popular(offset) { return browse("", offset, true); }
async function search(query, offset) { return browse(query, offset, false); }

async function detail(id) {
  const document = await doc(id);
  const titleEl = document.querySelector("#title-detail-manga") || document.querySelector("h1");
  const coverEl = document.querySelector(".detail-info img");
  const descEl = document.querySelector("#summary_shortened");
  let status, author;
  const statusRoot = document.querySelector(".list-info .status");
  const authorRoot = document.querySelector(".list-info .author");
  if (statusRoot) status = parseStatus(statusRoot.text());
  if (authorRoot) author = cleanText(authorRoot.text().replace(/^author\s*:?/i, ""));
  return { id, title: cleanText(titleEl ? titleEl.text() : id), cover: imageUrl(id, coverEl), description: cleanText(descEl ? descEl.text() : ""), status, author };
}

function parseChapterDoc(document, base) {
  const out = [];
  for (const el of document.querySelectorAll(".wp-manga-chapter")) {
    const a = el.querySelector("a");
    if (!a) continue;
    const title = cleanText(a.text());
    out.push({ id: abs(base, a.attr("href")), chapter: numericChapter(title), title, volume: null, pages: 0, language: "en", publishAt: cleanText((el.querySelector(".chapter-release-date") || {}).text ? el.querySelector(".chapter-release-date").text() : "") || undefined });
  }
  return out.filter((x) => x.id);
}

async function chapters(id) {
  const firstHtml = await text(id);
  const first = await harbor.parseHtml(firstHtml);
  let out = parseChapterDoc(first, id);
  const titleEl = first.querySelector("#title-detail-manga");
  const mangaId = titleEl && titleEl.attr("data-manga");
  let last = 1;
  for (const a of first.querySelectorAll("div.chapters_pagination a")) {
    const m = String(a.attr("onclick") || "").match(/load_list_chapter\((\d+)\)/);
    if (m) last = Math.max(last, Number(m[1]));
  }
  last = Math.min(last, 10);
  if (mangaId) {
    for (let p = 2; p <= last; p++) {
      try {
        const url = BASE + "/?act=ajax&code=load_list_chapter&manga_id=" + encodeURIComponent(mangaId) + "&page_num=" + p + "&chap_id=0&keyword=";
        const data = await jsonGet(url);
        if (!data.list_chap) break;
        out = out.concat(parseChapterDoc(await harbor.parseHtml(data.list_chap), id));
      } catch (_) { break; }
    }
  }
  return uniq(out, (x) => x.id);
}

function decodeB64(value) {
  let s = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}

async function pageUrls(chapterId) {
  const document = await doc(chapterId);
  const tokenEl = document.querySelector("div.reading input#next_img_token");
  if (tokenEl) {
    const current = document.querySelector("div.reading #currentlink");
    const cdn = current && current.attr("value");
    try {
      const payload = JSON.parse(decodeB64(String(tokenEl.attr("value") || "").split(".")[1]));
      const names = JSON.parse(decodeB64(payload.data));
      if (cdn && Array.isArray(names)) return names.map((x) => abs(cdn + "/", x)).filter(Boolean);
    } catch (_) {}
  }
  return uniq(document.querySelectorAll("div.reading-detail.box_doc img").map((x) => imageUrl(chapterId, x)).filter(Boolean));
}

const plugin = { id: "likemanga-en", name: "LikeManga", popular, search, detail, chapters, pageUrls };
