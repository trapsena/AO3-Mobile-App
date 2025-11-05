import React, { useEffect, useRef } from "react";
import { Dimensions, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

interface Props {
  // raw HTML for the chapter body (innerHTML from AO3 extraction)
  htmlContent: string;
  fontSize?: number;
  lineHeight?: number; // pixel value
  paragraphSpacing?: number; // px
  padding?: number; // px
  // index of paragraph to highlight
  currentIndex?: number;
  // receive paragraph click events from webview
  onParagraphPress?: (index: number) => void;
}

const ChapterView: React.FC<Props> = ({
  htmlContent,
  fontSize = 16,
  lineHeight = 24,
  paragraphSpacing = 15,
  padding = 16,
  currentIndex = 0,
  onParagraphPress,
}) => {
  const webRef = useRef<any>(null);

  const width = Dimensions.get("window").width;

  // Build full HTML with CSS and a small script to handle highlighting and clicks
  const buildHtml = () => {
    const css = `
      body{ color:#fff; background:#000; font-size:${fontSize}px; line-height:${lineHeight}px; padding:${padding}px; }
      p{ margin-bottom:${paragraphSpacing}px; }
      p.current{ outline:2px solid rgba(76,209,55,0.25); padding:6px; background-color: rgba(76,209,55,0.04); }
      em,i{ font-style:italic; }
      strong,b{ font-weight:700; }
      hr{ height:1px; background:#444; border:none; margin:${paragraphSpacing}px 0; }
    `;

    const script = `
      (function(){
        function setHighlight(i){
          try{
            const ps = Array.from(document.querySelectorAll('p'));
            ps.forEach((p, idx) => {
              if(idx === i){ p.classList.add('current'); p.scrollIntoView({behavior:'smooth', block:'center'}); }
              else p.classList.remove('current');
            });
          }catch(e){/* ignore */}
        }

        // expose globally
        window.__setHighlight = setHighlight;

        // handle messages from RN
        document.addEventListener('message', function(ev){
          try{ const msg = JSON.parse(ev.data); if(msg && msg.type === 'highlight') setHighlight(msg.index); }catch(e){}
        }, false);

        // also listening to window.postMessage
        window.addEventListener('message', function(ev){
          try{ const msg = JSON.parse(ev.data); if(msg && msg.type === 'highlight') setHighlight(msg.index); }catch(e){}
        });

        // notify RN when paragraph clicked
        function bindClicks(){
          const ps = Array.from(document.querySelectorAll('p'));
          ps.forEach((p, idx) => {
            p.onclick = function(){
              try{ window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'paragraphClick', index: idx })); }catch(e){}
            };
          });
        }

        bindClicks();
        // rebind after dynamic changes
        new MutationObserver(bindClicks).observe(document.body, { childList: true, subtree: true });

        true;
      })();
    `;

    return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">` +
      `<style>${css}</style></head><body>${htmlContent}</body><script>${script}</script></html>`;
  };

  // whenever the currentIndex prop changes, instruct the webview to highlight
  useEffect(() => {
    if (!webRef.current) return;
    const safe = `window.__setHighlight(${currentIndex});true;`;
    try {
      webRef.current.injectJavaScript(safe);
    } catch (e) {
      // ignore
    }
  }, [currentIndex]);

  const html = buildHtml();

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html }}
        style={{ width }}
        javaScriptEnabled
        domStorageEnabled
        onMessage={(e) => {
          try {
            const data = JSON.parse(e.nativeEvent.data);
            if (data.type === 'paragraphClick' && typeof onParagraphPress === 'function') {
              onParagraphPress(data.index);
            }
          } catch (err) { /* ignore */ }
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
});

export default ChapterView;
