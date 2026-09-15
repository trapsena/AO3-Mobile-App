import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { fetchWithSession } from "../api/ao3Auth";
import AO3WorkBlurb, { AO3WorkBlurbData, AO3Link } from "../components/AO3WorkBlurb";
import type { WorksHeaderInfo } from "../components/Ao3Header";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface AO3PaginationPage {
  label: string;
  href?: string;
  isCurrent?: boolean;
  isGap?: boolean;
  isPrev?: boolean;
  isNext?: boolean;
  disabled?: boolean;
}

interface AO3Pagination {
  pages: AO3PaginationPage[];
  currentPage: number;
  totalPages?: number;
  prevHref?: string;
  nextHref?: string;
}

interface Props {
  // Whose works page to load.
  username: string;
  title?: string;
  // Called when the header's back button is tapped (Works isn't a
  // persistent nav tab — it's opened by tapping a "Works (N)" button
  // elsewhere, and the header's back button is what lets you return).
  onClose?: () => void;
  onWorkPress?: (work: AO3WorkBlurbData) => void;
  // Called when a work card's author byline is tapped, so the caller can
  // open that author's profile in-app instead of the external browser.
  onPressAuthor?: (author: AO3Link) => void;
  // Forwarded straight to the FlatList's onScroll so a parent (e.g. the
  // app's collapsible header) can track this screen's scroll position.
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  contentContainerTopPadding?: number;
  // Published whenever this screen's title changes (and cleared with `null`
  // on unmount) so the app's global Ao3Header can render it instead of this
  // component drawing its own title bar.
  onHeaderActionsChange?: (info: WorksHeaderInfo | null) => void;
}

/* ------------------------------------------------------------------ */
/* URL helpers                                                         */
/* ------------------------------------------------------------------ */

const worksBaseUrl = (username: string) =>
  `https://archiveofourown.org/users/${encodeURIComponent(username)}/works`;

// Appends a timestamp so every request hits AO3's origin fresh instead of
// potentially being served a cached response for a URL we've already
// fetched (mirrors AO3HistoryScreen/AO3BookmarksScreen's same need).
const withCacheBust = (url: string) => {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
};

// The WebView only reloads (and only re-runs the extractor script) when the
// `source.html` string it's given actually changes — prefixing a unique
// comment guarantees a resync always forces a real reload + re-extraction.
const tagHtmlForReload = (html: string) =>
  `<!-- ao3-works-sync:${Date.now()}:${Math.random().toString(36).slice(2)} -->\n${html}`;

async function fetchWorksHtml(url: string): Promise<string | null> {
  const bustedUrl = withCacheBust(url);
  try {
    const res = await fetchWithSession(bustedUrl);
    console.log("[AO3WorksScreen] List fetch response", {
      url: bustedUrl,
      status: res.status,
      ok: res.ok,
      redirected: res.redirected,
      finalUrl: res.url,
    });
    if (!res.ok) {
      console.warn("[AO3WorksScreen] List fetch was not ok", {
        status: res.status,
        statusText: res.statusText,
      });
      return null;
    }
    return await res.text();
  } catch (err: any) {
    console.warn("[AO3WorksScreen] List fetch threw an error:", {
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
    });
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Hidden WebView (HTML -> structured data extractor)                  */
/* ------------------------------------------------------------------ */

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
HiddenWebView.displayName = "AO3WorksExtractorWebView";

const WORKS_INJECTED_JS = `
(function() {
  function abs(href) {
    if (!href) return null;
    if (/^https?:\\/\\//i.test(href)) return href;
    if (href.startsWith("/")) return "https://archiveofourown.org" + href;
    return "https://archiveofourown.org/" + href;
  }

  function text(el) {
    return (el && el.textContent ? el.textContent : "")
      .replace(/\\s+/g, " ")
      .trim();
  }

  function firstMatch(root, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = root.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  function collectTags(root, selectors) {
    var out = [];
    var seen = new Set();
    selectors.forEach(function(sel) {
      Array.from(root.querySelectorAll(sel)).forEach(function(a) {
        var label = text(a);
        if (!label) return;
        var href = abs(a.getAttribute("href"));
        var key = (href || "") + "::" + label.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ label: label, href: href || undefined });
      });
    });
    return out;
  }

  function collectCommaTags(root) {
    var buckets = {
      warnings: [],
      relationships: [],
      characters: [],
      freeforms: [],
    };
    var seen = {
      warnings: new Set(),
      relationships: new Set(),
      characters: new Set(),
      freeforms: new Set(),
    };

    var nodes = Array.from(root.querySelectorAll("ul.tags.commas > li"));
    nodes.forEach(function(li) {
      var group = li.className || "";
      if (!buckets[group]) return;

      var link = li.querySelector("a.tag");
      if (!link) return;

      var label = text(link);
      if (!label) return;

      var href = abs(link.getAttribute("href"));
      var key = (href || "") + "::" + label.toLowerCase();
      if (seen[group].has(key)) return;
      seen[group].add(key);
      buckets[group].push({ label: label, href: href || undefined });
    });

    return buckets;
  }

  function collectRequired(root) {
    function classToIconClass(className) {
      if (!className) return null;
      var classes = String(className).split(/\\s+/).filter(Boolean);
      var known = classes.find(function(cls) {
        return /^(rating-|warning-|category-|complete-|status-)/.test(cls);
      });
      return known || null;
    }

    function extractIcon(slot, fallbackKind) {
      if (!slot) return null;

      var iconNode = slot.querySelector("a > span[class]:not(.text), a span[class]:not(.text), span[class]:not(.text)");
      var linkNode = slot.querySelector("a");
      var target = iconNode || linkNode || slot;
      var spriteClassName = classToIconClass(target.className) || classToIconClass(iconNode && iconNode.className) || fallbackKind;
      if (!spriteClassName) return null;
      var fullClassName = (iconNode && iconNode.className) || (target && target.className) || spriteClassName;

      var titleNode = slot.querySelector(".text") || iconNode || target;
      return {
        className: fullClassName,
        spriteClassName: spriteClassName,
        title: target.getAttribute && target.getAttribute("title")
          ? target.getAttribute("title")
          : text(titleNode),
        href: abs((linkNode && linkNode.getAttribute("href")) || (target.getAttribute && target.getAttribute("href"))) || undefined,
      };
    }

    var slots = Array.from(root.querySelectorAll("ul.required-tags > li"));
    var icons = [];

    slots.forEach(function(slot, index) {
      var fallbackKind = index === 0
        ? "rating-notrated"
        : index === 1
          ? "warning-no"
          : index === 2
            ? "category-none"
            : "complete-no";
      var icon = extractIcon(slot, fallbackKind);
      if (icon) icons.push(icon);
    });

    if (icons.length === 0) {
      var rating = firstMatch(root, [".required-tags .rating", ".rating"]);
      var warnings = firstMatch(root, [".required-tags .warnings", ".warnings"]);
      var category = firstMatch(root, [".required-tags .category", ".category"]);
      var status = firstMatch(root, [".required-tags .iswip", ".required-tags .status", ".iswip", ".status"]);
      if (rating) icons.push({ className: rating.className || "rating-notrated", spriteClassName: classToIconClass(rating.className) || "rating-notrated", title: text(rating), href: abs(rating.getAttribute("href")) || undefined });
      if (warnings) icons.push({ className: warnings.className || "warning-yes", spriteClassName: classToIconClass(warnings.className) || "warning-yes", title: text(warnings), href: abs(warnings.getAttribute("href")) || undefined });
      if (category) icons.push({ className: category.className || "category-none", spriteClassName: classToIconClass(category.className) || "category-none", title: text(category), href: abs(category.getAttribute("href")) || undefined });
      if (status) icons.push({ className: status.className || "complete-no", spriteClassName: classToIconClass(status.className) || "complete-no", title: text(status), href: abs(status.getAttribute("href")) || undefined });
    }

    var rating = icons.find(function(icon) { return /^rating-/.test(icon.spriteClassName || icon.className); });
    var warnings = icons.filter(function(icon) { return /^warning-/.test(icon.spriteClassName || icon.className); });
    var category = icons.filter(function(icon) { return /^category-/.test(icon.spriteClassName || icon.className); });
    var status = icons.find(function(icon) { return /^(complete-|status-)/.test(icon.spriteClassName || icon.className); });
    return {
      rating: rating ? { label: rating.title || rating.className, href: rating.href } : undefined,
      warnings: warnings.length ? warnings.map(function(icon) { return { label: icon.title || icon.className, href: icon.href }; }) : undefined,
      category: category.length ? category.map(function(icon) { return { label: icon.title || icon.className, href: icon.href }; }) : undefined,
      status: status ? { label: status.title || status.className, href: status.href } : undefined,
      icons: icons,
    };
  }

  function collectStats(root) {
    var stats = {};
    var dts = Array.from(root.querySelectorAll("dl.stats dt"));
    dts.forEach(function(dt) {
      var key = text(dt).replace(/:$/, "").toLowerCase();
      var dd = dt.nextElementSibling;
      if (dd && dd.tagName && dd.tagName.toLowerCase() === "dd") {
        stats[key] = text(dd);
      }
    });
    return stats;
  }

  function collectSummary(root) {
    var el = firstMatch(root, [".summary", ".userstuff.summary", ".summary blockquote"]);
    if (!el) return null;
    var ps = Array.from(el.querySelectorAll("p")).map(function(p) { return text(p); }).filter(Boolean);
    return ps.length ? ps.join("\\n\\n") : text(el);
  }

  function collectSeries(root) {
    var el = firstMatch(root, [".series"]);
    if (!el) return null;
    var a = el.querySelector("a");
    var part = el.querySelector("strong");
    return {
      part: part ? text(part) : undefined,
      title: a ? text(a) : text(el),
      href: a ? abs(a.getAttribute("href")) || undefined : undefined,
    };
  }

  function parseWork(root) {
    var titleLink = firstMatch(root, ["h4.heading a", ".header h4 a", "a[href*='/works/']"]);
    var authorLink = root.querySelector("a[rel='author']");
    var fandomLinks = collectTags(root, ["h5.fandoms a.tag", ".fandoms a.tag"]);
    var commaTags = collectCommaTags(root);
    var required = collectRequired(root);
    var stats = collectStats(root);
    return {
      id: root.id || "",
      work: {
        id: root.id || "",
        title: titleLink ? text(titleLink) : text(root),
        workUrl: titleLink ? abs(titleLink.getAttribute("href")) || undefined : undefined,
        author: authorLink ? { label: text(authorLink), href: abs(authorLink.getAttribute("href")) || undefined } : undefined,
        fandoms: fandomLinks.length ? fandomLinks : undefined,
        tags: {
          warnings: commaTags.warnings.length ? commaTags.warnings.map(function(t) { return t.label; }) : undefined,
          relationships: commaTags.relationships.length ? commaTags.relationships.map(function(t) { return t.label; }) : undefined,
          characters: commaTags.characters.length ? commaTags.characters.map(function(t) { return t.label; }) : undefined,
          freeforms: commaTags.freeforms.length ? commaTags.freeforms.map(function(t) { return t.label; }) : undefined,
        },
        rating: required.rating,
        warnings: required.warnings,
        category: required.category,
        status: required.status,
        requiredTags: required,
        requiredTagIcons: required.icons,
        publishedAt: text(root.querySelector(".datetime")) || undefined,
        summary: collectSummary(root) || undefined,
        series: collectSeries(root) || undefined,
        stats: {
          language: stats.language,
          words: stats.words,
          chapters: stats.chapters,
          kudos: stats.kudos,
          hits: stats.hits,
          comments: stats.comments,
          bookmarks: stats.bookmarks,
        },
      },
    };
  }

  function collectItems() {
    var nodes = Array.from(document.querySelectorAll("li.work.blurb"));
    var seen = new Set();
    var items = [];
    nodes.forEach(function(node) {
      var id = node.id || "";
      if (!id || seen.has(id)) return;
      seen.add(id);
      items.push(parseWork(node));
    });
    return items;
  }

  function collectPagination() {
    var container = firstMatch(document, ["ol.pagination.actions.pagy", "ol.pagination.actions", "ol.pagination"]);
    if (!container) return null;

    var items = Array.from(container.querySelectorAll("li"));
    var pages = items.map(function(li) {
      var a = li.querySelector("a");
      var span = li.querySelector("span");
      var label = text(a || span || li);
      var isPrev = li.classList.contains("previous");
      var isNext = li.classList.contains("next");
      var isGap = li.classList.contains("gap") || (!a && !isPrev && !isNext && /^(…|\\.\\.\\.)$/.test(label));
      var isCurrent = li.classList.contains("current") || (a && a.classList.contains("current")) || (a && a.getAttribute("aria-current") === "page");
      var disabled = !a && !!span;
      return {
        label: label,
        href: a ? abs(a.getAttribute("href")) || undefined : undefined,
        isCurrent: isCurrent,
        isGap: isGap,
        isPrev: isPrev,
        isNext: isNext,
        disabled: disabled,
      };
    });

    var currentItem = pages.find(function(p) { return p.isCurrent; });
    var prevItem = pages.find(function(p) { return p.isPrev; });
    var nextItem = pages.find(function(p) { return p.isNext; });

    var maxPage = 0;
    pages.forEach(function(p) {
      if (p.isPrev || p.isNext || p.isGap) return;
      var n = parseInt(p.label, 10);
      if (!isNaN(n) && n > maxPage) maxPage = n;
    });

    return {
      pages: pages,
      currentPage: currentItem ? (parseInt(currentItem.label, 10) || 1) : 1,
      totalPages: maxPage || undefined,
      prevHref: prevItem && !prevItem.disabled ? prevItem.href : undefined,
      nextHref: nextItem && !nextItem.disabled ? nextItem.href : undefined,
    };
  }

  setTimeout(function() {
    try {
      var headingEl = document.querySelector("h2.heading");
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: "worksData",
        pageTitle: document.title || "",
        listHeading: headingEl ? text(headingEl) : "",
        items: collectItems(),
        pagination: collectPagination(),
      }));
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: "worksError",
        error: String(err && err.message ? err.message : err),
      }));
    }
  }, 350);
})();
true;
`;

/* ------------------------------------------------------------------ */
/* Screen                                                               */
/* ------------------------------------------------------------------ */

const AO3WorksScreen: React.FC<Props> = ({
  username,
  title,
  onClose,
  onWorkPress,
  onPressAuthor,
  onScroll,
  contentContainerTopPadding = 0,
  onHeaderActionsChange,
}) => {
  const webRef = useRef<any>(null);
  const lastPayloadRef = useRef<string | null>(null);
  const listRef = useRef<any>(null);

  const [currentUrl, setCurrentUrl] = useState(() => worksBaseUrl(username));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageTitle, setPageTitle] = useState(title || "");
  const [items, setItems] = useState<AO3WorkBlurbData[]>([]);
  const [pagination, setPagination] = useState<AO3Pagination | null>(null);
  const [sourceHtml, setSourceHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSourceHtml(null);

    (async () => {
      const html = await fetchWorksHtml(currentUrl);
      if (cancelled || !html) return;
      setSourceHtml(tagHtmlForReload(html));
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUrl]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const html = await fetchWorksHtml(currentUrl);
    if (html) {
      setSourceHtml(tagHtmlForReload(html));
    } else {
      setRefreshing(false);
    }
  }, [currentUrl]);

  const resetListPosition = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const goToUrl = useCallback(
    (url?: string) => {
      if (!url) return;
      setItems([]);
      setPagination(null);
      setCurrentUrl(url);
      resetListPosition();
    },
    [resetListPosition],
  );

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      if (e.nativeEvent.data === lastPayloadRef.current) return;
      lastPayloadRef.current = e.nativeEvent.data;

      const payload = JSON.parse(e.nativeEvent.data);
      if (payload.type === "worksData") {
        setPageTitle(payload.listHeading || payload.pageTitle || title || "");
        const nextItems = Array.isArray(payload.items) ? payload.items.map((entry: any) => entry.work) : [];
        setItems(nextItems);
        setPagination(payload.pagination || null);
      } else if (payload.type === "worksError") {
        console.warn("[AO3WorksScreen] Works extraction failed:", payload.error);
      }
    } catch (err) {
      console.warn("[AO3WorksScreen] Could not parse works payload:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    onHeaderActionsChange?.({
      title: pageTitle || title || `${username}'s Works`,
      onGoBack: () => onClose?.(),
    });
  }, [pageTitle, title, username, onClose, onHeaderActionsChange]);

  // Separate from the effect above so the "clear on unmount" cleanup doesn't
  // also fire (and briefly flicker the header) on every title update — this
  // one's dependency array never changes, so its cleanup only runs once,
  // when the screen actually unmounts.
  useEffect(() => {
    return () => onHeaderActionsChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const numericPages = useMemo(
    () => (pagination?.pages || []).filter((p) => !p.isPrev && !p.isNext),
    [pagination],
  );

  const hasPagination =
    !!pagination && (!!pagination.prevHref || !!pagination.nextHref || numericPages.length > 1);

  return (
    // No paddingTop here: this box must stay full-screen (a background
    // layer) so the FlatList underneath can scroll its content behind the
    // app's absolutely-positioned header rather than starting after it.
    <View style={styles.container}>
      {loading ? (
        <View style={[styles.loading, { paddingTop: contentContainerTopPadding }]}>
          <ActivityIndicator size="large" color="#7ec14b" />
          <Text style={styles.loadingText}>Loading works...</Text>
        </View>
      ) : (
        <Animated.FlatList
          ref={listRef}
          data={items}
          keyExtractor={(item, index) => String(item.id) || String(index)}
          // The header-height reserve lives here, on the scrollable content
          // itself, not on the outer View — so the list's own box still
          // spans the full screen and can be scrolled/pulled up underneath
          // the header with no gap, while the first rendered card still
          // starts safely below it.
          contentContainerStyle={[
            styles.listContent,
            { paddingTop: styles.listContent.padding + (contentContainerTopPadding || 0) },
          ]}
          onScroll={onScroll}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#7ec14b"
              colors={["#7ec14b"]}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.itemWrap}>
              <AO3WorkBlurb
                kind="work"
                work={item}
                onPressWork={onWorkPress ? () => onWorkPress(item) : undefined}
                onPressAuthor={onPressAuthor}
              />
            </View>
          )}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No works found</Text>
              <Text style={styles.emptyBody}>{`${username} hasn't posted any works yet.`}</Text>
            </View>
          }
          ListFooterComponent={
            hasPagination ? (
              <View style={styles.paginationWrap}>
                <TouchableOpacity
                  style={[styles.pageArrowBtn, !pagination?.prevHref && styles.pageArrowBtnDisabled]}
                  onPress={() => goToUrl(pagination?.prevHref)}
                  disabled={!pagination?.prevHref}
                >
                  <Ionicons name="chevron-back" size={16} color={pagination?.prevHref ? "#fff" : "#555"} />
                </TouchableOpacity>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.pageNumbersRow}
                >
                  {numericPages.map((p, idx) =>
                    p.isGap ? (
                      <Text key={`gap-${idx}`} style={styles.pageGap}>
                        …
                      </Text>
                    ) : (
                      <TouchableOpacity
                        key={`${p.label}-${idx}`}
                        style={[styles.pageNumBtn, p.isCurrent && styles.pageNumBtnActive]}
                        onPress={() => !p.isCurrent && goToUrl(p.href)}
                        disabled={p.isCurrent || !p.href}
                      >
                        <Text style={[styles.pageNumText, p.isCurrent && styles.pageNumTextActive]}>
                          {p.label}
                        </Text>
                      </TouchableOpacity>
                    ),
                  )}
                </ScrollView>

                <TouchableOpacity
                  style={[styles.pageArrowBtn, !pagination?.nextHref && styles.pageArrowBtnDisabled]}
                  onPress={() => goToUrl(pagination?.nextHref)}
                  disabled={!pagination?.nextHref}
                >
                  <Ionicons name="chevron-forward" size={16} color={pagination?.nextHref ? "#fff" : "#555"} />
                </TouchableOpacity>
              </View>
            ) : undefined
          }
        />
      )}

      <HiddenWebView
        ref={webRef}
        source={sourceHtml ? { html: sourceHtml, baseUrl: currentUrl } : { uri: currentUrl }}
        injectedJavaScript={WORKS_INJECTED_JS}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
      />
    </View>
  );
};

/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    color: "#bfbfbf",
    fontSize: 14,
  },
  listContent: {
    padding: 16,
    gap: 16,
  },
  itemWrap: {
    width: "100%",
    marginBottom: 16,
  },
  emptyState: {
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },
  emptyBody: {
    color: "#9b9b9b",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  paginationWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 16,
  },
  pageArrowBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "#333",
  },
  pageArrowBtnDisabled: {
    opacity: 0.4,
  },
  pageNumbersRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 6,
  },
  pageNumBtn: {
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "#333",
  },
  pageNumBtnActive: {
    backgroundColor: "#7ec14b",
    borderColor: "#7ec14b",
  },
  pageNumText: {
    color: "#ccc",
    fontSize: 13,
    fontWeight: "600",
  },
  pageNumTextActive: {
    color: "#000",
  },
  pageGap: {
    color: "#777",
    fontSize: 13,
    paddingHorizontal: 4,
    alignSelf: "center",
  },
});

export default AO3WorksScreen;
