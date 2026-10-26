// AO3's People Search: the form's fields, the address a filled-in form turns
// into, and a reader for the results page (a list of pseuds with their icon,
// work/bookmark counts and "about" text, plus paging).
import { balancedElement, toText } from "./htmlText";
import { anchorLinks as anchors, AO3PageLink, parsePagination, toAbsoluteAO3Href as toAbsolute } from "./ao3Pagination";

const AO3_ORIGIN = "https://archiveofourown.org";

export interface PeopleSearchForm {
  query: string;
  // Pseuds in AO3's "Pseud (user)" form, comma-separated, as the suggestion list gives them.
  name: string;
  // Comma-separated fandom names.
  fandom: string;
}

export const EMPTY_PEOPLE_SEARCH_FORM: PeopleSearchForm = { query: "", name: "", fandom: "" };

export function buildPeopleSearchUrl(form: PeopleSearchForm): string {
  const params: string[] = [];
  const push = (key: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) params.push(`people_search[${key}]=${encodeURIComponent(trimmed)}`);
  };
  push("query", form.query);
  push("name", form.name);
  push("fandom", form.fandom);
  params.push("commit=Search+People");
  return `${AO3_ORIGIN}/people/search?${params.join("&")}`;
}

// Kept for the life of the app, like the work search form (see ao3Search.ts).
let rememberedPeopleForm: PeopleSearchForm = EMPTY_PEOPLE_SEARCH_FORM;
export const getRememberedPeopleSearchForm = () => rememberedPeopleForm;
export const rememberPeopleSearchForm = (form: PeopleSearchForm) => {
  rememberedPeopleForm = form;
};

// ---- results page

export interface PeopleResultLink {
  label: string;
  href: string;
}

export interface PersonResult {
  // The pseud shown ("Rosetta E Stone") and its page.
  pseud: string;
  pseudHref: string;
  // The account the pseud belongs to when it differs from the pseud's own name
  // (AO3 prints "Pseud (account)" only then).
  account?: PeopleResultLink;
  iconUrl?: string;
  // "11 works" / "19 bookmarks" — absent when there are none.
  works?: PeopleResultLink;
  bookmarks?: PeopleResultLink;
  about?: string;
}

export interface PeopleResultsPage {
  // "199 Found"
  found?: string;
  people: PersonResult[];
  pages: AO3PageLink[];
  prevHref?: string;
  nextHref?: string;
}

// Paragraphs separated by blank lines, <br> as a line break.
const aboutText = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/<\/p>/i)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map(toText)
        .filter(Boolean)
        .join("\n"),
    )
    .filter(Boolean)
    .join("\n\n");

function parsePerson(li: string): PersonResult | null {
  const heading = li.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i)?.[1];
  if (!heading) return null;
  const [pseud, account] = anchors(heading);
  if (!pseud) return null;

  const counts = anchors(li.match(/<h5\b[^>]*>([\s\S]*?)<\/h5>/i)?.[1] ?? "");
  const iconSrc = li.match(/<img\b[^>]*\bclass=(["'])[^"']*\bicon\b[^"']*\1[^>]*\bsrc=(["'])([^"']*)\2/i)?.[3];
  const quote = balancedElement(li, "blockquote", 0)?.inner;
  const about = quote ? aboutText(quote) : "";

  return {
    pseud: pseud.label,
    pseudHref: pseud.href,
    account,
    iconUrl: iconSrc ? toAbsolute(iconSrc) : undefined,
    works: counts.find((link) => /\bworks?\b/i.test(link.label)),
    bookmarks: counts.find((link) => /\bbookmarks?\b/i.test(link.label)),
    about: about || undefined,
  };
}

export function parsePeopleSearchResults(html: string): PeopleResultsPage {
  const found = html.match(/<strong>\s*([\d,]+\s+Found)\s*<\/strong>/i)?.[1]?.replace(/\s+/g, " ");

  const people: PersonResult[] = [];
  const listAt = html.search(/<ol\b[^>]*\bclass=(["'])[^"']*\bpseud\b[^"']*\bindex\b[^"']*\1/i);
  const list = listAt >= 0 ? balancedElement(html, "ol", listAt)?.inner : undefined;
  if (list) {
    let from = 0;
    for (;;) {
      const item = balancedElement(list, "li", from);
      if (!item) break;
      const person = parsePerson(item.inner);
      if (person) people.push(person);
      from = item.end;
    }
  }

  const { pages, prevHref, nextHref } = parsePagination(html);

  return { found, people, pages, prevHref, nextHref };
}
