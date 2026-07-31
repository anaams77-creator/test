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

const BASES = ["https://comick.live", "https://comick.art"];
let activeBase = BASES[0];
const cursors = new Map();

async function api(path) {
  let last;
  for (const b of [activeBase].concat(BASES.filter((x) => x !== activeBase))) {
    try { const data = await jsonGet(new URL(path, b).toString()); activeBase = b; return data; } catch (e) { last = e; }
  }
  throw last || new Error("ComicK mirrors failed");
}
async function html(pathOrUrl) {
  const candidates = /^https?:/i.test(pathOrUrl) ? [pathOrUrl] : [activeBase].concat(BASES.filter((x) => x !== activeBase)).map((b) => new URL(pathOrUrl, b).toString());
  let last;
  for (const u of candidates) { try { const body = await text(u); activeBase = new URL(u).origin; return { body, url: u }; } catch (e) { last=e; } }
  throw last || new Error("ComicK mirrors failed");
}
function browseItem(x) { return { id: String(x.slug), title: cleanText(x.title), cover: abs(activeBase, x.default_thumbnail) }; }

async function popular(offset) {
  const page = pageFromOffset(offset);
  const groups = [ [7,"follow"], [30,"follow"], [90,"follow"], [7,"most_follow_new"], [30,"most_follow_new"], [90,"most_follow_new"] ];
  const pair = groups[Math.min(page - 1, groups.length - 1)];
  const data = await api("/api/comics/top?days=" + pair[0] + "&type=" + pair[1]);
  return ((data && data.data) || []).map(browseItem);
}

async function search(query, offset) {
  const key = cleanText(query).toLowerCase();
  let path = "/api/search?showAll=false&exclude_mylist=false&type=comic&order_by=follow&order_direction=desc&q=" + encodeURIComponent(query || "");
  if (offset > 0 && cursors.get(key)) path += "&cursor=" + encodeURIComponent(cursors.get(key));
  const data = await api(path);
  if (data.next_cursor) cursors.set(key, data.next_cursor); else cursors.delete(key);
  return (data.data || []).map(browseItem);
}

function extractJsonScript(source, id) {
  const re = new RegExp("<script[^>]*id=[\\\"']" + id + "[\\\"'][^>]*>([\\s\\S]*?)<\\/script>", "i");
  const m = re.exec(source);
  if (!m) throw new Error("Missing #" + id);
  return JSON.parse(m[1].trim());
}

async function detail(id) {
  const got = await html("/comic/" + encodeURIComponent(String(id)));
  const data = extractJsonScript(got.body, "comic-data");
  return {
    id: String(data.slug || id),
    title: cleanText(data.title || id),
    altTitle: data.md_titles ? Object.values(data.md_titles).map((x) => x && x.title).filter(Boolean).join(" / ") : undefined,
    cover: abs(activeBase, data.default_thumbnail),
    description: stripHtml(data.desc),
    status: ({1:"ongoing",2:data.translation_completed?"completed":"finished",3:"cancelled",4:"hiatus"})[data.status],
    author: (data.authors || []).map((x) => x.name).filter(Boolean).join(", ") || undefined,
    contentRating: data.content_rating || undefined,
  };
}

async function chapters(id) {
  let page = 1;
  let out = [];
  while (page <= 8) {
    const data = await api("/api/comics/" + encodeURIComponent(String(id)) + "/chapter-list?lang=en&page=" + page);
    const rows = data.data || [];
    out = out.concat(rows.map((ch) => ({
      id: new URL("/comic/" + id + "/" + ch.hid + "-chapter-" + ch.chap + "-" + ch.lang, activeBase).toString(),
      chapter: ch.chap == null ? null : String(ch.chap),
      title: cleanText((ch.vol ? "Vol. " + ch.vol + " " : "") + "Ch. " + ch.chap + (ch.title ? ": " + ch.title : "")),
      volume: ch.vol || null,
      pages: 0,
      language: ch.lang || "en",
      group: (ch.group_name || []).join(", ") || undefined,
      publishAt: ch.created_at || undefined,
    })));
    const pg = data.pagination || {};
    if (!pg.last_page || Number(pg.current_page || page) >= Number(pg.last_page)) break;
    page++;
  }
  return uniq(out, (x) => x.id);
}

async function pageUrls(chapterId) {
  const got = await html(chapterId);
  const data = extractJsonScript(got.body, "sv-data");
  return (((data || {}).chapter || {}).images || []).map((x) => abs(activeBase, x.url)).filter(Boolean);
}

const plugin = { id: "comick-unoriginal-en", name: "ComicK (Unoriginal)", popular, search, detail, chapters, pageUrls };
