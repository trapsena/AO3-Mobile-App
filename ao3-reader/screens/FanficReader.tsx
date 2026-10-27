import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  ActivityIndicator,
  Alert,
  Animated,
  StyleSheet,
  Text,
  Modal,
} from "react-native";
import Slider from "@react-native-community/slider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import ChapterView from "../components/ChapterView";
import ChapterControls from "../components/ChapterControls";
import ReaderHeader, { ReaderHeaderHandle } from "../components/ReaderHeader";
import SpeechControls from "../components/SpeechControls";
import { fetchWithSession, getSessionCookie } from "../api/ao3Auth";
import { parseChapterPage } from "../api/ao3ChapterPage";
import type { ChapterPageDownload } from "../api/ao3ChapterPage";
import { downloadFanfic, formatFileSize } from "../api/ao3Download";
import { parseKudosForm, postKudos } from "../api/ao3Kudos";
import type { AO3KudosForm } from "../api/ao3Kudos";
import KudosButton from "../components/KudosButton";
import { parseMarkForm, postMark } from "../api/ao3MarkForLater";
import type { AO3MarkForm } from "../api/ao3MarkForLater";
import { loadDownloadedWork, syncDownloadedFanfics } from "../api/ao3DownloadedFanfics";
import { parseLocalWorkUrl, toLocalWorkUrl } from "../api/ao3DownloadedWork";
import type { DownloadedWork } from "../api/ao3DownloadedWork";
import type { ReaderHeaderInfo } from "../components/Ao3Header";
import { READER_FONT_OPTIONS } from "../components/readerFonts";
import type { ReaderFontKey } from "../components/readerFonts";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";




// ✅ WebView oculta
const HiddenWebView = React.forwardRef<any, any>((props, ref) => (
  <View
    style={{
      position: "absolute",
      top: -9999,
      left: -9999,
      width: 1,
      height: 1,
      opacity: 0.01,
      flex: 0,
    }}
  >
    <WebView {...props} ref={ref} />
  </View>
));
HiddenWebView.displayName = "DataExtractorWebView";

type ChapterLink = { href: string; text: string };

// Fallback used only if this screen is rendered without an `initialUrl` prop
// (e.g. previewing it standalone). Normally the caller supplies the fic's URL.
const FALLBACK_WORK_URL = "https://archiveofourown.org/works/47843671/chapters/120616627";

/* ------------------------------------------------------------------ */
/* Reading progress persistence                                        */
/* ------------------------------------------------------------------ */

const READING_PROGRESS_PREFIX = "ao3_reading_progress:";

interface ReadingProgress {
  workId: string;
  workUrl: string;
  currentUrl: string;
  index: number;
  title?: string;
  chapterTitle?: string;
  paragraphIndex: number;
  updatedAt: number;
}

// Any URL for the same fic — the base work URL or any /chapters/<id> link —
// contains the same numeric work id, so this is what saved progress is keyed by.
function extractWorkId(url: string): string | null {
  const m = url.match(/works\/(\d+)/);
  return m ? m[1] : null;
}

/* ------------------------------------------------------------------ */
/* Chapter content extraction (server-fetched HTML)                    */
/* ------------------------------------------------------------------ */

// A plain non-greedy `<div ...>([\s\S]*?)<\/div>` regex breaks on any
// container that has its own nested <div>s (like AO3's per-chapter wrapper,
// which nests a summary/notes preface div) — it stops at the FIRST closing
// tag it finds, truncating everything after. This instead counts open/close
// <div> tags from the opening match to find the one that actually balances it.
function extractBalancedDiv(html: string, openTagRegex: RegExp): string | null {
  const openMatch = html.match(openTagRegex);
  if (!openMatch || openMatch.index === undefined) return null;

  const start = openMatch.index + openMatch[0].length;
  const tagRegex = /<div\b|<\/div>/gi;
  tagRegex.lastIndex = start;

  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(html)) !== null) {
    if (m[0].toLowerCase() === "</div>") {
      depth--;
      if (depth === 0) return html.slice(start, m.index);
    } else {
      depth++;
    }
  }
  return null; // unbalanced — bail rather than return truncated/garbage HTML
}

// Strips the "Chapter N: Title" heading (redundant — the app shows the
// chapter title in its own header) and the "Chapter Text" accessibility-only
// landmark heading AO3 renders right before the story text.
function stripReaderNoise(html: string): string {
  return html
    .replace(/<h3\b[^>]*\bclass=(?:"|')[^"'<>]*\btitle\b[^"'<>]*(?:"|')[^>]*>[\s\S]*?<\/h3>/gi, "")
    .replace(/<h3\b[^>]*\bclass=(?:"|')[^"'<>]*\blandmark\b[^"'<>]*(?:"|')[^>]*>[\s\S]*?<\/h3>/gi, "")
    .replace(/<h3\b[^>]*\bid=(?:"|')work(?:"|')[^>]*>[\s\S]*?<\/h3>/gi, "");
}

// Prefer the whole per-chapter container (includes the chapter's own
// Summary/Notes preface and its end notes, not just the story text) over
// just the story text alone.
function extractChapterContent(html: string): string | null {
  if (!html) return null;

  const chapterContainer =
    extractBalancedDiv(html, /<div[^>]*\bid=(?:"|')chapters(?:"|')[^>]*>/i) ||
    extractBalancedDiv(html, /<div[^>]*\bid=(?:"|')chapter-\d+(?:"|')[^>]*>/i);
  if (chapterContainer) {
    // The work's own end notes aren't inside the chapter container: AO3 puts
    // them in an "afterword" section after it (on the last chapter), so
    // extracting only the container left them out. Re-wrapped the way AO3
    // marks them up so ChapterView's `.end.notes.module` styling applies, same
    // as it does to the chapter's own notes.
    const workEndNotes = chapterContainer.includes("work_endnotes")
      ? null
      : extractBalancedDiv(html, /<div[^>]*\bid=(?:"|')work_endnotes(?:"|')[^>]*>/i);
    const afterword = workEndNotes
      ? `<div class="afterword preface group"><div id="work_endnotes" class="end notes module">${workEndNotes}</div></div>`
      : "";
    return stripReaderNoise(chapterContainer) + afterword;
  }

  // Fallback: naive non-greedy regex, safe here only because this specific
  // element doesn't contain nested <div>s in practice.
  const match = html.match(
    /<div[^>]*class=(?:"|')?[^"'<>]*userstuff[^"'<>]*module[^"'<>]*?(?:"|')?[^>]*>([\s\S]*?)<\/div>/i,
  );
  return match && match[1] ? match[1] : null;
}

/* ------------------------------------------------------------------ */
/* Reader text settings persistence                                    */
/* ------------------------------------------------------------------ */

// The settings sheet's text options (font, size, line/paragraph spacing, side
// padding). Unlike reading progress these aren't per fic: one set, applied to
// every fic, kept between sessions.
const READER_SETTINGS_KEY = "ao3_reader_settings_v1";

interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  padding: number;
  fontFamily: ReaderFontKey;
}

const clampNumber = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined;

// Reads the saved settings back field by field, so a missing, corrupt or
// out-of-range value (say, from an older version of the app) falls back to
// the default for just that field instead of breaking the reader.
async function loadReaderSettings(): Promise<Partial<ReaderSettings> | null> {
  try {
    const raw = await AsyncStorage.getItem(READER_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const fontFamily = READER_FONT_OPTIONS.some((option) => option.key === parsed.fontFamily)
      ? (parsed.fontFamily as ReaderFontKey)
      : undefined;
    return {
      fontSize: clampNumber(parsed.fontSize, 12, 28),
      lineHeight: clampNumber(parsed.lineHeight, 1.2, 2.5),
      paragraphSpacing: clampNumber(parsed.paragraphSpacing, 0, 32),
      padding: clampNumber(parsed.padding, 10, 50),
      fontFamily,
    };
  } catch (err) {
    console.warn("[FanficReader] Failed to load reader settings:", err);
    return null;
  }
}

async function saveReaderSettings(settings: ReaderSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("[FanficReader] Failed to save reader settings:", err);
  }
}

async function loadReadingProgress(workId: string): Promise<ReadingProgress | null> {
  try {
    const raw = await AsyncStorage.getItem(READING_PROGRESS_PREFIX + workId);
    if (!raw) return null;
    return JSON.parse(raw) as ReadingProgress;
  } catch (err) {
    console.warn("[FanficReader] Failed to load reading progress:", err);
    return null;
  }
}

async function saveReadingProgress(progress: ReadingProgress): Promise<void> {
  try {
    await AsyncStorage.setItem(READING_PROGRESS_PREFIX + progress.workId, JSON.stringify(progress));
  } catch (err) {
    console.warn("[FanficReader] Failed to save reading progress:", err);
  }
}

// Script para coletar conteúdo e capítulos
const INJECTED_JS = `
(function() {
  // Disable pinch-zoom by ensuring a viewport meta that forbids scaling.
  try {
    (function(){
      var meta = document.querySelector('meta[name="viewport"]');
      if(!meta){ meta = document.createElement('meta'); meta.name = 'viewport'; document.head.appendChild(meta); }
      meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no');
    })();
  } catch(e) { /* ignore */ }
  function abs(href) {
    if (!href) return null;
    if (/^https?:\\/\\//i.test(href)) return href;
    if (/^\\d+$/.test(href)) {
      const workIdMatch = window.location.pathname.match(/works\\/(\\d+)/);
      const workId = workIdMatch ? workIdMatch[1] : null;
      if (workId) return "https://archiveofourown.org/works/" + workId + "/chapters/" + href;
    }
    if (href.startsWith("/")) return "https://archiveofourown.org" + href;
    return "https://archiveofourown.org/" + href;
  }

  function getChapterLinks() {
    const links = [];
    const sel = document.querySelector('select#selected_id');
    if (sel) {
      Array.from(sel.options).forEach(o => {
        if (o.value) links.push({ href: abs(o.value), text: (o.textContent || '').trim() });
      });
    }
    if (links.length === 0) {
      const els = document.querySelectorAll('ol.chapter a, #chapter_index a, .chapter_list a, .chapters a');
      Array.from(els).forEach(a => {
        if (a.getAttribute('href')) links.push({ href: abs(a.getAttribute('href')), text: (a.textContent || '').trim() });
      });
    }
    const seen = new Set();
    return links.filter(l => {
      if (!l.href) return false;
      if (seen.has(l.href)) return false;
      seen.add(l.href);
      return true;
    });
  }

  setTimeout(() => {
    // Prefer the whole per-chapter container (includes the chapter's own
    // Summary/Notes preface and its end notes, not just the story text) —
    // falling back to just the story text if that container isn't found.
    const contentEl = document.querySelector('#chapters .chapter')
      || document.querySelector('[id^="chapter-"]')
      || document.querySelector('.userstuff.module')
      || document.querySelector('.workskin .userstuff.module')
      || document.querySelector('.workskin');
    let contentHtml = null;
    if (contentEl) {
      const clone = contentEl.cloneNode(true);
      // Drop the "Chapter N: Title" heading (redundant — the app already
      // shows the chapter title in its own header) and the "Chapter Text"
      // accessibility-only landmark heading.
      Array.from(clone.querySelectorAll('h3.title, h3.landmark, #work')).forEach(function(el) { el.remove(); });
      contentHtml = clone.innerHTML;
      // The work's end notes sit outside the chapter element, in the page's
      // "afterword" section, so they have to be added separately.
      const endNotesEl = document.querySelector('#work_endnotes');
      if (endNotesEl && !contentEl.contains(endNotesEl)) {
        contentHtml += '<div class="afterword preface group">' + endNotesEl.outerHTML + '</div>';
      }
    }
    const title = (document.querySelector('h2.title') && document.querySelector('h2.title').innerText)
      || document.title
      || '';
    const links = getChapterLinks();
    const currentOption = document.querySelector('select#selected_id option:checked');
    const chapterTitle = currentOption ? currentOption.textContent.trim() : title;
    // The page's Download menu (a.href is already absolute).
    const downloads = Array.from(document.querySelectorAll('li.download ul a')).map(function(a) {
      return { format: (a.textContent || '').trim(), href: a.href };
    }).filter(function(d) { return d.format && d.href; });

    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'pageData',
      title,
      chapterTitle,
      content: contentHtml,
      links,
      downloads,
    }));
  }, 300);
})();
true;
`;

interface Props {
  // URL of the work/chapter to open. This is how other screens (e.g. a work
  // card's onPress) hand off "open this fic" to the reader.
  initialUrl?: string;
  // Called when the person taps the back button. If omitted, no back button
  // is shown (useful if this screen is reached via a navigator that already
  // provides its own back gesture/header).
  onClose?: () => void;
  // Space to leave at the top for the app's collapsible header overlay,
  // which stays static (not scroll-linked) while the reader is active.
  topInset?: number;
  // Published whenever this screen's title/chapter/TTS state changes (and
  // cleared with `null` on unmount) so the app's global Ao3Header can render
  // this screen's title + TTS/comments/settings actions instead of this
  // component drawing its own header bar.
  onHeaderActionsChange?: (info: ReaderHeaderInfo | null) => void;
  // Forwarded from ChapterView's WebView scroll position (its `body`
  // scrollTop, reported via postMessage) so the app's collapsible header
  // can hide/show while reading the same way it does on the other tabs,
  // which drive it from a native ScrollView/FlatList's onScroll instead.
  onScroll?: (y: number) => void;
  // Called with an archiveofourown.org URL when a link in the chapter text
  // points at a different AO3 work, so the app can open that fic in this
  // screen (as a fresh reader, with this one kept on the back stack).
  onOpenWork?: (url: string) => void;
}

const FanficReader: React.FC<Props> = ({
  initialUrl,
  onClose,
  topInset = 0,
  onHeaderActionsChange,
  onScroll,
  onOpenWork,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const webRef = useRef<any>(null);
  const readerHeaderRef = useRef<ReaderHeaderHandle>(null);
  // NOTE: this only seeds the *initial* URL. If a parent keeps this component
  // mounted and just changes `initialUrl` to open a different fic, that won't
  // do anything by itself — render with `key={initialUrl}` at the call site
  // (e.g. <FanficReader key={url} initialUrl={url} .../>) so React remounts
  // a fresh reader (fresh chapter index, chapter list, etc.) per fic.
  const [currentUrl, setCurrentUrl] = useState(initialUrl || FALLBACK_WORK_URL);
  // Set when `initialUrl` points at a downloaded file (see api/ao3DownloadedWork.ts)
  // instead of an AO3 page: the chapters then come from that file on the phone,
  // with no request to AO3, and the online-only extras (comments, download) are off.
  const localFile = useMemo(() => parseLocalWorkUrl(initialUrl ?? "")?.fileName ?? null, [initialUrl]);
  const localWorkRef = useRef<DownloadedWork | null>(null);
  // Reading progress is kept per work: by AO3 work id online, by file name for a
  // download (its chapters are numbered by position, not by AO3's chapter ids).
  const progressKeyFor = (url: string) =>
    localFile ? `local:${localFile}` : extractWorkId(url) || extractWorkId(initialUrl || FALLBACK_WORK_URL);
  const [loading, setLoading] = useState(true);
  const [contentHtml, setContentHtml] = useState("");
  const [rawContentHtml, setRawContentHtml] = useState("");
  const [chapterLinks, setChapterLinks] = useState<ChapterLink[]>([]);
  const [index, setIndex] = useState(0);
  const [title, setTitle] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  // The fic's Download menu from its AO3 page (EPUB, PDF, HTML...), and whether
  // a download is running. Both feed the header's three-dot dropdown, whose
  // Download entry saves the HTML version.
  const [downloads, setDownloads] = useState<ChapterPageDownload[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const htmlDownload = downloads.find((d) => d.format.toLowerCase() === "html");

  // Kudos: the "Kudos ♥" form read off the chapter page (absent when signed out,
  // on your own work, or for a downloaded file), whether the end of the chapter
  // is on screen, and the state of the button that posts it.
  const [kudosForm, setKudosForm] = useState<AO3KudosForm | null>(null);
  const [atChapterEnd, setAtChapterEnd] = useState(false);
  const [kudosGiven, setKudosGiven] = useState(false);
  const [kudosSubmitting, setKudosSubmitting] = useState(false);

  // Marked for Later: the form read off the chapter page says which of "Mark for
  // Later" / "Mark as Read" AO3 is offering (so which state the work is in).
  const [markForm, setMarkForm] = useState<AO3MarkForm | null>(null);
  const [markBusy, setMarkBusy] = useState(false);

  // A small message that fades in near the bottom and out again by itself,
  // for confirmations that don't need a tap to dismiss (a finished download).
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    toastTimerRef.current = setTimeout(() => {
      Animated.timing(toastOpacity, { toValue: 0, duration: 260, useNativeDriver: true }).start(() =>
        setToastMessage(null),
      );
    }, 2800);
  };
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  // ⚙️ Reader settings
  const [fontSize, setFontSize] = useState(16);
  // A multiple of the font size (see ChapterView's lineHeight), matching the
  // settings slider's 1.2–2.5 range. 1.5 is the same look the old 24px gave
  // at the default 16px font.
  const [lineHeight, setLineHeight] = useState(1.5);
  const [padding, setPadding] = useState(20);
  const [fontFamily, setFontFamily] = useState<ReaderFontKey>("system");
  const [configVisible, setConfigVisible] = useState(false);
  // TTS / leitura
  const [ttsVisible, setTtsVisible] = useState(false);
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  // 16px is the gap paragraphs effectively had before the slider worked (the
  // browser's default 1em top margin was setting it), so the default look holds.
  const [paragraphSpacing, setParagraphSpacing] = useState(16);
  const [currentTtsIndex, setCurrentTtsIndex] = useState(0);

  // Reading-progress restore: `hydrated` gates the content-fetch effect below
  // so we check AsyncStorage for a saved chapter/position *before* fetching
  // anything, instead of loading chapter 1 and then immediately re-fetching
  // whatever chapter was actually saved.
  const [hydrated, setHydrated] = useState(false);
  const pendingParagraphIndexRef = useRef<number | null>(null);

  // The hidden WebView is only a fallback for when the session fetch below
  // can't produce the chapter. It isn't logged in (the fetch uses stored
  // cookies; the WebView has its own cookie jar), so it often sees a different
  // page — a different title, and a chapter list of one or none — and its data
  // used to land after the fetch's and overwrite it ("Capítulo 1 / 1" on a
  // multi-chapter fic). So it is only mounted once the fetch has failed, and
  // anything it posts is ignored once the fetch has delivered this chapter.
  const [webViewFallback, setWebViewFallback] = useState(false);
  const chapterFromFetchRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Saved text settings load here too, before `hydrated` flips and the
      // chapter is fetched, so the first thing drawn already uses them rather
      // than flashing the defaults first.
      const savedSettings = await loadReaderSettings();
      if (!cancelled && savedSettings) {
        if (savedSettings.fontSize !== undefined) setFontSize(savedSettings.fontSize);
        if (savedSettings.lineHeight !== undefined) setLineHeight(savedSettings.lineHeight);
        if (savedSettings.paragraphSpacing !== undefined) setParagraphSpacing(savedSettings.paragraphSpacing);
        if (savedSettings.padding !== undefined) setPadding(savedSettings.padding);
        if (savedSettings.fontFamily !== undefined) setFontFamily(savedSettings.fontFamily);
      }

      const workId = progressKeyFor(initialUrl || FALLBACK_WORK_URL);
      if (workId) {
        const saved = await loadReadingProgress(workId);
        if (!cancelled && saved) {
          console.log("[FanficReader] Resuming saved reading progress", saved);
          setCurrentUrl(saved.currentUrl);
          setIndex(saved.index);
          if (saved.paragraphIndex > 0) {
            pendingParagraphIndexRef.current = saved.paragraphIndex;
          }
        } else if (!cancelled) {
          console.log("[FanficReader] No saved progress for this work, starting fresh:", workId);
        }
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally runs once per mount — pair with `key={initialUrl}` at the
    // call site so opening a different fic mounts a fresh instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Saves the text settings whenever one changes. Debounced because a slider
  // reports every tick while dragged; the latest values are also flushed when
  // the reader closes, so leaving right after a change doesn't lose it. Not
  // before `hydrated`, or the defaults would overwrite what was just loaded.
  const readerSettings: ReaderSettings = { fontSize, lineHeight, paragraphSpacing, padding, fontFamily };
  const readerSettingsRef = useRef(readerSettings);
  readerSettingsRef.current = readerSettings;
  const settingsDirtyRef = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    settingsDirtyRef.current = true;
    const handle = setTimeout(() => {
      settingsDirtyRef.current = false;
      saveReaderSettings(readerSettingsRef.current);
    }, 400);
    return () => clearTimeout(handle);
  }, [hydrated, fontSize, lineHeight, paragraphSpacing, padding, fontFamily]);

  useEffect(() => {
    return () => {
      if (settingsDirtyRef.current) saveReaderSettings(readerSettingsRef.current);
    };
  }, []);

  // When the chapter URL changes try to fetch it using the logged-in session.
  // If fetching with session fails or doesn't yield the chapter body, fall back
  // to the hidden WebView extraction (which works for public pages).
  useEffect(() => {
    if (!hydrated) return; // wait until we've checked for saved reading progress
    let cancelled = false;

    if (localFile) {
      // A downloaded work: read the file once, then show the chapter this
      // address names (a position in the file, see toLocalWorkUrl).
      (async () => {
        setLoading(true);
        setContentHtml("");
        setRawContentHtml("");
        try {
          const work = localWorkRef.current ?? (await loadDownloadedWork(localFile));
          localWorkRef.current = work;
          if (cancelled) return;

          // A shorter re-download can leave a saved chapter past the end.
          const chapterIndex = Math.min(parseLocalWorkUrl(currentUrl)?.chapter ?? 0, work.chapters.length - 1);
          const chapter = work.chapters[chapterIndex];
          setTitle(work.title);
          setChapterTitle(chapter.title);
          // As on an AO3 page, a one-chapter work has no chapter list.
          setChapterLinks(
            work.chapters.length > 1
              ? work.chapters.map((entry, i) => ({ href: toLocalWorkUrl(localFile, i), text: entry.title }))
              : [],
          );
          setIndex(chapterIndex);
          setRawContentHtml(chapter.html);
          setContentHtml(`<div style="color:#fff; line-height:1.6;">${chapter.html}</div>`);
        } catch (err) {
          console.warn("[FanficReader] Could not open the downloaded work:", err);
          Alert.alert("Couldn't open this download", err instanceof Error ? err.message : "Something went wrong.");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      chapterFromFetchRef.current = false;
      setLoading(true);
      setAtChapterEnd(false);
      setContentHtml("");
      setRawContentHtml("");

      try {
        const res = await fetchWithSession(currentUrl);
        if (res && res.ok) {
          const html = await res.text();
          const inner = extractChapterContent(html);
          if (inner) {
            console.log('[FanficReader] fetchWithSession succeeded, extracted content for', currentUrl);
            if (cancelled) return;

            // The page is already in hand, so read the rest of what the reader
            // needs — the chapter list behind the chapter controls, and the
            // titles — straight from it, and treat it as the one source of
            // truth for this chapter (see chapterFromFetchRef).
            chapterFromFetchRef.current = true;
            const page = parseChapterPage(html, extractWorkId(currentUrl));
            if (page.title) setTitle(page.title);
            if (page.chapterTitle) setChapterTitle(page.chapterTitle);
            if (page.links.length > 0) setChapterLinks(page.links);
            if (page.downloads.length > 0) setDownloads(page.downloads);
            setKudosForm(parseKudosForm(html));
            setMarkForm(parseMarkForm(html));

            setRawContentHtml(inner);
            setContentHtml(`<div style="color:#fff; line-height:1.6;">${inner}</div>`);
            setLoading(false);
            return;
          }
        }
      } catch (err) {
        // fetchWithSession might fail (no session or network). We'll fallback to webview
        console.warn("fetchWithSession failed, falling back to WebView extraction:", err);
      }

      // fallback: let the hidden WebView load the page and postMessage back.
      // Mounting it (or, if it's already mounted, pointing it at the new
      // currentUrl) is what starts that load; it posts pageData via handleMessage.
      if (!cancelled) setWebViewFallback(true);

      // keep loader until the webview posts pageData
      // setLoading will be cleared in handleMessage
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUrl, hydrated]);

  // Extrai parágrafos simples do HTML para leitura (fallback sem cheerio)
  useEffect(() => {
    if (contentHtml) {
      const regex = /<p[^>]*>(.*?)<\/p>/gis;
      const ps: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = regex.exec(contentHtml)) !== null) {
        let inner = m[1].replace(/<[^>]+>/g, "").trim();
        if (inner.length > 0) ps.push(inner);
      }
      setParagraphs(ps);
    } else {
      setParagraphs([]);
    }
  }, [contentHtml]);

  // Once the current chapter's paragraphs are available, apply any saved
  // paragraph position that was queued during the hydration step above.
  useEffect(() => {
    if (pendingParagraphIndexRef.current === null || paragraphs.length === 0) return;
    const target = pendingParagraphIndexRef.current;
    pendingParagraphIndexRef.current = null;
    if (target < paragraphs.length) {
      console.log("[FanficReader] Restoring saved paragraph position:", target);
      setCurrentTtsIndex(target);
    }
  }, [paragraphs]);

  // NOTE: highlighting is now handled inside the visible WebView (ChapterView)

  // Log session token and chapter metadata each time a chapter is rendered/loaded.
  // This helps debugging to confirm which session is being used for fetchWithSession.
  useEffect(() => {
    (async () => {
      try {
        const cookie = await getSessionCookie();
        const m = cookie ? cookie.match(/_otwarchive_session=([^;]+)/) : null;
        const token = m ? m[1] : cookie ?? null;
        console.log("[FanficReader] Chapter rendered.", {
          index,
          chapterTitle,
          currentUrl,
          sessionToken: token,
        });
      } catch (err) {
        console.log("[FanficReader] Could not read session token", err);
      }
    })();
  }, [currentUrl, index, chapterTitle, rawContentHtml]);

  // Persist reading progress (fic, chapter, and last-focused paragraph)
  // whenever any of it changes, debounced so rapid paragraph taps or quick
  // chapter flips don't hammer AsyncStorage with a write per change.
  useEffect(() => {
    if (!hydrated) return; // don't save until we've applied any saved progress first
    const workId = progressKeyFor(currentUrl);
    if (!workId) return;

    const handle = setTimeout(() => {
      const progress: ReadingProgress = {
        workId,
        workUrl: initialUrl || FALLBACK_WORK_URL,
        currentUrl,
        index,
        title,
        chapterTitle,
        paragraphIndex: currentTtsIndex,
        updatedAt: Date.now(),
      };
      saveReadingProgress(progress);
      console.log("[FanficReader] Saved reading progress", progress);
    }, 800);

    return () => clearTimeout(handle);
  }, [hydrated, currentUrl, index, currentTtsIndex, title, chapterTitle, initialUrl]);

  // Force an immediate (non-debounced) save right before leaving, so tapping
  // back doesn't race the 800ms debounce in the effect above. Defined here
  // (rather than further down, near goPrev/goNext) so the header-info
  // publish effect just below can reference it without a temporal-dead-zone
  // issue — `const` function expressions aren't hoisted the way function
  // declarations are.
  const saveProgressNow = () => {
    const workId = progressKeyFor(currentUrl);
    if (workId) {
      saveReadingProgress({
        workId,
        workUrl: initialUrl || FALLBACK_WORK_URL,
        currentUrl,
        index,
        title,
        chapterTitle,
        paragraphIndex: currentTtsIndex,
        updatedAt: Date.now(),
      }).catch((err) => console.warn("[FanficReader] Failed to save progress:", err));
    }
  };

  const handleClose = () => {
    saveProgressNow();
    onClose?.();
  };

  // A link in the text to an AO3 work. A different work opens as its own
  // reader (the app swaps this screen to it and keeps this fic on the back
  // stack, so back returns here); this fic's progress is saved first so
  // nothing since the last debounced save is lost. A link back into this same
  // fic jumps to that chapter instead of reopening the fic over itself.
  const handleOpenWork = (url: string) => {
    const targetWorkId = extractWorkId(url);
    const currentWorkId = extractWorkId(currentUrl) || extractWorkId(initialUrl || FALLBACK_WORK_URL);
    if (targetWorkId && targetWorkId === currentWorkId) {
      const chapterId = url.match(/chapters\/(\d+)/)?.[1];
      const target = chapterId ? chapterLinks.findIndex((link) => link.href.includes(`/chapters/${chapterId}`)) : -1;
      if (target >= 0 && target !== index) {
        setIndex(target);
        setCurrentUrl(chapterLinks[target].href);
        setCurrentTtsIndex(0);
      }
      return;
    }
    saveProgressNow();
    onOpenWork?.(url);
  };

  // Saves the fic's HTML version into the app's "Fanfics" folder (see
  // api/ao3Download.ts). The work-level download is the same whichever chapter
  // is open. A finished download shows a brief toast; a failure still gets an
  // alert, since that one needs to be noticed.
  const handleDownload = async () => {
    const entry = htmlDownload;
    if (!entry || isDownloading) return;
    setIsDownloading(true);
    try {
      const workId = extractWorkId(currentUrl) || extractWorkId(initialUrl || FALLBACK_WORK_URL);
      const saved = await downloadFanfic({ href: entry.href, format: entry.format, title, workId });
      showToast(`Download complete · ${saved.fileName} (${formatFileSize(saved.sizeBytes)})`);
      // Read its tags/stats into the saved Downloaded Works list right away, so
      // the card is already there the next time that screen opens.
      syncDownloadedFanfics().catch((error) => console.warn("[FanficReader] Could not update the downloads list:", error));
    } catch (err) {
      console.warn("[FanficReader] Download failed:", err);
      Alert.alert("Download failed", err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  };

  // Posts kudos for the work and tells the person how it went in the toast, in
  // AO3's own words. Both a fresh kudos and "you already left kudos" fill the heart.
  const handleKudos = async () => {
    if (!kudosForm || kudosSubmitting) return;
    setKudosSubmitting(true);
    try {
      const result = await postKudos(kudosForm, chapterLinks[index]?.href ?? currentUrl);
      if (result.ok || result.alreadyGiven) setKudosGiven(true);
      showToast(result.message);
    } finally {
      setKudosSubmitting(false);
    }
  };

  // Adds the work to (or takes it off) Marked for Later and says so in the toast,
  // in AO3's own words; the menu entry then flips to match.
  const handleMarkForLater = async () => {
    if (!markForm || markBusy) return;
    setMarkBusy(true);
    try {
      const result = await postMark(markForm, chapterLinks[index]?.href ?? currentUrl);
      if (result.ok && result.form) setMarkForm(result.form);
      showToast(result.message);
    } finally {
      setMarkBusy(false);
    }
  };

  // Publish this screen's title/TTS state (and a way to reach the settings
  // modal / comments drawer this component still owns via ReaderHeader's
  // ref) so the app's global Ao3Header can render them. Cleared on unmount
  // so switching away from the Reader tab doesn't leave stale info behind.
  useEffect(() => {
    onHeaderActionsChange?.({
      fanficTitle: title,
      chapterTitle,
      isTtsActive: ttsVisible,
      onToggleTts: () => setTtsVisible((v) => !v),
      onOpenComments: () => readerHeaderRef.current?.openComments(),
      onOpenSettings: () => readerHeaderRef.current?.openSettings(),
      // Comments live on AO3 and a download has none, so the button is hidden
      // for one (a download also has no Download menu: `downloads` stays empty).
      canComment: !localFile,
      canDownload: !!htmlDownload,
      onDownload: handleDownload,
      isDownloading,
      markForLater: markForm && !localFile ? { marked: markForm.marked, busy: markBusy, onToggle: handleMarkForLater } : null,
      onGoBack: handleClose,
    });
    // handleClose isn't memoized, so its dependencies (everything it reads —
    // currentUrl/index/currentTtsIndex/initialUrl/onClose) are listed
    // explicitly here instead, to keep the published closure from going
    // stale between title/chapterTitle changes (e.g. after just tapping a
    // paragraph to move currentTtsIndex, without a new chapter loading).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, chapterTitle, ttsVisible, currentUrl, index, currentTtsIndex, initialUrl, onClose, onHeaderActionsChange, downloads, isDownloading, markForm, markBusy]);

  // Separate from the effect above so the "clear on unmount" cleanup doesn't
  // also fire (and briefly flicker the header) on every title/TTS update —
  // this one's dependency array never changes, so its cleanup only runs once,
  // when the screen actually unmounts.
  useEffect(() => {
    return () => onHeaderActionsChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      console.log('[FanficReader] handleMessage received:', data && data.type);
      if (data.type === "pageData") {
        // The fetch already delivered this chapter, with a chapter list and
        // titles read from a page we know is the right one — don't let the
        // (logged-out, differently-rendered) WebView page overwrite them.
        if (chapterFromFetchRef.current) return;
        if (data.title) setTitle(data.title);
        if (data.chapterTitle) setChapterTitle(data.chapterTitle);
        if (Array.isArray(data.links) && data.links.length > 0) setChapterLinks(data.links);
        if (Array.isArray(data.downloads) && data.downloads.length > 0) setDownloads(data.downloads);
        if (data.content) {
          // store raw content (without wrapper) so we can rebuild highlighted variants
          console.log('[FanficReader] HiddenWebView posted chapter content (length):', data.content ? data.content.length : 0);
          setRawContentHtml(data.content);
          setContentHtml(`<div style="color:#fff; line-height:1.6;">${data.content}</div>`);
        }
      }
    } catch (err) {
      console.warn("⚠️ Erro ao processar mensagem:", err);
    } finally {
      setLoading(false);
    }
  };

  const goPrev = () => {
    if (index > 0 && chapterLinks[index - 1]) {
      const newIndex = index - 1;
      const newUrl = chapterLinks[newIndex].href;
      console.log('[FanficReader] goPrev ->', { from: index, to: newIndex, url: newUrl });
      setIndex(newIndex);
      setCurrentUrl(newUrl);
      setCurrentTtsIndex(0);
    }
  };
  const goNext = () => {
    if (index < chapterLinks.length - 1 && chapterLinks[index + 1]) {
      const newIndex = index + 1;
      const newUrl = chapterLinks[newIndex].href;
      console.log('[FanficReader] goNext ->', { from: index, to: newIndex, url: newUrl });
      setIndex(newIndex);
      setCurrentUrl(newUrl);
      setCurrentTtsIndex(0);
    }
  };

  return (
    // No paddingTop here: this box must stay full-screen (a background
    // layer) so ChapterView's WebView underneath can scroll its content
    // behind the app's absolutely-positioned header rather than starting
    // after it. The header-height reserve is instead baked into the
    // WebView's own HTML padding, via ChapterView's `topInset` prop below.
    <View style={styles.container}>
      {/* Owns the settings modal + comments drawer only — title and the
          buttons that open them now live in the app's global Ao3Header,
          which reaches back into this via readerHeaderRef. */}
      <ReaderHeader
        ref={readerHeaderRef}
        fontSize={fontSize}
        lineSpacing={lineHeight}
        paragraphSpacing={paragraphSpacing}
        padding={padding}
        fontFamily={fontFamily}
        // The comments drawer asks AO3 for this page's comments. A fic opened
        // at its bare /works/<id> URL (which is how every work card opens one)
        // gets redirected by AO3 to /works/<id>/chapters/<first>, and the
        // redirect drops the ?show_comments=true the drawer adds — so the
        // first chapter showed no comments. The chapter list holds the real
        // chapter URL; single-chapter works have no list and no redirect.
        currentUrl={localFile ? undefined : chapterLinks[index]?.href ?? currentUrl}
        onConfigChange={(cfg) => {
          if (cfg.fontSize !== undefined) setFontSize(cfg.fontSize);
          if (cfg.lineSpacing !== undefined) setLineHeight(cfg.lineSpacing);
          if (cfg.padding !== undefined) setPadding(cfg.padding);
          if (cfg.paragraphSpacing !== undefined) setParagraphSpacing(cfg.paragraphSpacing);
          if (cfg.fontFamily !== undefined) setFontFamily(cfg.fontFamily);
        }}
      />

      {loading && <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: topInset + 40 }} />}

      <ChapterView
        htmlContent={rawContentHtml}
        key={`${fontSize}-${lineHeight}-${padding}-${fontFamily}`}
        fontSize={fontSize}
        lineHeight={lineHeight}
        paragraphSpacing={paragraphSpacing}
        padding={padding}
        fontFamily={fontFamily}
        topInset={topInset}
        onScroll={onScroll}
        currentIndex={currentTtsIndex}
        ttsActive={ttsVisible}
        onOpenWork={handleOpenWork}
        onReachEnd={setAtChapterEnd}
        onParagraphPress={(i) => {
          // Only jump the TTS position when its controls are already open —
          // tapping a paragraph while they're closed no longer opens them.
          if (!ttsVisible) return;
          setCurrentTtsIndex(i);
        }}
      />

      {/* Controles — alterna entre leitura e navegação */}
      {ttsVisible ? (
        <SpeechControls
          paragraphs={paragraphs}
          index={currentTtsIndex}
          onIndexChange={(i) => setCurrentTtsIndex(i)}
          onClose={() => setTtsVisible(false)}
          title={title}
          subtitle={chapterTitle}
        />
      ) : (
        <ChapterControls index={index} total={chapterLinks.length || 0} onPrev={goPrev} onNext={goNext} />
      )}

      {/* Kudos: only for an online fic that offers the form, once the end of the chapter is reached. */}
      <KudosButton
        visible={!!kudosForm && !localFile && atChapterEnd && !ttsVisible && !loading}
        given={kudosGiven}
        submitting={kudosSubmitting}
        onPress={handleKudos}
        bottom={72}
      />

      {/* Brief confirmation (e.g. a finished download); sits just above the bottom controls and ignores touches. */}
      {toastMessage ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.toast, kudosForm && atChapterEnd && { bottom: 140 }, { opacity: toastOpacity }]}
        >
          <Text style={styles.toastText} numberOfLines={2}>
            {toastMessage}
          </Text>
        </Animated.View>
      ) : null}

      {/* ReaderConfigModal moved into ReaderHeader; kept for backwards compatibility but hidden */}


      {/* WebView oculta — só montada como plano B, quando o fetch falha */}
      {webViewFallback && (
        <HiddenWebView
          ref={webRef}
          source={{ uri: currentUrl }}
          injectedJavaScript={INJECTED_JS}
          onMessage={handleMessage}
          onLoadEnd={() => webRef.current?.injectJavaScript(INJECTED_JS)}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
        />
      )}
    </View>
  );
};

// Note: header/title/subtitle/modal/modalTitle/label/closeBtn/closeText below
// are unused (this screen's own header bar and settings modal were long ago
// replaced by ReaderHeader + the app's global Ao3Header) — left in place
// rather than deleted as a separate cleanup, but themed anyway for
// consistency since converting the whole block costs nothing.
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toast: {
    position: "absolute",
    left: 24,
    right: 24,
    bottom: 76,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toastText: { color: colors.text, fontSize: 13, textAlign: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: "bold" },
  subtitle: { color: colors.textFaint, fontSize: 14 },
  modal: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: 20,
    justifyContent: "center",
  },
  modalTitle: { color: colors.text, fontSize: 20, marginBottom: 20, textAlign: "center" },
  label: { color: colors.text, marginTop: 15 },
  closeBtn: {
    marginTop: 30,
    backgroundColor: colors.surfaceRaised,
    padding: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  closeText: { color: colors.text, fontSize: 16 },
});

export default FanficReader;