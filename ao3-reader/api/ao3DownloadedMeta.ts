// Reads the details AO3 writes at the top of a downloaded HTML work — the
// title, byline, summary and above all the <dl class="tags"> block (rating,
// warnings, categories, fandoms, relationships, characters, tags, language and
// stats) — into the same AO3WorkBlurbData the web listings produce, so a
// downloaded work can be drawn by AO3WorkBlurb without any network request.
import type {
  AO3Link,
  AO3RequiredTagIcon,
  AO3SeriesInfo,
  AO3WorkBlurbData,
  AO3WorkStats,
} from "../components/AO3WorkBlurb";
import { decodeEntities, labeledBlockquote, toText } from "./htmlText";

const AO3_ORIGIN = "https://archiveofourown.org";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-10-11" -> "11 Oct 2026", the way AO3's own listings print dates.
function formatDate(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  return `${match[3]} ${MONTHS[Number(match[2]) - 1] ?? match[2]} ${match[1]}`;
}

// The tag links in a download point at the tag's own page; the app's tag
// screen lists a tag's works, which is the same address plus "/works" (what
// AO3's listings link to). The "*s*" / "*a*" / "*d*" escapes AO3 puts in tag
// addresses are kept exactly as they are.
function toAbsoluteHref(raw: string): string {
  const href = decodeEntities(raw).trim();
  const absolute = /^https?:\/\//i.test(href) ? href : `${AO3_ORIGIN}${href.startsWith("/") ? "" : "/"}${href}`;
  return absolute.replace(/^(https?:\/\/[^/]+\/tags\/[^/?#]+)$/i, "$1/works");
}

function parseLinks(html: string): AO3Link[] {
  const links: AO3Link[] = [];
  const anchorRegex = /<a\b[^>]*\bhref=(["'])((?:(?!\1)[^])*)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let anchor: RegExpExecArray | null;
  while ((anchor = anchorRegex.exec(html)) !== null) {
    const label = toText(anchor[3]);
    if (!label) continue;
    links.push({ label, href: toAbsoluteHref(anchor[2]) });
  }
  return links;
}

// The <dt>Label:</dt><dd>...</dd> pairs of the tags block, keyed by the
// lower-cased label without its colon.
function parseTagsBlock(html: string): { endIndex: number; fields: Map<string, string> } | null {
  const block = html.match(/<dl\b[^>]*\bclass=(["'])[^"']*\btags\b[^"']*\1[^>]*>([\s\S]*?)<\/dl>/i);
  if (!block || block.index === undefined) return null;
  const fields = new Map<string, string>();
  const pairRegex = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  let pair: RegExpExecArray | null;
  while ((pair = pairRegex.exec(block[2])) !== null) {
    const label = toText(pair[1]).replace(/:$/, "").trim().toLowerCase();
    if (label && !fields.has(label)) fields.set(label, pair[2]);
  }
  return { endIndex: block.index + block[0].length, fields };
}

// First field present under any of these names (AO3 uses the singular when
// there is a single entry and the plural otherwise).
const field = (fields: Map<string, string>, ...names: string[]) => {
  for (const name of names) {
    const value = fields.get(name);
    if (value !== undefined) return value;
  }
  return undefined;
};

function nonEmpty<T>(items: T[]): T[] | undefined {
  return items.length > 0 ? items : undefined;
}

// ---- required-tag symbols (the little rating / warning / category / status squares)

const ratingClass = (label: string) => {
  const value = label.toLowerCase();
  if (value.includes("general")) return "rating-general-audience";
  if (value.includes("teen")) return "rating-teen";
  if (value.includes("mature")) return "rating-mature";
  if (value.includes("explicit")) return "rating-explicit";
  return "rating-notrated";
};

const warningClass = (labels: string[]) => {
  const real = labels.filter((label) => !/^(no archive warnings apply|creator chose not to use archive warnings)$/i.test(label));
  if (real.length > 0) return "warning-yes";
  if (labels.some((label) => /creator chose not to use/i.test(label))) return "warning-choosenotto";
  if (labels.some((label) => /no archive warnings apply/i.test(label))) return "warning-no";
  return "warning-choosenotto";
};

const categoryClass = (labels: string[]) => {
  if (labels.length === 0) return "category-none";
  if (labels.length > 1) return "category-multi";
  const value = labels[0].toLowerCase();
  if (value === "f/f") return "category-femslash";
  if (value === "f/m") return "category-het";
  if (value === "m/m") return "category-slash";
  if (value === "gen") return "category-gen";
  if (value === "multi") return "category-multi";
  if (value === "other") return "category-other";
  return "category-none";
};

const symbol = (className: string, title: string): AO3RequiredTagIcon => ({
  className,
  spriteClassName: className,
  title,
});

// ---- the title / byline / summary that follow the tags block

// Summary paragraphs separated by blank lines, the way the web listings show them.
function toParagraphs(html: string): string {
  return html
    .split(/<\/p>|<br\s*\/?>\s*<br\s*\/?>/i)
    .map(toText)
    .filter(Boolean)
    .join("\n\n");
}

// "Kreise Der Spiralen - 3605649.html" -> title "Kreise Der Spiralen", id "3605649".
function fromFileName(fileName: string): { title: string; workId: string | null } {
  const base = fileName.replace(/\.html?$/i, "");
  const idMatch = base.match(/\s-\s(\d+)$/);
  return { title: base.replace(/\s-\s\d+$/, "").trim() || base, workId: idMatch ? idMatch[1] : null };
}

function parseStats(statsHtml: string | undefined) {
  const text = statsHtml ? toText(statsHtml) : "";
  const pick = (pattern: RegExp) => text.match(pattern)?.[1];
  const chapters = pick(/Chapters:\s*(\d+\s*\/\s*(?:\d+|\?))/i)?.replace(/\s+/g, "");
  const chaptersMatch = chapters?.match(/^(\d+)\/(\d+|\?)$/);
  const completedOn = pick(/Completed:\s*(\d{4}-\d{2}-\d{2})/i);
  const complete = !!completedOn || (!!chaptersMatch && chaptersMatch[2] !== "?" && Number(chaptersMatch[1]) >= Number(chaptersMatch[2]));
  return {
    published: pick(/Published:\s*(\d{4}-\d{2}-\d{2})/i),
    updated: pick(/Updated:\s*(\d{4}-\d{2}-\d{2})/i),
    completed: completedOn,
    words: pick(/Words:\s*([\d.,]+\d|\d)/i),
    chapters,
    complete,
  };
}

export function parseDownloadedFanficHtml(html: string, fileName: string): AO3WorkBlurbData {
  const fallback = fromFileName(fileName);
  const block = parseTagsBlock(html);
  const fields = block?.fields ?? new Map<string, string>();
  // Everything after the tags block: <h1>title</h1>, the byline and the summary.
  const after = block ? html.slice(block.endIndex) : html;

  const workId = html.match(/archiveofourown\.org\/works\/(\d+)/i)?.[1] ?? fallback.workId;

  const titleHtml = after.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<p\b[^>]*\bclass=(["'])message\1[^>]*>\s*<b>([\s\S]*?)<\/b>/i)?.[2];
  const title = (titleHtml ? toText(titleHtml) : "") || fallback.title;

  const bylineHtml = after.match(/<div\b[^>]*\bclass=(["'])[^"']*\bbyline\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/i)?.[2];
  let author: AO3Link | undefined;
  if (bylineHtml) {
    const authors = parseLinks(bylineHtml);
    const name = authors.length > 0 ? authors.map((link) => link.label).join(", ") : toText(bylineHtml).replace(/^by\s+/i, "");
    if (name) author = { label: name, href: authors[0]?.href };
  }

  const summaryHtml = labeledBlockquote(after, "Summary");
  const summary = summaryHtml ? toParagraphs(summaryHtml) || undefined : undefined;

  const ratingLabel = parseLinks(field(fields, "rating", "ratings") ?? "")[0]?.label ?? "";
  const warnings = parseLinks(field(fields, "archive warning", "archive warnings") ?? "");
  const categories = parseLinks(field(fields, "category", "categories") ?? "");
  const fandoms = parseLinks(field(fields, "fandom", "fandoms") ?? "");
  const relationships = parseLinks(field(fields, "relationship", "relationships") ?? "");
  const characters = parseLinks(field(fields, "character", "characters") ?? "");
  const freeforms = parseLinks(field(fields, "additional tag", "additional tags") ?? "");

  const stats = parseStats(field(fields, "stats"));
  const language = field(fields, "language", "languages");
  const workStats: AO3WorkStats = {
    language: language ? toText(language) || undefined : undefined,
    words: stats.words,
    chapters: stats.chapters,
  };

  // The date in the card's corner is the latest one; the first-posted date goes
  // in a badge when it differs.
  const latest = stats.completed ?? stats.updated ?? stats.published;
  const extraBadges =
    stats.published && latest && latest !== stats.published ? [`Published ${formatDate(stats.published)}`] : undefined;

  let series: AO3SeriesInfo | undefined;
  const seriesHtml = field(fields, "series");
  if (seriesHtml) {
    const link = parseLinks(seriesHtml)[0];
    const part = toText(seriesHtml).match(/Part\s+(\d+)/i)?.[1];
    if (link) series = { part: part ? Number(part) : undefined, title: link.label, href: link.href };
  }

  const statusLabel = stats.chapters ? (stats.complete ? "Complete Work" : "Work in Progress") : undefined;
  const warningLabels = warnings.map((link) => link.label);
  const categoryLabels = categories.map((link) => link.label);

  return {
    id: workId ?? fileName,
    title,
    workUrl: workId ? `${AO3_ORIGIN}/works/${workId}` : undefined,
    author,
    fandoms: nonEmpty(fandoms),
    rating: ratingLabel ? { label: ratingLabel } : undefined,
    category: nonEmpty(categories.map((link) => ({ label: link.label }))),
    status: statusLabel ? { label: statusLabel } : undefined,
    requiredTagIcons: [
      symbol(ratingClass(ratingLabel), ratingLabel || "Not Rated"),
      symbol(warningClass(warningLabels), warningLabels.join(", ") || "Creator Chose Not To Use Archive Warnings"),
      symbol(categoryClass(categoryLabels), categoryLabels.join(", ") || "No category"),
      symbol(stats.complete ? "complete-yes" : "complete-no", statusLabel ?? "Work in Progress"),
    ],
    publishedAt: latest ? formatDate(latest) : undefined,
    summary,
    series,
    tags: {
      warnings: nonEmpty(warnings),
      relationships: nonEmpty(relationships),
      characters: nonEmpty(characters),
      freeforms: nonEmpty(freeforms),
    },
    stats: workStats,
    extraBadges,
  };
}
