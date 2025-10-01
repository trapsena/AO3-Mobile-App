import React, { useEffect, useRef, useState } from "react";
import { View, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import ChapterView from "../components/ChapterView";
import ChapterControls from "../components/ChapterControls";

type ChapterLink = { href: string; text: string };

const WORK_URL = "https://archiveofourown.org/works/24627550/chapters/59498248"; // troque pela sua URL

const INJECTED_JS = `
(function() {
  function abs(href) {
    if (!href) return null;
    if (/^https?:\\/\\//i.test(href)) return href;
    // relativo -> prefixa com origin
    try { return location.origin + href; } catch(e) { return href; }
  }

  function getChapterLinks() {
    const links = [];
    // 1) select#selected_id (option values)
    const sel = document.querySelector('select#selected_id');
    if (sel) {
      Array.from(sel.options).forEach(o => {
        if (o.value) links.push({ href: abs(o.value), text: (o.textContent || '').trim() });
      });
    }
    // 2) fallback: ol.chapter list or chapter index anchors
    if (links.length === 0) {
      const els = document.querySelectorAll('ol.chapter a, #chapter_index a, .chapter_list a, .chapters a');
      Array.from(els).forEach(a => {
        if (a.href) links.push({ href: abs(a.href), text: (a.textContent || '').trim() });
      });
    }
    // dedupe preserving order
    const seen = new Set();
    return links.filter(l => {
      if (!l.href) return false;
      if (seen.has(l.href)) return false;
      seen.add(l.href);
      return true;
    });
  }

  // tenta pegar o conteúdo do capítulo: userstuff.module é o ideal
  const contentEl = document.querySelector('.userstuff.module') 
                   || document.querySelector('#chapters .chapter') 
                   || document.querySelector('.workskin .userstuff.module')
                   || document.querySelector('.workskin')
                   || document.querySelector('[id^="chapter-"]');

  const contentHtml = contentEl ? contentEl.innerHTML : null;
  const title = (document.querySelector('h2.title') && document.querySelector('h2.title').innerText) || document.title || '';
  const links = getChapterLinks();

  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: 'pageData',
    title: title,
    content: contentHtml,
    links: links
  }));
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
    // ao trocar currentUrl, WebView recarrega automaticamente e INJECTED_JS será executado
    setLoading(true);
    setContentHtml("");
  }, [currentUrl]);

  function handleMessage(e: WebViewMessageEvent) {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === "pageData") {
        // atualiza lista de capítulos se vier
        if (Array.isArray(data.links) && data.links.length > 0) {
          setChapterLinks(data.links);
          // se estivermos na página de work (links existem) e index ainda 0, e currentUrl é WORK_URL -> ir para primeiro capítulo
          const isWorkPage = currentUrl.includes("/works/") && !currentUrl.includes("/chapters/");
          if (isWorkPage) {
            // atualiza currentUrl para o primeiro capítulo (vai recarregar e enviar conteúdo)
            const first = data.links[0].href;
            if (first) {
              setIndex(0);
              setCurrentUrl(first);
              return; // aguarda novo carregamento que trará content do capítulo
            }
          }
        }

        // se veio content do capítulo, atualiza
        if (data.content) {
          // envolver em HTML básico para o RenderHTML
          const wrapped = `
            <div style="color:#fff">
              ${data.content}
            </div>
          `;
          setContentHtml(wrapped);
        } else {
          // se não veio conteúdo, tenta indicar
          setContentHtml("<p>❌ Conteúdo não encontrado nesta página.</p>");
        }
      }
    } catch (err) {
      console.warn("onMessage parse error", err);
    } finally {
      setLoading(false);
    }
  }

  function goPrev() {
    if (index > 0 && chapterLinks[index - 1]) {
      setIndex(index - 1);
      setCurrentUrl(chapterLinks[index - 1].href);
    }
  }
  function goNext() {
    if (index < chapterLinks.length - 1 && chapterLinks[index + 1]) {
      setIndex(index + 1);
      setCurrentUrl(chapterLinks[index + 1].href);
    }
  }

  function handleError(syntheticEvent: any) {
    const { nativeEvent } = syntheticEvent;
    console.warn("WebView error: ", nativeEvent);
    Alert.alert("Erro de rede", `WebView falhou ao carregar: ${nativeEvent.description || nativeEvent}`);
    setLoading(false);
  }

  return (
    <View style={styles.container}>
      {loading && <ActivityIndicator size="large" color="#fff" style={{ marginTop: 40 }} />}

      {/* Exibe capítulo renderizado */}
      <ChapterView htmlContent={contentHtml} />

      {/* Controles */}
      <ChapterControls index={index} total={chapterLinks.length || 0} onPrev={goPrev} onNext={goNext} />

      {/* WebView escondida para raspar a página */}
      <WebView
        ref={(r) => (webRef.current = r)}
        source={{ uri: currentUrl }}
        injectedJavaScript={INJECTED_JS}
        onMessage={handleMessage}
        onLoadEnd={() => setLoading(false)}
        onError={handleError}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        style={{ width: 0, height: 0 }} // escondida
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
});

export default FanficReader;
