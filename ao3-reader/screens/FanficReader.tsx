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
import { WebView, WebViewMessageEvent } from "react-native-webview";
import ChapterView from "../components/ChapterView";
import ChapterControls from "../components/ChapterControls";
import { Ionicons } from "@expo/vector-icons";
import ReaderHeader from "../components/ReaderHeader";
import SpeechControls from "../components/SpeechControls";
import { fetchWithSession, getSessionCookie } from "../api/ao3Auth";




// ✅ WebView oculta
const HiddenWebView = React.forwardRef((props: any, ref: any) => (
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

const WORK_URL = "https://archiveofourown.org/works/68204906/chapters/177910986"; // exemplo

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

const FanficReader: React.FC = () => {
  const webRef = useRef<any>(null);
  const [currentUrl, setCurrentUrl] = useState(WORK_URL);
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

  // When the chapter URL changes try to fetch it using the logged-in session.
  // If fetching with session fails or doesn't yield the chapter body, fall back
  // to the hidden WebView extraction (which works for public pages).
  useEffect(() => {
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
  }, [currentUrl]);

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
    }
  };
  const goNext = () => {
    if (index < chapterLinks.length - 1 && chapterLinks[index + 1]) {
      const newIndex = index + 1;
      const newUrl = chapterLinks[newIndex].href;
      console.log('[FanficReader] goNext ->', { from: index, to: newIndex, url: newUrl });
      setIndex(newIndex);
      setCurrentUrl(newUrl);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header componentizado */}
      <ReaderHeader
        fanficTitle={title}
        chapterTitle={chapterTitle}
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
        onToggleTts={() => setTtsVisible((v) => !v)}
        isTtsActive={ttsVisible}
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
