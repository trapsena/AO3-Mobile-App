// Reads the parts of an AO3 chapter page the reader needs besides the story
// text itself — the fic's title, the chapter list, and which chapter this is.
// Works on HTML that has already been fetched, so it needs no WebView.

export interface ChapterPageLink {
  href: string;
  text: string;
}

export interface ChapterPageInfo {
  title: string;
  // The selected entry of the chapter dropdown ("1. Days 1 and 2"), or the fic
  // title when the page has no dropdown (single-chapter works).
  chapterTitle: string;
  // Empty for single-chapter works, which have no chapter dropdown.
  links: ChapterPageLink[];
}

const decodeEntities = (value: string) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const toText = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export function parseChapterPage(html: string, workId: string | null): ChapterPageInfo {
  const titleMatch = html.match(/<h2\b[^>]*\bclass=(["'])[^"']*\btitle\b[^"']*\1[^>]*>([\s\S]*?)<\/h2>/i);
  const title = titleMatch ? toText(titleMatch[2]) : "";

  const links: ChapterPageLink[] = [];
  let chapterTitle = title;

  const selectMatch = html.match(/<select\b[^>]*\bid=(["'])selected_id\1[^>]*>([\s\S]*?)<\/select>/i);
  if (selectMatch && workId) {
    // Attributes come in whatever order AO3 renders them — the selected one
    // is <option selected="selected" value="…"> — so each is looked up on its own.
    const optionRegex = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    let option: RegExpExecArray | null;
    while ((option = optionRegex.exec(selectMatch[2])) !== null) {
      const value = option[1].match(/\bvalue=(["'])(\d+)\1/i);
      if (!value) continue;
      const text = toText(option[2]);
      links.push({ href: `https://archiveofourown.org/works/${workId}/chapters/${value[2]}`, text });
      if (/\bselected\b/i.test(option[1]) && text) chapterTitle = text;
    }
  }

  return { title, chapterTitle, links };
}
