// Splits a downloaded AO3 work (the HTML file saved in the "Fanfics" folder)
// into chapters the reader can show offline. The file looks like this:
//
//   <div id="preface"> title, byline, tags, work Summary / Notes </div>
//   <div id="chapters">
//     <div class="meta group">        <- one per chapter
//       <h2 class="heading">Chapter 2: Title</h2>
//       <p>Chapter Summary</p><blockquote class="userstuff">...</blockquote>
//       <p>Chapter Notes</p><blockquote class="userstuff">...</blockquote>
//     </div>
//     <!--chapter content--> <div class="userstuff"> the text, <p align="center">... </div> <!--/chapter content-->
//     <div class="meta" id="endnotes2"><p>Chapter End Notes</p><blockquote class="userstuff">...</blockquote></div>
//   </div>
//   <div id="afterword"> ... <div id="endnotes"><p>End Notes</p><blockquote>...</blockquote></div> </div>
//
// A one-chapter work has no "meta group": its text is just the <div class="userstuff">
// inside #chapters. Each chapter comes out as the same markup the online reader gets
// from AO3's chapter pages (summary / notes / end-notes modules around the text), so
// the reader styles it the same way. The text itself is passed through untouched,
// which keeps the authors' own formatting such as <p align="center">.
import { balancedElement, labeledBlockquote, toText } from "./htmlText";

export interface DownloadedChapter {
  // "Chapter 2: Title" as printed in the file; the work's title for a one-chapter work.
  title: string;
  // Ready to hand to the reader's ChapterView.
  html: string;
}

export interface DownloadedWork {
  title: string;
  workId: string | null;
  chapters: DownloadedChapter[];
}

// ---- how the reader is told to open a downloaded file

// The reader opens "something" by URL. A downloaded file is addressed as
// local-fanfic:///<file name>#<chapter number, from 0>, so it travels through
// the app's navigation exactly like an AO3 address does.
const LOCAL_PREFIX = "local-fanfic:///";

export const toLocalWorkUrl = (fileName: string, chapter = 0) =>
  `${LOCAL_PREFIX}${encodeURIComponent(fileName)}${chapter > 0 ? `#${chapter}` : ""}`;

export function parseLocalWorkUrl(url: string): { fileName: string; chapter: number } | null {
  if (!url.startsWith(LOCAL_PREFIX)) return null;
  const rest = url.slice(LOCAL_PREFIX.length);
  const hash = rest.indexOf("#");
  const name = hash >= 0 ? rest.slice(0, hash) : rest;
  const chapter = hash >= 0 ? Number.parseInt(rest.slice(hash + 1), 10) : 0;
  try {
    return { fileName: decodeURIComponent(name), chapter: Number.isFinite(chapter) && chapter > 0 ? chapter : 0 };
  } catch {
    return null;
  }
}

// ---- markup helpers

const quoteModule = (className: string, label: string, quoteHtml: string, id?: string) =>
  `<div class="${className}"${id ? ` id="${id}"` : ""}><h3 class="heading">${label}</h3><blockquote class="userstuff">${quoteHtml}</blockquote></div>`;

const META_GROUP = /<div\b[^>]*\bclass=(["'])[^"']*\bmeta\b[^"']*\bgroup\b[^"']*\1[^>]*>/gi;
const CONTENT_START = "<!--chapter content-->";
const CONTENT_END = "<!--/chapter content-->";

// The part of the file before #chapters: title and the work's own Summary / Notes.
function parsePreface(preface: string, fileName: string) {
  const workId = preface.match(/archiveofourown\.org\/works\/(\d+)/i)?.[1] ?? null;
  const titleHtml =
    preface.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? preface.match(/<p\b[^>]*\bclass=(["'])message\1[^>]*>\s*<b>([\s\S]*?)<\/b>/i)?.[2];
  const fallbackTitle = fileName.replace(/\.html?$/i, "").replace(/\s-\s\d+$/, "").trim() || fileName;
  const summary = labeledBlockquote(preface, "Summary");
  const notes = labeledBlockquote(preface, "Notes");
  const modules = [
    summary ? quoteModule("summary module", "Summary:", summary) : "",
    notes ? quoteModule("notes module", "Notes:", notes) : "",
  ].join("");
  return {
    workId,
    title: (titleHtml ? toText(titleHtml) : "") || fallbackTitle,
    // Shown at the top of the first chapter, as AO3 shows it above chapter 1.
    prefaceHtml: modules ? `<div class="preface group">${modules}</div>` : "",
  };
}

export function parseDownloadedWork(html: string, fileName: string): DownloadedWork {
  const chaptersAt = html.search(/<div\b[^>]*\bid=(["'])chapters\1/i);
  const afterwordAt = html.search(/<div\b[^>]*\bid=(["'])afterword\1/i);
  const preface = parsePreface(chaptersAt >= 0 ? html.slice(0, chaptersAt) : html, fileName);
  if (chaptersAt < 0) return { title: preface.title, workId: preface.workId, chapters: [] };

  const chaptersHtml = html.slice(chaptersAt, afterwordAt > chaptersAt ? afterwordAt : html.length);
  const workEndNotesHtml = afterwordAt > chaptersAt ? labeledBlockquote(html, "End Notes", afterwordAt) : null;
  const workEndNotes = workEndNotesHtml
    ? `<div class="afterword preface group">${quoteModule("end notes module", "Work End Notes:", workEndNotesHtml)}</div>`
    : "";

  const starts: number[] = [];
  META_GROUP.lastIndex = 0;
  let group: RegExpExecArray | null;
  while ((group = META_GROUP.exec(chaptersHtml)) !== null) starts.push(group.index);

  const chapters: DownloadedChapter[] = [];

  if (starts.length === 0) {
    // A one-chapter work: just the text, in the "userstuff" block inside the
    // #chapters container (which itself carries that class, hence looking inside it).
    const container = balancedElement(chaptersHtml, "div", 0)?.inner ?? chaptersHtml;
    const textStart = container.search(/<div\b[^>]*\bclass=(["'])[^"']*\buserstuff\b[^"']*\1/i);
    const text = textStart >= 0 ? balancedElement(container, "div", textStart) : null;
    if (text) {
      chapters.push({
        title: preface.title,
        html: [preface.prefaceHtml, `<div class="userstuff">${text.inner}</div>`, workEndNotes].join(""),
      });
    }
    return { title: preface.title, workId: preface.workId, chapters };
  }

  starts.forEach((start, i) => {
    const region = chaptersHtml.slice(start, i + 1 < starts.length ? starts[i + 1] : chaptersHtml.length);
    const head = balancedElement(region, "div", 0);
    const headInner = head?.inner ?? "";
    const heading = headInner.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
    const title = (heading ? toText(heading) : "") || `Chapter ${i + 1}`;
    const chapterSummary = labeledBlockquote(headInner, "Chapter Summary");
    const chapterNotes = labeledBlockquote(headInner, "Chapter Notes");

    const afterHead = region.slice(head ? head.end : 0);
    const textStart = afterHead.indexOf(CONTENT_START);
    const textEnd = afterHead.indexOf(CONTENT_END);
    const text =
      textStart >= 0 && textEnd > textStart
        ? afterHead.slice(textStart + CONTENT_START.length, textEnd)
        : // No markers (an older export): the first "userstuff" block after the heading.
          (() => {
            const at = afterHead.search(/<div\b[^>]*\bclass=(["'])[^"']*\buserstuff\b[^"']*\1/i);
            const block = at >= 0 ? balancedElement(afterHead, "div", at) : null;
            return block ? afterHead.slice(block.start, block.end) : "";
          })();

    const afterText = textEnd >= 0 ? afterHead.slice(textEnd + CONTENT_END.length) : afterHead;
    const endNotesAt = afterText.search(/<div\b[^>]*\bid=(["'])endnotes\d*\1/i);
    const endNotesHtml = endNotesAt >= 0 ? balancedElement(afterText, "div", endNotesAt)?.inner ?? "" : "";
    const chapterEndNotes = labeledBlockquote(endNotesHtml, "Chapter End Notes");

    const parts: string[] = [];
    if (i === 0) parts.push(preface.prefaceHtml);
    if (chapterSummary || chapterNotes) {
      parts.push(
        `<div class="chapter preface group">${
          chapterSummary ? quoteModule("summary module", "Chapter Summary:", chapterSummary) : ""
        }${chapterNotes ? quoteModule("notes module", "Chapter Notes:", chapterNotes) : ""}</div>`,
      );
    }
    parts.push(text);
    if (chapterEndNotes) parts.push(quoteModule("end notes module", "Chapter End Notes:", chapterEndNotes));
    if (i === starts.length - 1) parts.push(workEndNotes);
    chapters.push({ title, html: parts.join("") });
  });

  return { title: preface.title, workId: preface.workId, chapters };
}
