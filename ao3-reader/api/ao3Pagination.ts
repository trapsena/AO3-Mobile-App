// Shared by the readers of AO3's search results pages (people, tags): links
// made absolute, and the page bar (`ol.pagination`) turned into data.
import { balancedElement, decodeEntities, toText } from "./htmlText";

const AO3_ORIGIN = "https://archiveofourown.org";

export const toAbsoluteAO3Href = (raw: string) => {
  const href = decodeEntities(raw).trim();
  if (/^https?:\/\//i.test(href)) return href;
  return `${AO3_ORIGIN}${href.startsWith("/") ? "" : "/"}${href}`;
};

// Every link in a piece of HTML, as label + absolute address.
export const anchorLinks = (html: string) => {
  const found: Array<{ label: string; href: string }> = [];
  const regex = /<a\b[^>]*\bhref=(["'])((?:(?!\1)[^])*)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const label = toText(match[3]);
    if (label) found.push({ label, href: toAbsoluteAO3Href(match[2]) });
  }
  return found;
};

export interface AO3PageLink {
  label: string;
  href?: string;
  isCurrent?: boolean;
  isGap?: boolean;
}

export interface AO3Pagination {
  pages: AO3PageLink[];
  prevHref?: string;
  nextHref?: string;
}

export function parsePagination(html: string): AO3Pagination {
  const pages: AO3PageLink[] = [];
  let prevHref: string | undefined;
  let nextHref: string | undefined;
  const navAt = html.search(/<ol\b[^>]*\bclass=(["'])[^"']*\bpagination\b[^"']*\1/i);
  const nav = navAt >= 0 ? balancedElement(html, "ol", navAt)?.inner : undefined;
  if (nav) {
    let from = 0;
    for (;;) {
      const item = balancedElement(nav, "li", from);
      if (!item) break;
      from = item.end;
      const opening = nav.slice(item.start).match(/^<li\b[^>]*>/i)?.[0] ?? "";
      const link = anchorLinks(item.inner)[0];
      if (/class=(["'])previous\1/i.test(opening)) {
        prevHref = link?.href;
      } else if (/class=(["'])next\1/i.test(opening)) {
        nextHref = link?.href;
      } else {
        const label = toText(item.inner);
        if (!label) continue;
        if (/class=(["'])gap\1/i.test(opening)) pages.push({ label, isGap: true });
        else pages.push({ label, href: link?.href, isCurrent: /class=(["'])current\1/i.test(item.inner) });
      }
    }
  }
  return { pages, prevHref, nextHref };
}
