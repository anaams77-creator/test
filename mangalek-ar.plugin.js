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

const CONFIG = {"id": "mangalek-ar", "name": "مانجا ليك", "lang": "ar", "bases": ["https://mangalik.net", "https://lekmanga.online", "https://like-manga.net", "https://lekmanga.site", "https://manga-leko.site"], "loadMore": true};

async function firstDoc(pathOrUrl, opts) {
  const candidates = /^https?:/i.test(pathOrUrl) ? [pathOrUrl] : CONFIG.bases.map((b) => new URL(pathOrUrl, b).toString());
  let last;
  for (const url of candidates) {
    try { return { document: await doc(url, opts), url }; } catch (e) { last = e; }
  }
  throw last || new Error("No mirror available");
}

function madaraCards(document, base) {
  const roots = document.querySelectorAll("div.page-item-detail, div.manga__item, div.c-tabs-item__content");
  const out = [];
  for (const root of roots) {
    const link = root.querySelector("div.post-title a") || root.querySelector("h3 a") || root.querySelector("a");
    if (!link) continue;
    const id = abs(base, link.attr("href"));
    const title = cleanText(link.text() || link.attr("title"));
    if (!id || !title) continue;
    out.push({ id, title, cover: imageUrl(base, root.querySelector("img")) });
  }
  return uniq(out, (x) => x.id);
}

async function loadMore(page, popular) {
  const body = formBody({
    action: "madara_load_more",
    page: page - 1,
    template: "madara-core/content/content-archive",
    "vars[orderby]": "meta_value_num",
    "vars[paged]": "1",
    "vars[post_type]": "wp-manga",
    "vars[post_status]": "publish",
    "vars[meta_key]": popular ? "_wp_manga_views" : "_latest_update",
    "vars[order]": "desc",
    "vars[sidebar]": "right",
    "vars[manga_archives_item_layout]": "big_thumbnail",
  });
  const opts = { method: "POST", headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" }, body };
  const got = await firstDoc("/wp-admin/admin-ajax.php", opts);
  return madaraCards(got.document, got.url);
}

async function popular(offset) {
  const page = pageFromOffset(offset);
  if (CONFIG.loadMore) {
    try { return await loadMore(page, true); } catch (_) {}
  }
  const pagePath = page === 1 ? "/manga/?m_orderby=views" : "/manga/page/" + page + "/?m_orderby=views";
  const got = await firstDoc(pagePath);
  return madaraCards(got.document, got.url);
}

async function search(query, offset) {
  const page = pageFromOffset(offset);
  const path = (page === 1 ? "/" : "/page/" + page + "/") + "?s=" + encodeURIComponent(query || "") + "&post_type=wp-manga";
  const got = await firstDoc(path);
  return madaraCards(got.document, got.url);
}

async function fetchDetail(id) {
  const document = await doc(id);
  const titleEl = document.querySelector("div.post-title h1") || document.querySelector("div.post-title h3") || document.querySelector("#manga-title h1") || document.querySelector("h1");
  const coverEl = document.querySelector("div.summary_image img") || document.querySelector("img.wp-post-image");
  const descEl = document.querySelector("div.description-summary div.summary__content") || document.querySelector("div.summary_content div.manga-excerpt") || document.querySelector("div.description-summary");
  const authors = document.querySelectorAll("div.author-content a, div.manga-authors a").map((x) => cleanText(x.text())).filter(Boolean);
  let status;
  let altTitle;
  for (const item of document.querySelectorAll("div.post-content_item")) {
    const value = cleanText(item.text());
    const summary = item.querySelector("div.summary-content");
    if (/status|الحالة/i.test(value)) status = parseStatus(summary ? summary.text() : value);
    if (/alternative|alt\.?\s*name|أسماء|الاسم البديل/i.test(value)) altTitle = cleanText(summary ? summary.text() : value.replace(/^[^:]+:/, ""));
  }
  return {
    id,
    title: cleanText(titleEl ? titleEl.text() : id),
    altTitle,
    cover: imageUrl(id, coverEl),
    description: cleanText(descEl ? descEl.text() : ""),
    status,
    author: authors.join(", ") || undefined,
  };
}

function parseChapterElements(document, base) {
  const out = [];
  for (const item of document.querySelectorAll("li.wp-manga-chapter")) {
    const a = item.querySelector("a");
    if (!a) continue;
    const id = abs(base, a.attr("href"));
    const title = cleanText(a.text());
    if (!id) continue;
    const dateEl = item.querySelector("span.chapter-release-date");
    out.push({ id, chapter: numericChapter(title), title, volume: null, pages: 0, language: CONFIG.lang, publishAt: dateEl ? cleanText(dateEl.text()) : undefined });
  }
  return uniq(out, (x) => x.id);
}

async function chapters(id) {
  const html = await text(id);
  const document = await harbor.parseHtml(html);
  let items = parseChapterElements(document, id);
  if (items.length) return items;

  const holder = document.querySelector("[id^=manga-chapters-holder]");
  const mangaId = holder && holder.attr("data-id");
  const origin = new URL(id).origin;
  if (mangaId) {
    try {
      const ajaxHtml = await text(origin + "/wp-admin/admin-ajax.php", {
        method: "POST",
        headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
        body: formBody({ action: "manga_get_chapters", manga: mangaId }),
      });
      items = parseChapterElements(await harbor.parseHtml(ajaxHtml), id);
      if (items.length) return items;
    } catch (_) {}
  }

  try {
    const ajaxHtml = await text(id.replace(/\/$/, "") + "/ajax/chapters", {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
      body: "",
    });
    return parseChapterElements(await harbor.parseHtml(ajaxHtml), id);
  } catch (_) {
    return [];
  }
}

async function pageUrls(chapterId) {
  const document = await doc(chapterId);
  const candidates = document.querySelectorAll("div.page-break img, li.blocks-gallery-item img, div.reading-content img, div.text-left img");
  return uniq(candidates.map((img) => imageUrl(chapterId, img)).filter(Boolean));
}

const plugin = {
  id: CONFIG.id,
  name: CONFIG.name,
  popular,
  search,
  detail: fetchDetail,
  chapters,
  pageUrls,
};
