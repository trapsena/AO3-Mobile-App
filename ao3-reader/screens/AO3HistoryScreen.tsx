import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
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
import AO3WorkBlurb, { AO3WorkBlurbData } from "../components/AO3WorkBlurb";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type AO3HistoryTab = "history" | "to-read";

export interface AO3ReadingMeta {
  lastVisited?: string;
  visitCount?: string;
  versionNote?: string;
  markedForLater: boolean;
  readingId?: string;
  deleteUrl?: string;
  authenticityToken?: string;
}

export interface AO3ReadingItem {
  id: string;
  work: AO3WorkBlurbData;
  meta: AO3ReadingMeta;
}

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
  username: string;
  title?: string;
  showHeader?: boolean;
  onWorkPress?: (work: AO3WorkBlurbData) => void;
  // Forwarded straight to the FlatList's onScroll so a parent (e.g. the app's
  // collapsible header) can track this screen's scroll position.
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  contentContainerTopPadding?: number;
}

/* ------------------------------------------------------------------ */
/* URL helpers                                                         */
/* ------------------------------------------------------------------ */

const readingsBaseUrl = (username: string) =>
  `https://archiveofourown.org/users/${encodeURIComponent(username)}/readings`;

const buildTabUrl = (username: string, tab: AO3HistoryTab) => {
  const base = readingsBaseUrl(username);
  return tab === "to-read" ? `${base}?show=to-read` : base;
};

// Appends a timestamp so every request hits AO3's origin fresh instead of
// potentially being served a cached response for a URL we've already fetched
// (e.g. reopening History after visiting a fic elsewhere, which changes what
// AO3's server would return for the exact same readings URL).
const withCacheBust = (url: string) => {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
};

// The WebView only reloads (and only re-runs the extractor script) when the
// `source.html` string it's given actually changes. If AO3 happens to return
// byte-identical HTML to what's already loaded, a plain re-fetch would look
// like a no-op state update and silently skip the reload. Prefixing a unique
// comment guarantees the string is always different, so a resync always
// forces a real reload + re-extraction.
const tagHtmlForReload = (html: string) =>
  `<!-- ao3-history-sync:${Date.now()}:${Math.random().toString(36).slice(2)} -->\n${html}`;

// Shared by the mount/tab/page-navigation effect and the pull-to-refresh
// handler so both fetch AO3's history page the exact same (logged,
// cache-busted) way.
async function fetchHistoryHtml(url: string): Promise<string | null> {
  const bustedUrl = withCacheBust(url);
  try {
    const res = await fetchWithSession(bustedUrl);
    console.log("[AO3HistoryScreen] List fetch response", {
      url: bustedUrl,
      status: res.status,
      ok: res.ok,
      redirected: res.redirected,
      finalUrl: res.url,
    });
    if (!res.ok) {
      console.warn("[AO3HistoryScreen] List fetch was not ok", {
        status: res.status,
        statusText: res.statusText,
      });
      return null;
    }
    return await res.text();
  } catch (err: any) {
    console.warn("[AO3HistoryScreen] List fetch threw an error:", {
      name: err?.name,
      message: err?.message,
      stack: err?.stack,
    });
    return null;
  }
}

const decodeHtmlAttribute = (value?: string | null) =>
  (value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getAttr = (html: string, name: string) => {
  const match = html.match(new RegExp(`\\b${escapeRegExp(name)}=["']([^"']*)["']`, "i"));
  return match ? decodeHtmlAttribute(match[1]) : undefined;
};

const getInputValue = (formHtml: string, name: string) => {
  const inputMatch = formHtml.match(
    new RegExp(`<input\\b(?=[^>]*\\bname=["']${escapeRegExp(name)}["'])[^>]*>`, "i"),
  );
  return inputMatch ? getAttr(inputMatch[0], "value") : undefined;
};

const toAbsoluteAO3Url = (href?: string) => {
  if (!href) return undefined;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) return `https://archiveofourown.org${href}`;
  return `https://archiveofourown.org/${href}`;
};

const extractDeleteFormFromHtml = (html: string, item: AO3ReadingItem) => {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];

  for (const form of forms) {
    const className = getAttr(form, "class") ?? "";
    if (!/\bajax-remove\b/.test(className)) continue;

    const readingId = getInputValue(form, "reading");
    if (readingId !== item.meta.readingId) continue;

    return {
      deleteUrl: toAbsoluteAO3Url(getAttr(form, "action")),
      readingId,
      authenticityToken: getInputValue(form, "authenticity_token"),
    };
  }

  return null;
};

async function refreshDeleteForm(currentUrl: string, item: AO3ReadingItem) {
  const html = await fetchHistoryHtml(currentUrl);
  return html ? extractDeleteFormFromHtml(html, item) : null;
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
HiddenWebView.displayName = "AO3HistoryExtractorWebView";

const HISTORY_INJECTED_JS = `
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

  function parseReadingItem(root) {
    var titleLink = firstMatch(root, ["h4.heading a", ".header h4 a", "a[href*='/works/']"]);
    var authorLink = root.querySelector("a[rel='author']");
    var fandomLinks = collectTags(root, ["h5.fandoms a.tag", ".fandoms a.tag"]);
    var commaTags = collectCommaTags(root);
    var required = collectRequired(root);
    var stats = collectStats(root);

    var viewedHeading = firstMatch(root, ["h4.viewed.heading", ".user.module h4.viewed"]);
    var viewedText = viewedHeading ? text(viewedHeading) : "";

    var lastVisitedMatch = viewedText.match(/Last visited:\\s*([0-9]{1,2}\\s+\\S+\\s+[0-9]{4})/i);
    var visitedMatch = viewedText.match(/Visited\\s+(once|[0-9,]+\\s+times?)/i);

    var versionNote;
    var parenMatches = viewedText.match(/\\(([^()]+)\\)/g) || [];
    parenMatches.forEach(function(p) {
      var inner = p.replace(/^\\(|\\)$/g, "");
      if (/marked for later/i.test(inner)) return;
      if (!versionNote) versionNote = inner;
    });

    var markedForLater = /marked for later/i.test(viewedText);

    var form = root.querySelector("form.ajax-remove");
    var deleteUrl = form ? abs(form.getAttribute("action")) : undefined;
    var readingIdInput = form ? form.querySelector("input[name='reading']") : null;
    var tokenInput = form ? form.querySelector("input[name='authenticity_token']") : null;

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
      meta: {
        lastVisited: lastVisitedMatch ? lastVisitedMatch[1] : undefined,
        visitCount: visitedMatch ? visitedMatch[1] : undefined,
        versionNote: versionNote,
        markedForLater: markedForLater,
        readingId: readingIdInput ? readingIdInput.value : undefined,
        deleteUrl: deleteUrl,
        authenticityToken: tokenInput ? tokenInput.value : undefined,
      },
    };
  }

  function collectItems() {
    var nodes = Array.from(document.querySelectorAll("li.reading.work.blurb, li.reading.blurb"));
    if (nodes.length === 0) {
      nodes = Array.from(document.querySelectorAll("li.blurb")).filter(function(n) {
        return n.classList && n.classList.contains("reading");
      });
    }

    var seen = new Set();
    var items = [];
    nodes.forEach(function(node) {
      var id = node.id || "";
      if (!id || seen.has(id)) return;
      seen.add(id);
      items.push(parseReadingItem(node));
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
      var isGap = li.classList.contains("gap") || (!a && !isPrev && !isNext && /^(\u2026|\\.\\.\\.)$/.test(label));
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
      var listHeadingEl = document.querySelector("h3.landmark.heading, h2.heading");
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: "historyData",
        pageTitle: document.title || "",
        listHeading: listHeadingEl ? text(listHeadingEl) : "",
        items: collectItems(),
        pagination: collectPagination(),
      }));
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: "historyError",
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

const AO3HistoryScreen: React.FC<Props> = ({
  username,
  title,
  showHeader = true,
  onWorkPress,
  onScroll,
  contentContainerTopPadding = 0,
}) => {
  const webRef = useRef<any>(null);
  const lastPayloadRef = useRef<string | null>(null);
  const listRef = useRef<any>(null);

  const [tab, setTab] = useState<AO3HistoryTab>("history");
  const [currentUrl, setCurrentUrl] = useState(() => buildTabUrl(username, "history"));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageTitle, setPageTitle] = useState(title || "");
  const [items, setItems] = useState<AO3ReadingItem[]>([]);
  const [pagination, setPagination] = useState<AO3Pagination | null>(null);
  const [sourceHtml, setSourceHtml] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSourceHtml(null);

    (async () => {
      const html = await fetchHistoryHtml(currentUrl);
      if (cancelled || !html) return;
      setSourceHtml(tagHtmlForReload(html));
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUrl]);

  // Re-fetches whatever page is currently being viewed (same URL, same tab,
  // same pagination position) so the list stays in sync with AO3's actual
  // history — e.g. after reading a fic elsewhere and coming back. Existing
  // items are left on screen until the refreshed data replaces them, instead
  // of blanking out to the full-screen loading state.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const html = await fetchHistoryHtml(currentUrl);
    if (html) {
      setSourceHtml(tagHtmlForReload(html));
    } else {
      // Fetch failed outright — nothing to reload, so there's no pending
      // WebView message to clear `refreshing` for us. Stop spinning now.
      setRefreshing(false);
    }
  }, [currentUrl]);

  const resetListPosition = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const handleTabPress = useCallback(
    (nextTab: AO3HistoryTab) => {
      if (nextTab === tab) return;
      setTab(nextTab);
      setItems([]);
      setPagination(null);
      setCurrentUrl(buildTabUrl(username, nextTab));
      resetListPosition();
    },
    [tab, username, resetListPosition],
  );

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
      if (payload.type === "historyData") {
        setPageTitle(payload.listHeading || payload.pageTitle || title || "");
        setItems(Array.isArray(payload.items) ? payload.items : []);
        setPagination(payload.pagination || null);
      } else if (payload.type === "historyError") {
        console.warn("[AO3HistoryScreen] History extraction failed:", payload.error);
      }
    } catch (err) {
      console.warn("[AO3HistoryScreen] Could not parse history payload:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleDelete = useCallback((item: AO3ReadingItem) => {
    if (!item.meta.deleteUrl || !item.meta.readingId) {
      console.warn("[AO3HistoryScreen] Delete skipped — missing deleteUrl or readingId", {
        deleteUrl: item.meta.deleteUrl,
        readingId: item.meta.readingId,
      });
      return;
    }

    Alert.alert("Remove from History", `Remove "${item.work.title}" from your history?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setRemovingIds((prev) => new Set(prev).add(item.id));

          try {
            const freshForm = await refreshDeleteForm(currentUrl, item);
            const deleteUrl = freshForm?.deleteUrl ?? item.meta.deleteUrl;
            const readingId = freshForm?.readingId ?? item.meta.readingId;
            const authenticityToken = freshForm?.authenticityToken ?? item.meta.authenticityToken;

            if (!deleteUrl || !readingId || !authenticityToken) {
              console.warn("[AO3HistoryScreen] Delete skipped — missing refreshed form fields", {
                deleteUrl,
                readingId,
                hasToken: !!authenticityToken,
              });
              Alert.alert("Couldn't remove", "AO3 did not provide a fresh delete token. Reload this list and try again.");
              return;
            }

            const body = new URLSearchParams();
            body.append("_method", "delete");
            body.append("authenticity_token", authenticityToken);
            body.append("reading", readingId);
            body.append("commit", "Delete from History");

            const requestInit: RequestInit = {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                Referer: currentUrl,
              },
              body: body.toString(),
            };

            console.log("[AO3HistoryScreen] Deleting reading item — request", {
              title: item.work.title,
              deleteUrl,
              readingId,
              hadCachedToken: !!item.meta.authenticityToken,
              usedFreshToken: !!freshForm?.authenticityToken,
              body: body.toString(),
            });

            // fetchWithSession now accepts an optional init and attaches the
            // AsyncStorage-backed session cookie regardless of method, so this
            // POST is authenticated the same way the GET listing fetch is.
            const res = await fetchWithSession(deleteUrl, requestInit);

            console.log("[AO3HistoryScreen] Delete response", {
              status: res.status,
              statusText: res.statusText,
              ok: res.ok,
              redirected: res.redirected,
              finalUrl: res.url,
            });

            if (res.ok) {
              console.log("[AO3HistoryScreen] Delete succeeded, removing item locally:", item.id);
              setItems((prev) => prev.filter((entry) => entry.id !== item.id));
              return;
            }

            const bodyText = await res.text().catch((readErr) => {
              console.warn("[AO3HistoryScreen] Could not read error response body:", readErr);
              return "";
            });

            console.warn("[AO3HistoryScreen] Delete request was not ok", {
              status: res.status,
              statusText: res.statusText,
              redirected: res.redirected,
              finalUrl: res.url,
              bodyPreview: bodyText.slice(0, 500),
            });

            if (res.status === 401 || res.status === 403 || /sign in|log in/i.test(bodyText)) {
              // AO3 redirected to a login/auth page — the session cookie likely
              // isn't reaching this request.
              Alert.alert("Couldn't remove", "AO3 may have signed you out. Try reloading and signing in again.");
            } else if (res.status === 422) {
              // Usually an invalid/expired authenticity_token.
              Alert.alert("Couldn't remove", "AO3 rejected the request (expired token). Try reloading this list.");
            } else {
              Alert.alert("Couldn't remove", `AO3 didn't confirm the removal (status ${res.status}).`);
            }
          } catch (err: any) {
            console.warn("[AO3HistoryScreen] Delete request threw an error", {
              name: err?.name,
              message: err?.message,
              stack: err?.stack,
            });
            Alert.alert("Couldn't remove", "Something went wrong removing this item.");
          } finally {
            setRemovingIds((prev) => {
              const next = new Set(prev);
              next.delete(item.id);
              return next;
            });
          }
        },
      },
    ]);
  }, [currentUrl]);

  const handleClearHistory = useCallback(() => {
    Alert.alert("Clear Entire History", "This opens AO3's confirmation page in your browser.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Continue",
        onPress: () => {
          Linking.openURL(`${readingsBaseUrl(username)}/confirm_clear`).catch((err) => {
            console.warn("[AO3HistoryScreen] Could not open clear-history URL:", err);
          });
        },
      },
    ]);
  }, [username]);

  const numericPages = useMemo(
    () => (pagination?.pages || []).filter((p) => !p.isPrev && !p.isNext),
    [pagination],
  );

  const hasPagination =
    !!pagination && (!!pagination.prevHref || !!pagination.nextHref || numericPages.length > 1);

  return (
    <View style={[styles.container, contentContainerTopPadding ? { paddingTop: contentContainerTopPadding } : null]}>
      {showHeader ? (
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {pageTitle || title || "Reading History"}
          </Text>
          <TouchableOpacity onPress={handleClearHistory} style={styles.clearBtn}>
            <Ionicons name="trash-outline" size={18} color="#f66" />
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === "history" && styles.tabBtnActive]}
          onPress={() => handleTabPress("history")}
        >
          <Ionicons name="time-outline" size={16} color={tab === "history" ? "#000" : "#ddd"} />
          <Text style={[styles.tabLabel, tab === "history" && styles.tabLabelActive]}>History</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === "to-read" && styles.tabBtnActive]}
          onPress={() => handleTabPress("to-read")}
        >
          <Ionicons name="bookmark-outline" size={16} color={tab === "to-read" ? "#000" : "#ddd"} />
          <Text style={[styles.tabLabel, tab === "to-read" && styles.tabLabelActive]}>Marked for Later</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#7ec14b" />
          <Text style={styles.loadingText}>
            {tab === "history" ? "Loading history..." : "Loading marked for later..."}
          </Text>
        </View>
      ) : (
        <Animated.FlatList
          ref={listRef}
          data={items}
          keyExtractor={(item, index) => item.id || String(index)}
          contentContainerStyle={styles.listContent}
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
                work={item.work}
                onPressWork={onWorkPress ? () => onWorkPress(item.work) : undefined}
              />

              <View style={styles.metaCard}>
                <View style={styles.metaTextBlock}>
                  {item.meta.lastVisited ? (
                    <Text style={styles.metaText} numberOfLines={1}>
                      Last visited {item.meta.lastVisited}
                      {item.meta.versionNote ? `  \u00B7  ${item.meta.versionNote.replace(/\.$/, "")}` : ""}
                    </Text>
                  ) : null}
                  <View style={styles.metaBottomRow}>
                    {item.meta.visitCount ? (
                      <Text style={styles.metaSubText}>Visited {item.meta.visitCount}</Text>
                    ) : null}
                    {item.meta.markedForLater ? (
                      <View style={styles.badge}>
                        <Ionicons name="bookmark" size={10} color="#000" />
                        <Text style={styles.badgeText}>Marked for Later</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                <TouchableOpacity
                  onPress={() => handleDelete(item)}
                  disabled={removingIds.has(item.id)}
                  style={styles.deleteBtn}
                >
                  {removingIds.has(item.id) ? (
                    <ActivityIndicator size="small" color="#f66" />
                  ) : (
                    <Ionicons name="trash-outline" size={18} color="#f66" />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>
                {tab === "history" ? "No reading history yet" : "Nothing marked for later"}
              </Text>
              <Text style={styles.emptyBody}>
                {tab === "history"
                  ? "Works you read on AO3 will show up here."
                  : 'Mark a work "For Later" while reading and it\u2019ll appear on this tab.'}
              </Text>
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
                        \u2026
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
        injectedJavaScript={HISTORY_INJECTED_JS}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
    backgroundColor: "#0d0d0d",
  },
  headerTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    paddingRight: 12,
  },
  clearBtn: {
    padding: 6,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1c1c1c",
    backgroundColor: "#0a0a0a",
  },
  tabBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  tabBtnActive: {
    backgroundColor: "#7ec14b",
    borderColor: "#7ec14b",
  },
  tabLabel: {
    color: "#ddd",
    fontSize: 13,
    fontWeight: "600",
  },
  tabLabelActive: {
    color: "#000",
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
  metaCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 8,
    backgroundColor: "#161616",
    borderWidth: 1,
    borderColor: "#262626",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  metaTextBlock: {
    flex: 1,
    gap: 4,
  },
  metaText: {
    color: "#c7c7c7",
    fontSize: 12,
  },
  metaBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  metaSubText: {
    color: "#8b8b8b",
    fontSize: 12,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#7ec14b",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    color: "#000",
    fontSize: 10,
    fontWeight: "700",
  },
  deleteBtn: {
    padding: 6,
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

export default AO3HistoryScreen;
