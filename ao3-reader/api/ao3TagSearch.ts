// AO3's Tag Search: the form's fields and options (from AO3's own /tags/search
// page), the address a filled-in form turns into, and a reader for the results
// page (a plain list of "Type: tag (uses)" lines, plus paging).
import { balancedElement, toText } from "./htmlText";
import { AO3PageLink, parsePagination, toAbsoluteAO3Href } from "./ao3Pagination";

const AO3_ORIGIN = "https://archiveofourown.org";

export interface TagSearchOption {
  value: string;
  label: string;
}

export const AO3_TAG_SEARCH_TYPES: TagSearchOption[] = [
  { value: "Fandom", label: "Fandom" },
  { value: "Character", label: "Character" },
  { value: "Relationship", label: "Relationship" },
  { value: "Freeform", label: "Freeform" },
  { value: "", label: "Any type" },
];

export const AO3_TAG_SEARCH_WRANGLING: TagSearchOption[] = [
  { value: "canonical", label: "Canonical" },
  { value: "noncanonical", label: "Non-canonical" },
  { value: "synonymous", label: "Synonymous" },
  { value: "canonical_synonymous", label: "Canonical or synonymous" },
  { value: "noncanonical_nonsynonymous", label: "Non-canonical and non-synonymous" },
  {
    value: "noncanonical_nonsynonymous_not_unwrangleable",
    label: "Non-canonical and non-synonymous and not marked unwrangleable",
  },
  { value: "unwrangleable", label: "Unwrangleable" },
  { value: "", label: "Any status" },
];

export const AO3_TAG_SEARCH_SORT_COLUMNS: TagSearchOption[] = [
  { value: "name", label: "Name" },
  { value: "created_at", label: "Date Created" },
  { value: "uses", label: "Uses" },
];

export const AO3_TAG_SEARCH_SORT_DIRECTIONS: TagSearchOption[] = [
  { value: "asc", label: "Ascending" },
  { value: "desc", label: "Descending" },
];

export interface TagSearchForm {
  name: string;
  // Comma-separated fandom names ("Find tags wrangled to specific canonical fandoms").
  fandoms: string;
  type: string;
  wranglingStatus: string;
  sortColumn: string;
  sortDirection: string;
}

export const EMPTY_TAG_SEARCH_FORM: TagSearchForm = {
  name: "",
  fandoms: "",
  type: "",
  wranglingStatus: "",
  sortColumn: "name",
  sortDirection: "asc",
};

export function buildTagSearchUrl(form: TagSearchForm): string {
  const params: string[] = [];
  const push = (key: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) params.push(`tag_search[${key}]=${encodeURIComponent(trimmed)}`);
  };
  push("name", form.name);
  push("fandoms", form.fandoms);
  push("type", form.type);
  push("wrangling_status", form.wranglingStatus);
  push("sort_column", form.sortColumn);
  push("sort_direction", form.sortDirection);
  params.push("commit=Search+Tags");
  return `${AO3_ORIGIN}/tags/search?${params.join("&")}`;
}

// Kept for the life of the app, like the other search forms.
let rememberedTagForm: TagSearchForm = EMPTY_TAG_SEARCH_FORM;
export const getRememberedTagSearchForm = () => rememberedTagForm;
export const rememberTagSearchForm = (form: TagSearchForm) => {
  rememberedTagForm = form;
};

// ---- results page

export interface TagResult {
  // "Fandom", "Character", "Relationship", "Freeform", or "Unsorted" for a tag
  // nobody has sorted yet (AO3 calls it "UnsortedTag").
  type: string;
  name: string;
  // The tag's works listing, which is what the app opens for a tag.
  worksHref: string;
  // How many works use it; absent if the page doesn't say.
  uses?: number;
}

export interface TagResultsPage {
  // "676,358 Found"
  found?: string;
  tags: TagResult[];
  pages: AO3PageLink[];
  prevHref?: string;
  nextHref?: string;
}

function parseTag(li: string): TagResult | null {
  const anchor = li.match(/<a\b[^>]*\bhref=(["'])((?:(?!\1)[^])*)\1[^>]*>([\s\S]*?)<\/a>/i);
  if (!anchor || anchor.index === undefined) return null;
  const name = toText(anchor[3]);
  if (!name) return null;

  const before = toText(li.slice(0, anchor.index));
  const rawType = before.match(/^([A-Za-z]+):/)?.[1] ?? "";
  const type = rawType === "UnsortedTag" ? "Unsorted" : rawType.replace(/Tag$/, "");

  const after = toText(li.slice(anchor.index + anchor[0].length));
  const uses = after.match(/\((\d[\d,]*)\)/)?.[1];

  // /tags/<name> -> /tags/<name>/works (the name's own "/" etc. are already
  // written as AO3's *s* codes, so there is no other slash to confuse it).
  const href = toAbsoluteAO3Href(anchor[2]).replace(/^(https?:\/\/[^/]+\/tags\/[^/?#]+)$/i, "$1/works");
  return { type, name, worksHref: href, uses: uses ? Number(uses.replace(/,/g, "")) : undefined };
}

export function parseTagSearchResults(html: string): TagResultsPage {
  const found = html.match(/([\d,]+)\s+Found/i)?.[0]?.replace(/\s+/g, " ");

  const tags: TagResult[] = [];
  const listAt = html.search(/<ol\b[^>]*\bclass=(["'])[^"']*\btag\b[^"']*\bindex\b[^"']*\1/i);
  const list = listAt >= 0 ? balancedElement(html, "ol", listAt)?.inner : undefined;
  if (list) {
    let from = 0;
    for (;;) {
      const item = balancedElement(list, "li", from);
      if (!item) break;
      from = item.end;
      const tag = parseTag(item.inner);
      if (tag) tags.push(tag);
    }
  }

  return { found, tags, ...parsePagination(html) };
}
