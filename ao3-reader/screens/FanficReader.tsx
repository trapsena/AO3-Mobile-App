import React, { useEffect, useRef, useState } from "react";
import {
  View,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  Modal,
} from "react-native";
import Slider from "@react-native-community/slider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import ChapterView from "../components/ChapterView";
import ChapterControls from "../components/ChapterControls";
import { Ionicons } from "@expo/vector-icons";
import ReaderHeader, { ReaderHeaderHandle } from "../components/ReaderHeader";
import SpeechControls from "../components/SpeechControls";
import { fetchWithSession, getSessionCookie } from "../api/ao3Auth";
import type { ReaderHeaderInfo } from "../components/Ao3Header";




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
    const contentEl = document.querySelector('.userstuff.module')
      || document.querySelector('#chapters .chapter')
      || document.querySelector('.workskin .userstuff.module')
      || document.querySelector('.workskin')
      || document.querySelector('[id^="chapter-"]');
    const contentHtml = contentEl ? contentEl.innerHTML : null;
    const title = (document.querySelector('h2.title') && document.querySelector('h2.title').innerText)
      || document.title
      || '';
    const links = getChapterLinks();
    const currentOption = document.querySelector('select#selected_id option:checked');
    const chapterTitle = currentOption ? currentOption.textContent.trim() : title;

    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'pageData',
      title,
      chapterTitle,
      content: contentHtml,
      links,
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
}

const FanficReader: React.FC<Props> = ({ initialUrl, onClose, topInset = 0, onHeaderActionsChange }) => {
  const webRef = useRef<any>(null);
  const readerHeaderRef = useRef<ReaderHeaderHandle>(null);
  // NOTE: this only seeds the *initial* URL. If a parent keeps this component
  // mounted and just changes `initialUrl` to open a different fic, that won't
  // do anything by itself — render with `key={initialUrl}` at the call site
  // (e.g. <FanficReader key={url} initialUrl={url} .../>) so React remounts
  // a fresh reader (fresh chapter index, chapter list, etc.) per fic.
  const [currentUrl, setCurrentUrl] = useState(initialUrl || FALLBACK_WORK_URL);
  const [loading, setLoading] = useState(true);
  const [contentHtml, setContentHtml] = useState("");
  const [rawContentHtml, setRawContentHtml] = useState("");
  const [chapterLinks, setChapterLinks] = useState<ChapterLink[]>([]);
  const [index, setIndex] = useState(0);
  const [title, setTitle] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");

  // ⚙️ Reader settings
  const [fontSize, setFontSize] = useState(16);
  const [lineHeight, setLineHeight] = useState(24);
  const [padding, setPadding] = useState(20);
  const [configVisible, setConfigVisible] = useState(false);
  // TTS / leitura
  const [ttsVisible, setTtsVisible] = useState(false);
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [paragraphSpacing, setParagraphSpacing] = useState(12);
  const [currentTtsIndex, setCurrentTtsIndex] = useState(0);

  // Reading-progress restore: `hydrated` gates the content-fetch effect below
  // so we check AsyncStorage for a saved chapter/position *before* fetching
  // anything, instead of loading chapter 1 and then immediately re-fetching
  // whatever chapter was actually saved.
  const [hydrated, setHydrated] = useState(false);
  const pendingParagraphIndexRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const workId = extractWorkId(initialUrl || FALLBACK_WORK_URL);
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

  // When the chapter URL changes try to fetch it using the logged-in session.
  // If fetching with session fails or doesn't yield the chapter body, fall back
  // to the hidden WebView extraction (which works for public pages).
  useEffect(() => {
    if (!hydrated) return; // wait until we've checked for saved reading progress
    let cancelled = false;
    const extractContent = (html: string): string | null => {
      if (!html) return null;
      // Try several AO3 selectors in order. Regex is a pragmatic fallback.
      const patterns = [
        /<div[^>]*class=(?:"|')?[^"'<>]*userstuff[^"'<>]*module[^"'<>]*?(?:"|')?[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*id=(?:"|')?chapters(?:"|')?[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*class=(?:"|')?[^"'<>]*workskin[^"'<>]*?(?:"|')?[^>]*>([\s\S]*?)<\/div>/i,
        /<div[^>]*id=(?:"|')?chapter-[^"'<>]+(?:"|')?[^>]*>([\s\S]*?)<\/div>/i,
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m && m[1]) return m[1];
      }
      return null;
    };

    (async () => {
      setLoading(true);
      setContentHtml("");
      setRawContentHtml("");

      try {
        const res = await fetchWithSession(currentUrl);
        if (res && res.ok) {
          const html = await res.text();
          const inner = extractContent(html);
          if (inner) {
            console.log('[FanficReader] fetchWithSession succeeded, extracted content for', currentUrl);
            if (cancelled) return;
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

      // fallback: let the hidden WebView load the page and postMessage back
      try {
        // trigger a reload of the hidden webview; it will post pageData via handleMessage
        webRef.current?.reload?.();
      } catch (e) {
        // ignore
      }

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
    const workId = extractWorkId(currentUrl) || extractWorkId(initialUrl || FALLBACK_WORK_URL);
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
    });
  }, [title, chapterTitle, ttsVisible, onHeaderActionsChange]);

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
        if (data.title) setTitle(data.title);
        if (data.chapterTitle) setChapterTitle(data.chapterTitle);
        if (Array.isArray(data.links) && data.links.length > 0) setChapterLinks(data.links);
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

  // Force an immediate (non-debounced) save right before leaving, so tapping
  // back doesn't race the 800ms debounce in the effect above.
  const handleClose = () => {
    const workId = extractWorkId(currentUrl) || extractWorkId(initialUrl || FALLBACK_WORK_URL);
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
      }).catch((err) => console.warn("[FanficReader] Failed to save progress on close:", err));
    }
    onClose?.();
  };

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      {onClose ? (
        <TouchableOpacity
          onPress={handleClose}
          style={[styles.backBtn, { top: topInset + 12 }]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
      ) : null}

      {/* Owns the settings modal + comments drawer only — title and the
          buttons that open them now live in the app's global Ao3Header,
          which reaches back into this via readerHeaderRef. */}
      <ReaderHeader
        ref={readerHeaderRef}
        fontSize={fontSize}
        lineSpacing={lineHeight}
        paragraphSpacing={paragraphSpacing}
        padding={padding}
        currentUrl={currentUrl}
        onConfigChange={(cfg) => {
          if (cfg.fontSize !== undefined) setFontSize(cfg.fontSize);
          if (cfg.lineSpacing !== undefined) setLineHeight(cfg.lineSpacing);
          if (cfg.padding !== undefined) setPadding(cfg.padding);
          if (cfg.paragraphSpacing !== undefined) setParagraphSpacing(cfg.paragraphSpacing);
        }}
      />

      {loading && <ActivityIndicator size="large" color="#fff" style={{ marginTop: 40 }} />}

      <ChapterView
        htmlContent={rawContentHtml}
        key={`${fontSize}-${lineHeight}-${padding}`}
        fontSize={fontSize}
        lineHeight={lineHeight}
        paragraphSpacing={paragraphSpacing}
        padding={padding}
        currentIndex={currentTtsIndex}
        onParagraphPress={(i) => {
          // sync paragraph click with TTS index and open controls if closed
          setCurrentTtsIndex(i);
          if (!ttsVisible) setTtsVisible(true);
        }}
      />

      {/* Controles — alterna entre leitura e navegação */}
      {ttsVisible ? (
        <SpeechControls paragraphs={paragraphs} index={currentTtsIndex} onIndexChange={(i) => setCurrentTtsIndex(i)} onClose={() => setTtsVisible(false)} />
      ) : (
        <ChapterControls index={index} total={chapterLinks.length || 0} onPrev={goPrev} onNext={goNext} />
      )}

      {/* ReaderConfigModal moved into ReaderHeader; kept for backwards compatibility but hidden */}


      {/* WebView oculta */}
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
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  backBtn: {
    position: "absolute",
    top: 12,
    left: 12,
    zIndex: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "#111",
    borderBottomColor: "#333",
    borderBottomWidth: 1,
  },
  title: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  subtitle: { color: "#aaa", fontSize: 14 },
  modal: {
    flex: 1,
    backgroundColor: "#111",
    padding: 20,
    justifyContent: "center",
  },
  modalTitle: { color: "#fff", fontSize: 20, marginBottom: 20, textAlign: "center" },
  label: { color: "#fff", marginTop: 15 },
  closeBtn: {
    marginTop: 30,
    backgroundColor: "#333",
    padding: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  closeText: { color: "#fff", fontSize: 16 },
});

export default FanficReader;