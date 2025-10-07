import React, { useEffect, useRef, useState } from "react";
import { View, ActivityIndicator, Alert, StyleSheet } from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import ChapterView from "../components/ChapterView";
import ChapterControls from "../components/ChapterControls";

type ChapterLink = { href: string; text: string };

const WORK_URL = "https://archiveofourown.org/works/68204906"; // exemplo

// 🧠 Script injetado no AO3
const INJECTED_JS = `
(function() {
  function abs(href) {
    if (!href) return null;
    if (/^https?:\\/\\//i.test(href)) return href;

    // ✅ Se for só o número (ex: "59498302"), reconstruímos a URL completa
    if (/^\\d+$/.test(href)) {
      const workIdMatch = window.location.pathname.match(/works\\/(\\d+)/);
      const workId = workIdMatch ? workIdMatch[1] : null;
      if (workId) {
        return "https://archiveofourown.org/works/" + workId + "/chapters/" + href;
      }
    }

    // ✅ Corrige o problema de falta de barra
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
    // 1. Tenta encontrar e remover o cabeçalho indesejado ANTES de pegar o conteúdo
    const headingToRemove = document.querySelector('h3.heading#work.landmark');
    if (headingToRemove) {
      headingToRemove.remove(); // Remove o elemento do DOM
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

  // Atualiza estado quando muda o link
  useEffect(() => {
    setLoading(true);
    setContentHtml("");
  }, [currentUrl]);

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === "pageData") {
        console.log("📖 Recebido:", data.debug);

        // Só atualiza lista se tiver links novos
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

  // Botões de navegação
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
      <ChapterControls index={index} total={chapterLinks.length || 0} onPrev={goPrev} onNext={goNext} />

      {/* WebView oculta apenas pra pegar o HTML */}
      <WebView
        ref={(r) => (webRef.current = r)}
        source={{ uri: currentUrl }}
        injectedJavaScript={INJECTED_JS}
        onMessage={handleMessage}
        onLoadEnd={() => {
          console.log("🔁 Página carregada:", currentUrl);
          // reexecuta script depois de carregar
          setTimeout(() => webRef.current?.injectJavaScript(INJECTED_JS), 300);
          setLoading(false);
        }}
        onError={handleError}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        style={{ width: 0, height: 0 }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
});

export default FanficReader;
