import React, { useEffect, useRef, useState } from "react";
import { View, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import ChapterView from "../components/ChapterView";
import ChapterControls from "../components/ChapterControls";

// ✅ WebView oculta — o estilo absoluto agora está no View wrapper
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

const WORK_URL = "https://archiveofourown.org/works/68204906"; // exemplo

// 🧠 Script injetado no AO3
const INJECTED_JS = `
(function() {
  function abs(href) {
    if (!href) return null;
    if (/^https?:\\/\\//i.test(href)) return href;

    if (/^\\d+$/.test(href)) {
      const workIdMatch = window.location.pathname.match(/works\\/(\\d+)/);
      const workId = workIdMatch ? workIdMatch[1] : null;
      if (workId) {
        return "https://archiveofourown.org/works/" + workId + "/chapters/" + href;
      }
    }

    if (href.startsWith("/")) {
      return "https://archiveofourown.org" + href;
    } else {
      return "https://archiveofourown.org/" + href;
    }
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
        if (a.getAttribute('href')) {
          links.push({ href: abs(a.getAttribute('href')), text: (a.textContent || '').trim() });
        }
      });
    }

    const seen = new Set();
    const unique = links.filter(l => {
      if (!l.href) return false;
      if (seen.has(l.href)) return false;
      seen.add(l.href);
      return true;
    });

    console.log("📚 Capítulos encontrados:", unique);
    return unique;
  }

  setTimeout(() => {
    const headingToRemove = document.querySelector('h3.heading#work.landmark');
    if (headingToRemove) {
      headingToRemove.remove();
      console.log("✅ Cabeçalho removido antes da extração.");
    }
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

    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'pageData',
      title: title,
      content: contentHtml,
      links: links,
      debug: {
        url: window.location.href,
        foundLinks: links.length,
        foundContent: !!contentEl
      }
    }));
  }, 250);
})();
true;
`;

const FanficReader: React.FC = () => {
  const webRef = useRef<WebView | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>(WORK_URL);
  const [loading, setLoading] = useState<boolean>(true);
  const [contentHtml, setContentHtml] = useState<string>("");
  const [chapterLinks, setChapterLinks] = useState<ChapterLink[]>([]);
  const [index, setIndex] = useState<number>(0);

  useEffect(() => {
    setLoading(true);
    setContentHtml("");
  }, [currentUrl]);

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === "pageData") {
        console.log("📖 Recebido:", data.debug);

        if (Array.isArray(data.links) && data.links.length > 0) {
          setChapterLinks(data.links);
        }

        if (data.content) {
          const wrapped = `<div style="color:#fff; line-height:1.6;">${data.content}</div>`;
          setContentHtml(wrapped);
        } else {
          setContentHtml("<p>❌ Conteúdo não encontrado.</p>");
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
      setIndex(index - 1);
      setCurrentUrl(chapterLinks[index - 1].href);
    }
  };

  const goNext = () => {
    if (index < chapterLinks.length - 1 && chapterLinks[index + 1]) {
      setIndex(index + 1);
      setCurrentUrl(chapterLinks[index + 1].href);
    }
  };

  const handleError = (syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    console.warn("❌ WebView error:", nativeEvent);
    Alert.alert("Erro de rede", `Falha ao carregar: ${nativeEvent.description || nativeEvent}`);
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      {loading && (
        <ActivityIndicator size="large" color="#fff" style={{ marginTop: 40 }} />
      )}

      <ChapterView htmlContent={contentHtml} />
      <ChapterControls
        index={index}
        total={chapterLinks.length || 0}
        onPrev={goPrev}
        onNext={goNext}
      />

      {/* ✅ WebView agora invisível de verdade */}
      <HiddenWebView
        ref={(r) => (webRef.current = r)}
        source={{ uri: currentUrl }}
        injectedJavaScript={INJECTED_JS}
        onMessage={handleMessage}
        onLoadEnd={() => {
          console.log("🔁 Página carregada:", currentUrl);
          setTimeout(() => webRef.current?.injectJavaScript(INJECTED_JS), 300);
          setLoading(false);
        }}
        onError={handleError}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
});

export default FanficReader;
