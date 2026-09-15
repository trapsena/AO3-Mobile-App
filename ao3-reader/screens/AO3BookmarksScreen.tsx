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
import { extractCsrfToken, deleteAo3Bookmark } from "../api/ao3Bookmarks";
import AO3WorkBlurb, { AO3BookmarkData, AO3Link } from "../components/AO3WorkBlurb";
import BookmarkOwnerCard from "../components/BookmarkOwnerCard";
import type { BookmarksHeaderInfo } from "../components/Ao3Header";

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
  // Whose bookmarks page to load.
  username: string;
  // The currently logged-in user (from the session), used only to decide
  // whether to show the Edit/Delete/Add to Collection/Share actions — those
  // only make sense (and only actually exist server-side) when this matches
  // `username`.
  currentUsername?: string | null;
  title?: string;
  // Called when the person taps the back button.
  onClose?: () => void;
  onWorkPress?: (bookmark: AO3BookmarkData) => void;
  // Called when a bookmark card's (work) author byline is tapped, so the
  // caller can open that author's profile in-app instead of the external
  // browser. Distinct from BookmarkOwnerCard's "Bookmarked by X" byline,
  // which navigates to that person's bookmarks page instead.
  onPressAuthor?: (author: AO3Link) => void;
  // Forwarded straight to the FlatList's onScroll so a parent (e.g. the
  // app's collapsible header) can track this screen's scroll position.
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  // Space reserved for the app's header overlay (and this screen's own back
  // button), the same value doing double duty as both the FlatList content's
  // top padding and the back button's vertical offset.
  topInset?: number;
  // Published whenever this screen's title changes (and cleared with `null`
  // on unmount) so the app's global Ao3Header can render it instead of this
  // component drawing its own title bar.
  onHeaderActionsChange?: (info: BookmarksHeaderInfo | null) => void;
}

/* ------------------------------------------------------------------ */
/* URL helpers                                                         */
/* ------------------------------------------------------------------ */

const bookmarksBaseUrl = (username: string) =>
  `https://archiveofourown.org/users/${encodeURIComponent(username)}/bookmarks`;

// Appends a timestamp so every request hits AO3's origin fresh instead of
// potentially being served a cached response for a URL we've already
// fetched (mirrors AO3HistoryScreen's same cache-busting need).
const withCacheBust = (url: string) => {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
};

// The WebView only reloads (and only re-runs the extractor script) when the
// `source.html` string it's given actually changes — prefixing a unique
// comment guarantees a resync always forces a real reload + re-extraction.
const tagHtmlForReload = (html: string) =>
  `<!-- ao3-bookmarks-sync:${Date.now()}:${Math.random().toString(36).slice(2)} -->\n${html}`;

async function fetchBookmarksHtml(url: string): Promise<string | null> {
  const bustedUrl = withCacheBust(url);
  try {
    const res = await fetchWithSession(bustedUrl);
    console.log("[AO3BookmarksScreen] List fetch response", {
      url: bustedUrl,
      status: res.status,
      ok: res.ok,
      redirected: res.redirected,
      finalUrl: res.url,
    });
    if (!res.ok) {
      console.warn("[AO3BookmarksScreen] List fetch was not ok", {
        status: res.status,
        statusText: res.statusText,
      });
      return null;
    }
    return await res.text();
  } catch (err: any) {
    console.warn("[AO3BookmarksScreen] List fetch threw an error:", {
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
HiddenWebView.displayName = "AO3BookmarksExtractorWebView";

const BOOKMARKS_INJECTED_JS = `
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

  function parseOwnActions(ownModule) {
    if (!ownModule) return undefined;
    var actionsList = ownModule.querySelector("ul.actions");
    if (!actionsList) return undefined;

    var links = Array.from(actionsList.querySelectorAll("a"));
    function findByText(re) {
      return links.find(function(a) { return re.test(text(a)); });
    }

    var editA = findByText(/edit/i);
    var deleteA = findByText(/delete/i);
    var collectionA = findByText(/add to collection/i);
    var shareA = findByText(/share/i);

    if (!editA && !deleteA && !collectionA && !shareA) return undefined;

    return {
      editHref: editA ? abs(editA.getAttribute("href")) : undefined,
      deleteHref: deleteA ? abs(deleteA.getAttribute("href")) : undefined,
      addToCollectionHref: collectionA ? abs(collectionA.getAttribute("href")) : undefined,
      shareHref: shareA ? abs(shareA.getAttribute("href")) : undefined,
    };
  }

  function parseBookmarkItem(root) {
    var titleLink = firstMatch(root, ["h4.heading a", ".header h4 a", "a[href*='/works/']", "a[href*='/series/']"]);
    var workAuthor = root.querySelector("a[rel='author']");

    // The bookmarker's own info (byline, date bookmarked, their tags, their
    // notes, and — when this is the logged-in user's own bookmark — the
    // Edit/Delete/etc actions) all live inside this block, separate from
    // the work's own info above it.
    var ownModule = firstMatch(root, [".own.user.module.group", ".user.module.group"]);
    var isOwnModule = !!(ownModule && ownModule.classList && ownModule.classList.contains("own"));

    var bookmarkerLink = (ownModule && ownModule.querySelector("h5.byline a")) || firstMatch(root, [
      "h5.byline.heading a",
      ".user a",
      ".user .meta a",
      "a[href*='/users/']",
    ]);
    var bookmarker = bookmarkerLink
      ? { label: text(bookmarkerLink), href: abs(bookmarkerLink.getAttribute("href")) || undefined }
      : undefined;

    var statusSlot = firstMatch(root, ["p.status", ".status"]);
    var statusIconNode = statusSlot && statusSlot.querySelector("a > span[class]:not(.text), a span[class]:not(.text), span[class]:not(.text)");
    var statusLinkNode = statusSlot && statusSlot.querySelector("a");
    var countNode = firstMatch(root, ["p.status .count a", ".status .count a", ".count a", ".status .count"]);

    var datetimeNode = (ownModule && ownModule.querySelector("p.datetime")) || firstMatch(root, [".datetime", "p.datetime"]);

    var userMetaContainer = ownModule
      ? ownModule.querySelector("ul.meta.tags.commas")
      : firstMatch(root, ["ul.meta.tags.commas"]);
    var userMeta = userMetaContainer
      ? Array.from(userMetaContainer.querySelectorAll("a.tag")).map(function(a) {
          return { label: text(a), href: abs(a.getAttribute("href")) || undefined };
        }).filter(function(item) { return item.label; })
      : [];

    var notesEl = (ownModule && ownModule.querySelector("blockquote.userstuff.notes")) || firstMatch(root, ["blockquote.userstuff.notes"]);
    var notes = null;
    if (notesEl) {
      var notePs = Array.from(notesEl.querySelectorAll("p")).map(function(p) { return text(p); }).filter(Boolean);
      notes = notePs.length ? notePs.join("\\n\\n") : text(notesEl);
    }

    var fandomLinks = collectTags(root, ["h5.fandoms a.tag", ".fandoms a.tag"]);
    var commaTags = collectCommaTags(root);
    var required = collectRequired(root);
    var stats = collectStats(root);
    var className = statusIconNode ? statusIconNode.className : (statusSlot ? statusSlot.className : "");
    var fullClassName = className || "";
    var spriteClassName = (fullClassName && fullClassName.split(/\\s+/).filter(Boolean).find(function(cls) {
      return /^(public|private|hidden|rec)/.test(cls);
    })) || "public";

    var ownActions = parseOwnActions(ownModule);

    return {
        id: root.id || "",
        isOwnModule: isOwnModule,
        ownActions: ownActions,
        title: titleLink ? text(titleLink) : text(root),
        workUrl: titleLink ? abs(titleLink.getAttribute("href")) || undefined : undefined,
        workAuthor: workAuthor ? { label: text(workAuthor), href: abs(workAuthor.getAttribute("href")) || undefined } : undefined,
        bookmarker: bookmarker,
        status: statusSlot ? { label: text(statusSlot), href: abs((statusLinkNode && statusLinkNode.getAttribute("href")) || statusSlot.getAttribute("href")) || undefined } : undefined,
        bookmarkStatusIcon: statusSlot ? {
          className: fullClassName || spriteClassName,
          spriteClassName: spriteClassName,
          title: statusIconNode ? text(statusIconNode) : text(statusSlot),
          href: abs((statusLinkNode && statusLinkNode.getAttribute("href")) || statusSlot.getAttribute("href")) || undefined,
        } : undefined,
        requiredTags: required,
        requiredTagIcons: required.icons,
        count: countNode ? text(countNode) : undefined,
        datetime: datetimeNode ? text(datetimeNode) : undefined,
        userMeta: userMeta.length ? userMeta : undefined,
        summary: notes || undefined,
        fandoms: fandomLinks.length ? fandomLinks : undefined,
        tags: {
          warnings: commaTags.warnings.length ? commaTags.warnings.map(function(tag) { return tag.label; }) : undefined,
          relationships: commaTags.relationships.length ? commaTags.relationships.map(function(tag) { return tag.label; }) : undefined,
          characters: commaTags.characters.length ? commaTags.characters.map(function(tag) { return tag.label; }) : undefined,
          freeforms: commaTags.freeforms.length ? commaTags.freeforms.map(function(tag) { return tag.label; }) : undefined,
        },
        stats: {
          language: stats.language,
          words: stats.words,
          chapters: stats.chapters,
          kudos: stats.kudos,
          hits: stats.hits,
          comments: stats.comments,
          bookmarks: stats.bookmarks,
        },
    };
  }

  function collectBookmarks() {
    var nodes = Array.from(document.querySelectorAll("li.bookmark.blurb"));
    var seen = new Set();
    var items = [];
    nodes.forEach(function(node) {
      var id = node.id || "";
      if (!id || seen.has(id)) return;
      seen.add(id);
      items.push(parseBookmarkItem(node));
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
      var csrfMeta = document.querySelector('meta[name="csrf-token"]');
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: "bookmarksData",
        pageTitle: document.title || "",
        listHeading: headingEl ? text(headingEl) : "",
        items: collectBookmarks(),
        pagination: collectPagination(),
        csrfToken: csrfMeta ? csrfMeta.getAttribute("content") : null,
      }));
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: "bookmarksError",
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

const AO3BookmarksScreen: React.FC<Props> = ({
  username,
  currentUsername,
  title,
  onClose,
  onWorkPress,
  onPressAuthor,
  onScroll,
  topInset = 0,
  onHeaderActionsChange,
}) => {
  const webRef = useRef<any>(null);
  const lastPayloadRef = useRef<string | null>(null);
  const listRef = useRef<any>(null);

  const [currentUrl, setCurrentUrl] = useState(() => bookmarksBaseUrl(username));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageTitle, setPageTitle] = useState(title || "");
  const [items, setItems] = useState<AO3BookmarkData[]>([]);
  const [pagination, setPagination] = useState<AO3Pagination | null>(null);
  const [sourceHtml, setSourceHtml] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  const isOwnUser =
    !!currentUsername && currentUsername.trim().toLowerCase() === username.trim().toLowerCase();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSourceHtml(null);

    (async () => {
      const html = await fetchBookmarksHtml(currentUrl);
      if (cancelled || !html) return;
      setSourceHtml(tagHtmlForReload(html));
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUrl]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const html = await fetchBookmarksHtml(currentUrl);
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
      if (payload.type === "bookmarksData") {
        setPageTitle(payload.listHeading || payload.pageTitle || title || "");
        setItems(Array.isArray(payload.items) ? payload.items : []);
        setPagination(payload.pagination || null);
        if (payload.csrfToken) setCsrfToken(payload.csrfToken);
      } else if (payload.type === "bookmarksError") {
        console.warn("[AO3BookmarksScreen] Bookmarks extraction failed:", payload.error);
      }
    } catch (err) {
      console.warn("[AO3BookmarksScreen] Could not parse bookmarks payload:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleEdit = useCallback((href: string) => {
    Linking.openURL(href).catch((err) => {
      console.warn("[AO3BookmarksScreen] Could not open edit URL:", err);
    });
  }, []);

  const handleAddToCollection = useCallback((href: string) => {
    Linking.openURL(href).catch((err) => {
      console.warn("[AO3BookmarksScreen] Could not open add-to-collection URL:", err);
    });
  }, []);

  const handleShare = useCallback((href: string) => {
    Linking.openURL(href).catch((err) => {
      console.warn("[AO3BookmarksScreen] Could not open share URL:", err);
    });
  }, []);

  const handleDelete = useCallback(
    (bookmark: AO3BookmarkData) => {
      const deleteHref = bookmark.ownActions?.deleteHref;
      const id = String(bookmark.id);
      if (!deleteHref) {
        console.warn("[AO3BookmarksScreen] Delete skipped — missing deleteHref", { id });
        return;
      }

      Alert.alert("Remove Bookmark", `Remove "${bookmark.title}" from your bookmarks?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setRemovingIds((prev) => new Set(prev).add(id));

            try {
              let token = csrfToken;
              if (!token) {
                const freshHtml = await fetchBookmarksHtml(currentUrl);
                token = freshHtml ? extractCsrfToken(freshHtml) ?? null : null;
              }

              if (!token) {
                console.warn("[AO3BookmarksScreen] Delete skipped — no CSRF token available");
                Alert.alert("Couldn't remove", "AO3 did not provide a fresh delete token. Reload this list and try again.");
                return;
              }

              const result = await deleteAo3Bookmark(deleteHref, token, currentUrl);

              if (result.ok) {
                setItems((prev) => prev.filter((entry) => String(entry.id) !== id));
                return;
              }

              if (result.reason === "auth") {
                Alert.alert("Couldn't remove", "AO3 may have signed you out. Try reloading and signing in again.");
              } else if (result.reason === "token") {
                Alert.alert("Couldn't remove", "AO3 rejected the request (expired token). Try reloading this list.");
              } else {
                Alert.alert(
                  "Couldn't remove",
                  result.status ? `AO3 didn't confirm the removal (status ${result.status}).` : "Something went wrong removing this bookmark.",
                );
              }
            } finally {
              setRemovingIds((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
            }
          },
        },
      ]);
    },
    [csrfToken, currentUrl],
  );

  useEffect(() => {
    onHeaderActionsChange?.({
      title: pageTitle || title || `${username}'s Bookmarks`,
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
        <View style={[styles.loading, { paddingTop: topInset }]}>
          <ActivityIndicator size="large" color="#7ec14b" />
          <Text style={styles.loadingText}>Loading bookmarks...</Text>
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
            { paddingTop: styles.listContent.padding + (topInset || 0) },
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
                kind="bookmark"
                bookmark={item}
                onPressWork={onWorkPress ? () => onWorkPress(item) : undefined}
                onPressAuthor={onPressAuthor}
              />
              <BookmarkOwnerCard
                bookmark={item}
                isOwnUser={isOwnUser}
                removing={removingIds.has(String(item.id))}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onAddToCollection={handleAddToCollection}
                onShare={handleShare}
              />
            </View>
          )}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No bookmarks found</Text>
              <Text style={styles.emptyBody}>
                {isOwnUser
                  ? "Bookmark a work on AO3 and it'll show up here."
                  : `${username} hasn't made any public bookmarks yet.`}
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
        injectedJavaScript={BOOKMARKS_INJECTED_JS}
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

export default AO3BookmarksScreen;
