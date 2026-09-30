// api/ao3Fandoms.ts
//
// Parses AO3's "Fandoms" index page (https://archiveofourown.org/media) —
// 11 media categories, each listing its 5 most popular fandoms plus a link
// to browse every fandom in that category.
import { fetchWithSession } from "./ao3Auth";

export interface AO3FandomTag {
  name: string;
  href: string;
  count?: number;
}

export interface AO3FandomCategory {
  id: string;
  title: string;
  // "/media/<Category>/fandoms" — browse every fandom in this category.
  allHref: string;
  topFandoms: AO3FandomTag[];
}

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const stripTags = (value: string) => value.replace(/<[^>]+>/g, "").trim();

const toAbsoluteAO3Url = (href?: string) => {
  if (!href) return undefined;
  // href attributes are HTML-escaped like any other markup (an apostrophe in
  // a tag name comes through as `&#39;`) — left undecoded, that literal
  // `&#39;` ends up baked into the URL instead of the `'` AO3's own link
  // actually points at, breaking the link (e.g. "BOFURI: I Don't Want...").
  const decoded = decodeHtmlEntities(href);
  if (/^https?:\/\//i.test(decoded)) return decoded;
  if (decoded.startsWith("/")) return `https://archiveofourown.org${decoded}`;
  return `https://archiveofourown.org/${decoded}`;
};

// Each category's own <li> nests a further <ol>/<li> list of its top
// fandoms, so a plain non-greedy `<li>...</li>` regex on the OUTER <li>
// would stop at the FIRST inner </li> it hits, truncating everything after
// (the same nesting problem seen elsewhere in this app's HTML scraping).
// This instead counts open/close tags from a known start position to find
// the one that actually balances it.
function extractBalancedFrom(html: string, start: number, tagName: string): { content: string; endIndex: number } | null {
  const tagRegex = new RegExp(`<${tagName}\\b|<\\/${tagName}>`, "gi");
  tagRegex.lastIndex = start;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(html)) !== null) {
    if (m[0].toLowerCase() === `</${tagName}>`) {
      depth--;
      if (depth === 0) return { content: html.slice(start, m.index), endIndex: m.index + m[0].length };
    } else {
      depth++;
    }
  }
  return null;
}

const FANDOM_TAG_RE = /<li>\s*<a\b(?=[^>]*\bclass="tag")[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*(?:\(([\d,]+)\))?\s*<\/li>/gi;

function tagMatchToFandom(m: RegExpExecArray): AO3FandomTag | null {
  const href = toAbsoluteAO3Url(m[1]);
  if (!href) return null;
  const name = decodeHtmlEntities(stripTags(m[2]));
  const countStr = m[3];
  return { name, href, count: countStr ? parseInt(countStr.replace(/,/g, ""), 10) : undefined };
}

function parseFandomTags(olHtml: string): AO3FandomTag[] {
  const tags: AO3FandomTag[] = [];
  const re = new RegExp(FANDOM_TAG_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(olHtml)) !== null) {
    const tag = tagMatchToFandom(m);
    if (tag) tags.push(tag);
  }
  return tags;
}

// A category's full fandom list can run into the thousands of <li> matches —
// running the whole regex loop synchronously blocks the JS thread long
// enough to visibly freeze the app before anything renders. This does the
// same match loop but yields back to the event loop (via setTimeout) every
// PARSE_CHUNK_SIZE matches, calling onProgress with what's been parsed so
// far so the screen can show/paginate the first chunk immediately instead of
// waiting for every fandom in the category to be parsed.
const PARSE_CHUNK_SIZE = 300;

function parseFandomTagsChunked(
  html: string,
  onProgress: (partial: AO3FandomTag[], done: boolean) => void,
): Promise<AO3FandomTag[]> {
  return new Promise((resolve) => {
    const re = new RegExp(FANDOM_TAG_RE);
    const results: AO3FandomTag[] = [];

    const step = () => {
      let processed = 0;
      let m: RegExpExecArray | null = null;
      while (processed < PARSE_CHUNK_SIZE && (m = re.exec(html)) !== null) {
        const tag = tagMatchToFandom(m);
        if (tag) results.push(tag);
        processed++;
      }
      const done = m === null;
      // A fresh copy, not `results` itself — `results` is the same mutable
      // array across every chunk, and React's setState bails out re-rendering
      // when given a value that's Object.is-identical to the current state,
      // so passing the same reference on every call would collapse all the
      // "progressive" updates into a single big one whenever some other
      // state change (e.g. `done` flipping) finally forces a re-render.
      onProgress(results.slice(), done);
      if (done) {
        resolve(results);
      } else {
        setTimeout(step, 0);
      }
    };

    step();
  });
}

export async function fetchFandomCategories(): Promise<AO3FandomCategory[]> {
  const categories: AO3FandomCategory[] = [];

  try {
    const res = await fetchWithSession("https://archiveofourown.org/media");
    if (!res.ok) {
      console.warn("[ao3Fandoms] Fandoms index fetch failed:", res.status);
      return categories;
    }

    const html = await res.text();

    const openRe = /<li\b(?=[^>]*\bid="medium_([^"]+)")(?=[^>]*\bclass="medium listbox group")[^>]*>/gi;
    let openMatch: RegExpExecArray | null;
    while ((openMatch = openRe.exec(html)) !== null) {
      const id = openMatch[1];
      const start = openMatch.index + openMatch[0].length;
      const balanced = extractBalancedFrom(html, start, "li");
      if (!balanced) break; // unbalanced/truncated — stop rather than guess
      openRe.lastIndex = balanced.endIndex;

      const block = balanced.content;
      const headingMatch = block.match(/<h3[^>]*class="heading"[^>]*>\s*<a[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      const allHref = headingMatch ? toAbsoluteAO3Url(headingMatch[1]) : undefined;
      if (!headingMatch || !allHref) continue;
      const title = decodeHtmlEntities(stripTags(headingMatch[2]));

      const olMatch = block.match(/<ol[^>]*class="index group"[^>]*>([\s\S]*?)<\/ol>/i);
      const topFandoms = olMatch ? parseFandomTags(olMatch[1]) : [];

      categories.push({ id, title, allHref, topFandoms });
    }
  } catch (err) {
    console.warn("[ao3Fandoms] Could not fetch fandom categories:", err);
  }

  return categories;
}

// AO3 renders a category's ENTIRE fandom list on one page (no server-side
// pagination) — grouped by letter, but the tag regex matches every
// `<li><a class="tag" ...>` in the document regardless of which letter's
// <ul> it's nested under, so it can run directly against the raw page
// instead of needing per-letter balanced-tag extraction.
//
// The fetch itself can't be split up (AO3 returns it as one response), but
// parsing is done in chunks (see parseFandomTagsChunked) — onProgress fires
// with the fandoms parsed so far each time a chunk completes, so a caller
// can render/paginate the first couple hundred fandoms as soon as they're
// ready rather than waiting for the whole category (which can run into the
// thousands) to finish parsing.
export async function fetchAllFandomsInCategory(
  allHref: string,
  onProgress?: (partial: AO3FandomTag[], done: boolean) => void,
): Promise<AO3FandomTag[]> {
  try {
    const res = await fetchWithSession(allHref);
    if (!res.ok) {
      console.warn("[ao3Fandoms] All-fandoms fetch failed:", res.status);
      onProgress?.([], true);
      return [];
    }
    const html = await res.text();
    return await parseFandomTagsChunked(html, (partial, done) => onProgress?.(partial, done));
  } catch (err) {
    console.warn("[ao3Fandoms] Could not fetch all fandoms:", err);
    onProgress?.([], true);
    return [];
  }
}
