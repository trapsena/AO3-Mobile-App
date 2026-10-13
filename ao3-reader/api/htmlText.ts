// Small helpers for reading text out of AO3 HTML with regexes (no DOM is
// available outside a WebView). Shared by the chapter-page and downloaded-work
// parsers.

export const decodeEntities = (value: string) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

// UTF-8 bytes to a string without relying on TextDecoder. Forgiving on
// purpose: invalid bytes, or a multi-byte character cut off at the end of a
// partial read, become U+FFFD instead of throwing.
export function decodeUtf8(bytes: Uint8Array): string {
  const length = bytes.length;
  const isContinuation = (index: number) => index < length && (bytes[index] & 0xc0) === 0x80;
  let out = "";
  let pending: number[] = [];
  const flush = () => {
    if (pending.length > 0) out += String.fromCodePoint(...pending);
    pending = [];
  };

  let i = 0;
  while (i < length) {
    const b = bytes[i];
    let codePoint = 0xfffd;
    let size = 1;
    if (b < 0x80) {
      codePoint = b;
    } else if (b >= 0xc2 && b <= 0xdf && isContinuation(i + 1)) {
      codePoint = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      size = 2;
    } else if (b >= 0xe0 && b <= 0xef && isContinuation(i + 1) && isContinuation(i + 2)) {
      const value = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      if (value >= 0x800 && (value < 0xd800 || value > 0xdfff)) {
        codePoint = value;
        size = 3;
      }
    } else if (b >= 0xf0 && b <= 0xf4 && isContinuation(i + 1) && isContinuation(i + 2) && isContinuation(i + 3)) {
      const value =
        ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      if (value >= 0x10000 && value <= 0x10ffff) {
        codePoint = value;
        size = 4;
      }
    }
    pending.push(codePoint);
    if (pending.length >= 2048) flush();
    i += size;
  }
  flush();
  return out;
}

// The first <tagName ...> at or after `from`, with its contents up to the
// matching close tag (nested tags of the same name are counted, which a plain
// non-greedy regex gets wrong). `start`/`end` are the positions of the whole
// element in `html`. Null when there is no such tag or it is never closed.
export function balancedElement(
  html: string,
  tagName: string,
  from = 0,
): { inner: string; start: number; end: number } | null {
  const open = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  open.lastIndex = from;
  const first = open.exec(html);
  if (!first) return null;
  const innerStart = first.index + first[0].length;
  const tag = new RegExp(`<(/?)${tagName}\\b[^>]*>`, "gi");
  tag.lastIndex = innerStart;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html)) !== null) {
    if (match[1]) {
      depth -= 1;
      if (depth === 0) return { inner: html.slice(innerStart, match.index), start: first.index, end: match.index + match[0].length };
    } else {
      depth += 1;
    }
  }
  return null;
}

// AO3 downloads write a labelled quote as `<p>Label</p><blockquote class="userstuff">...</blockquote>`
// (a work's "Summary" / "Notes", a chapter's "Chapter Summary" / "Chapter Notes" /
// "Chapter End Notes"). Returns the quote's inner HTML, or null when that label has
// no quote straight after it — a chapter whose notes all sit at the end still prints
// a "Chapter Notes" label followed only by a link.
export function labeledBlockquote(html: string, label: string, from = 0): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = new RegExp(`<p\\b[^>]*>\\s*${escaped}\\s*</p>\\s*(?=<blockquote)`, "gi");
  marker.lastIndex = from;
  const found = marker.exec(html);
  if (!found) return null;
  return balancedElement(html, "blockquote", found.index + found[0].length)?.inner ?? null;
}

// Tags stripped, entities decoded, whitespace collapsed to single spaces.
export const toText = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
