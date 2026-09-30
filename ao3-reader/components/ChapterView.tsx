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
  // Extra top padding (on top of `padding`) reserved for the app's
  // absolutely-positioned header overlay, which floats above this WebView
  // rather than pushing it down — so the header stays a foreground layer
  // while this content still spans, and can scroll behind it, edge to edge.
  topInset?: number;
  // index of paragraph to highlight
  currentIndex?: number;
  // receive paragraph click events from webview
  onParagraphPress?: (index: number) => void;
  // Fired with the WebView's own scroll offset (its `body.scrollTop`,
  // since `body` — not `window` — is the actual scrolling element here) so
  // a parent can drive scroll-linked UI, e.g. the app's collapsible header,
  // the same way it would from a native ScrollView/FlatList's onScroll.
  onScroll?: (y: number) => void;
  // Whether the TTS controls are open. The highlight-and-scroll-into-view
  // behavior below only makes sense while TTS is actually active — jumping
  // to `currentIndex` (which defaults to paragraph 0, or a restored reading
  // position) the moment a chapter loads, regardless of whether TTS is even
  // open, auto-scrolls the WebView on every chapter open. That auto-scroll
  // reports a non-zero offset through onScroll immediately, which makes the
  // app's collapsible header hide itself before the person has scrolled at
  // all — most noticeable on chapters with a Summary/Notes preface, since
  // that pushes paragraph 0 (and the scroll distance needed to center it)
  // further down the page.
  ttsActive?: boolean;
}

const ChapterView: React.FC<Props> = ({
  htmlContent,
  fontSize = 16,
  lineHeight = 24,
  paragraphSpacing = 15,
  padding = 16,
  topInset = 0,
  currentIndex = 0,
  onParagraphPress,
  onScroll,
  ttsActive = false,
}) => {
  const webRef = useRef<any>(null);

  const width = Dimensions.get("window").width;

  // Build full HTML with CSS and a small script to handle highlighting and clicks
  const buildHtml = () => {
    const css = `
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow-x: hidden; }
      body {
        color:#fff; background:#000; font-size:${fontSize}px; line-height:${lineHeight}px;
        overflow-y: auto;
        padding-top: ${padding + topInset}px;
        padding-right: ${padding}px;
        padding-bottom: ${padding}px;
        padding-left: ${padding}px;
      }
      p{ margin-bottom:${paragraphSpacing}px; }
      p.current{ outline:2px solid rgba(76,209,55,0.25); padding:6px; background-color: rgba(76,209,55,0.04); }
      em,i{ font-style:italic; }
      strong,b{ font-weight:700; }
      hr{ height:1px; background:#444; border:none; margin:${paragraphSpacing}px 0; }
      * { -webkit-touch-callout: none; touch-action: pan-y; }
      h3.heading{ font-size:1.05em; font-weight:700; margin:0 0 8px; padding-bottom:6px; border-bottom:1px solid #333; }
      .preface.group blockquote.userstuff, .end.notes.module blockquote.userstuff{
        margin:0 0 12px; padding-left:12px; border-left:2px solid #333; color:#ddd;
      }
      .preface.group blockquote.userstuff p, .end.notes.module blockquote.userstuff p{ margin-bottom:8px; }
      #summary, #notes{ margin-bottom:16px; }
      .end.notes.module{ margin-top:28px; padding-top:14px; border-top:1px solid #333; }
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

        // Report scroll position back to RN so it can drive scroll-linked
        // UI (e.g. hiding/showing the app's header) the same way a native
        // ScrollView's onScroll would. \`body\`, not \`window\`, is the actual
        // scrolling element (it's the one with overflow-y:auto below), so
        // that's what has to be listened on and read from.
        (function(){
          var ticking = false;
          document.body.addEventListener('scroll', function(){
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(function(){
              try{ window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'scroll', y: document.body.scrollTop })); }catch(e){}
              ticking = false;
            });
          }, { passive: true });
        })();

        true;
      })();
    `;

    return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">` +
      `<style>${css}</style></head><body>${htmlContent}</body><script>${script}</script></html>`;
  };

  // Whenever the currentIndex prop changes, instruct the webview to
  // highlight it — but only while TTS is actually active. When it's not
  // (including on initial mount, since ttsActive defaults to false), pass
  // -1 instead: setHighlight still clears any stale `.current` class, but
  // never enters the `scrollIntoView` branch, since no real paragraph index
  // matches -1. See the comment on the `ttsActive` prop above for why that
  // scroll matters.
  useEffect(() => {
    if (!webRef.current) return;
    const targetIndex = ttsActive ? currentIndex : -1;
    const safe = `window.__setHighlight(${targetIndex});true;`;
    try {
      webRef.current.injectJavaScript(safe);
    } catch (e) {
      // ignore
    }
  }, [currentIndex, ttsActive]);

  const html = buildHtml();

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html }}
        style={{ width, flex: 1 }}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={true}
        bounces={false}
        overScrollMode="never"
        showsVerticalScrollIndicator={true}
        showsHorizontalScrollIndicator={false}
        onMessage={(e) => {
          try {
            const data = JSON.parse(e.nativeEvent.data);
            if (data.type === 'paragraphClick' && typeof onParagraphPress === 'function') {
              onParagraphPress(data.index);
            } else if (data.type === 'scroll' && typeof onScroll === 'function') {
              onScroll(data.y);
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
