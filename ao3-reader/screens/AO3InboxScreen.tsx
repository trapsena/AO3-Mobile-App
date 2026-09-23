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
import type {
  AO3InboxComment,
  AO3InboxFilterGroup,
  AO3InboxMassAction,
  AO3InboxMassEditForm,
} from "../api/ao3InboxTypes";
import AO3InboxFilterPanel from "../components/AO3InboxFilterPanel";
import InboxCommentCard from "../components/InboxCommentCard";
import type { AO3Link } from "../components/AO3WorkBlurb";
import type { InboxHeaderInfo } from "../components/Ao3Header";

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
  // The logged-in user — an inbox only ever exists for your own account.
  username: string;
  // Called when the header's back button is tapped.
  onClose?: () => void;
  // Called with a work URL when a comment's target title is tapped.
  onOpenWork?: (workUrl: string) => void;
  // Called when a commenter's name is tapped, so the caller can open that
  // person's profile in-app.
  onPressAuthor?: (author: AO3Link) => void;
  // Forwarded straight to the FlatList's onScroll so a parent (e.g. the
  // app's collapsible header) can track this screen's scroll position.
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  contentContainerTopPadding?: number;
  // Published so the app's global Ao3Header can render this screen's title,
  // back button and filter toggle instead of this component drawing its own.
  onHeaderActionsChange?: (info: InboxHeaderInfo | null) => void;
}

const DEFAULT_SUBMIT_VALUES: Record<AO3InboxMassAction, string> = {
  read: "Mark Read",
  unread: "Mark Unread",
  delete: "Delete From Inbox",
};

/* ------------------------------------------------------------------ */
/* URL helpers                                                         */
/* ------------------------------------------------------------------ */

const inboxBaseUrl = (username: string) =>
  `https://archiveofourown.org/users/${encodeURIComponent(username)}/inbox`;

// Appends a timestamp so every request hits AO3's origin fresh instead of
// potentially being served a cached response for a URL we've already fetched.
const withCacheBust = (url: string) => {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}_=${Date.now()}`;
};

// The WebView only reloads (and only re-runs the extractor script) when the
// `source.html` string it's given actually changes — prefixing a unique
// comment guarantees a resync always forces a real reload + re-extraction.
const tagHtmlForReload = (html: string) =>
  `<!-- ao3-inbox-sync:${Date.now()}:${Math.random().toString(36).slice(2)} -->\n${html}`;

async function fetchInboxHtml(url: string): Promise<string | null> {
  const bustedUrl = withCacheBust(url);
  try {
    const res = await fetchWithSession(bustedUrl);
    console.log("[AO3InboxScreen] List fetch response", {
      url: bustedUrl,
      status: res.status,
      ok: res.ok,
      redirected: res.redirected,
      finalUrl: res.url,
    });
    if (!res.ok) {
      console.warn("[AO3InboxScreen] List fetch was not ok", {
        status: res.status,
        statusText: res.statusText,
      });
      return null;
    }
    return await res.text();
  } catch (err: any) {
    console.warn("[AO3InboxScreen] List fetch threw an error:", {
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
HiddenWebView.displayName = "AO3InboxExtractorWebView";

const INBOX_INJECTED_JS = `
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

  // A comment's body is a blockquote of <p>s (sometimes nested blockquotes
  // and <br>s) — keep paragraph and line breaks instead of flattening it all
  // into one run of text.
  function bodyText(el) {
    if (!el) return "";
    var clone = el.cloneNode(true);
    Array.from(clone.querySelectorAll("br")).forEach(function(br) { br.replaceWith("\\n"); });
    function tidy(s) {
      return String(s || "").replace(/[ \\t\\r\\f\\v]+/g, " ").replace(/ ?\\n ?/g, "\\n").trim();
    }
    var blocks = Array.from(clone.querySelectorAll("p")).map(function(p) { return tidy(p.textContent); }).filter(Boolean);
    return blocks.length ? blocks.join("\\n\\n") : tidy(clone.textContent);
  }

  function parseComment(li) {
    var byline = li.querySelector("h4.byline");
    var bylineLinks = byline ? Array.from(byline.querySelectorAll("a")) : [];
    var authorA = bylineLinks[0];
    var targetA = bylineLinks[1];
    var iconImg = li.querySelector("div.icon img");
    var checkbox = li.querySelector("input[name='inbox_comments[]']");
    var targetHref = targetA ? abs(targetA.getAttribute("href")) : null;
    var workMatch = targetHref ? targetHref.match(/\\/works\\/(\\d+)/) : null;
    return {
      id: (li.id || "").replace(/^feedback_comment_/, ""),
      inboxId: checkbox ? checkbox.value : "",
      isRead: li.classList.contains("read"),
      isReplied: !!li.querySelector("span.replied"),
      author: authorA ? { label: text(authorA), href: abs(authorA.getAttribute("href")) || undefined } : undefined,
      targetLabel: targetA ? text(targetA) : undefined,
      targetHref: targetHref || undefined,
      workUrl: workMatch ? "https://archiveofourown.org/works/" + workMatch[1] : undefined,
      datetime: text(li.querySelector(".posted.datetime")) || undefined,
      avatarUrl: iconImg ? abs(iconImg.getAttribute("src")) || undefined : undefined,
      body: bodyText(li.querySelector("blockquote.userstuff")),
    };
  }

  function collectItems() {
    var nodes = Array.from(document.querySelectorAll("li.comment[id^='feedback_comment_']"));
    var seen = new Set();
    var items = [];
    nodes.forEach(function(node) {
      var id = node.id || "";
      if (!id || seen.has(id)) return;
      seen.add(id);
      items.push(parseComment(node));
    });
    return items;
  }

  // The inbox's own filter sidebar (#inbox-filters): each <dt> heading is
  // followed by a <dd> holding one radio group.
  function collectFilterGroups() {
    var form = document.querySelector("#inbox-filters");
    if (!form) return [];
    var groups = [];
    Array.from(form.querySelectorAll("dl > dt")).forEach(function(dt) {
      if (dt.classList.contains("landmark")) return;
      var dd = dt.nextElementSibling;
      if (!dd || dd.tagName.toLowerCase() !== "dd") return;
      var name = "";
      var options = [];
      Array.from(dd.querySelectorAll("input[type='radio']")).forEach(function(input) {
        name = name || input.name;
        options.push({
          value: input.value,
          label: text(input.closest("label")),
          checked: !!input.checked,
        });
      });
      if (name && options.length) groups.push({ name: name, title: text(dt), options: options });
    });
    return groups;
  }

  // The mass-edit form (Mark Read / Mark Unread / Delete From Inbox) — its
  // action URL and hidden _method/authenticity_token fields are captured so
  // the app can replay exactly what AO3's own form would submit.
  function collectMassEdit() {
    var form = document.querySelector("#inbox-form");
    if (!form) return null;
    var fields = {};
    Array.from(form.querySelectorAll("input[type='hidden'][name]")).forEach(function(input) {
      fields[input.name] = input.value;
    });
    var submitValues = {};
    ["read", "unread", "delete"].forEach(function(name) {
      var button = form.querySelector("input[type='submit'][name='" + name + "']");
      if (button) submitValues[name] = button.value;
    });
    return { actionUrl: abs(form.getAttribute("action")), fields: fields, submitValues: submitValues };
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
      // The inbox marks the current page as <li><span class="current">1</span></li>
      // rather than an <a class="current">.
      var isCurrent = li.classList.contains("current")
        || (a && a.classList.contains("current"))
        || (a && a.getAttribute("aria-current") === "page")
        || !!(span && span.classList.contains("current"));
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
        type: "inboxData",
        pageTitle: document.title || "",
        heading: headingEl ? text(headingEl) : "",
        items: collectItems(),
        pagination: collectPagination(),
        filterGroups: collectFilterGroups(),
        massEdit: collectMassEdit(),
      }));
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: "inboxError",
        error: String(err && err.message ? err.message : err),
      }));
    }
  }, 350);
})();
true;
`;

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                         */
/* ------------------------------------------------------------------ */

const BulkButton: React.FC<{
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}> = ({ label, icon, danger, disabled, onPress }) => (
  <TouchableOpacity
    style={[styles.bulkBtn, danger && styles.bulkBtnDanger, disabled && styles.bulkBtnDisabled]}
    onPress={onPress}
    disabled={disabled}
  >
    {icon ? <Ionicons name={icon} size={14} color={danger ? "#f66" : "#ddd"} /> : null}
    <Text style={[styles.bulkBtnText, danger && styles.bulkBtnTextDanger]}>{label}</Text>
  </TouchableOpacity>
);

/* ------------------------------------------------------------------ */
/* Screen                                                               */
/* ------------------------------------------------------------------ */

const AO3InboxScreen: React.FC<Props> = ({
  username,
  onClose,
  onOpenWork,
  onPressAuthor,
  onScroll,
  contentContainerTopPadding = 0,
  onHeaderActionsChange,
}) => {
  const webRef = useRef<any>(null);
  const lastPayloadRef = useRef<string | null>(null);
  const listRef = useRef<any>(null);
  const massEditRef = useRef<AO3InboxMassEditForm | null>(null);

  const [currentUrl, setCurrentUrl] = useState(() => inboxBaseUrl(username));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [heading, setHeading] = useState("");
  const [items, setItems] = useState<AO3InboxComment[]>([]);
  const [pagination, setPagination] = useState<AO3Pagination | null>(null);
  const [sourceHtml, setSourceHtml] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [filterGroups, setFilterGroups] = useState<AO3InboxFilterGroup[]>([]);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [filterPanelVisible, setFilterPanelVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSourceHtml(null);

    (async () => {
      const html = await fetchInboxHtml(currentUrl);
      if (cancelled || !html) return;
      setSourceHtml(tagHtmlForReload(html));
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUrl]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const html = await fetchInboxHtml(currentUrl);
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
      // Same URL wouldn't re-run the fetch effect above, so the list would
      // just stay blank after being cleared — reload it in place instead.
      if (url === currentUrl) {
        handleRefresh();
        return;
      }
      setItems([]);
      setPagination(null);
      setCurrentUrl(url);
      resetListPosition();
    },
    [currentUrl, handleRefresh, resetListPosition],
  );

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      if (e.nativeEvent.data === lastPayloadRef.current) return;
      lastPayloadRef.current = e.nativeEvent.data;

      const payload = JSON.parse(e.nativeEvent.data);
      if (payload.type === "inboxData") {
        setHeading(payload.heading || "");
        setItems(Array.isArray(payload.items) ? payload.items : []);
        setPagination(payload.pagination || null);
        setFilterGroups(Array.isArray(payload.filterGroups) ? payload.filterGroups : []);
        massEditRef.current = payload.massEdit || null;
        // Selection belongs to the page that was on screen when it was made.
        setSelectedIds(new Set());
      } else if (payload.type === "inboxError") {
        console.warn("[AO3InboxScreen] Inbox extraction failed:", payload.error);
      }
    } catch (err) {
      console.warn("[AO3InboxScreen] Could not parse inbox payload:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  /* ---------------------------- selection ---------------------------- */

  const toggleSelect = useCallback((inboxId: string) => {
    if (!inboxId) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(inboxId)) next.delete(inboxId);
      else next.add(inboxId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map((item) => item.inboxId).filter(Boolean)));
  }, [items]);

  const selectNone = useCallback(() => setSelectedIds(new Set()), []);

  /* ------------------------- mass actions --------------------------- */

  // Replays AO3's own mass-edit form (see collectMassEdit): a POST with the
  // form's hidden _method/authenticity_token, every selected inbox_comments[]
  // id, and the pressed submit button's name/value.
  const runMassAction = useCallback(
    async (action: AO3InboxMassAction) => {
      const form = massEditRef.current;
      const ids = Array.from(selectedIds);
      if (!ids.length) return;
      if (!form?.actionUrl) {
        Alert.alert("Couldn't update inbox", "AO3 didn't provide the inbox form. Pull to refresh and try again.");
        return;
      }

      setBusy(true);
      try {
        const body = new URLSearchParams();
        Object.entries(form.fields).forEach(([key, value]) => body.append(key, value));
        ids.forEach((id) => body.append("inbox_comments[]", id));
        body.append(action, form.submitValues[action] ?? DEFAULT_SUBMIT_VALUES[action]);

        const res = await fetchWithSession(form.actionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Referer: currentUrl,
          },
          body: body.toString(),
        });

        if (res.ok) {
          setSelectedIds(new Set());
          await handleRefresh();
        } else if (res.status === 401 || res.status === 403) {
          Alert.alert("Couldn't update inbox", "AO3 may have signed you out. Try reloading and signing in again.");
        } else if (res.status === 422) {
          Alert.alert("Couldn't update inbox", "AO3 rejected the request (expired token). Pull to refresh and try again.");
        } else {
          Alert.alert("Couldn't update inbox", `AO3 didn't confirm the change (status ${res.status}).`);
        }
      } catch (err) {
        console.warn("[AO3InboxScreen] Mass action failed:", err);
        Alert.alert("Couldn't update inbox", "Something went wrong. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [selectedIds, currentUrl, handleRefresh],
  );

  const handleMarkRead = useCallback(() => runMassAction("read"), [runMassAction]);
  const handleMarkUnread = useCallback(() => runMassAction("unread"), [runMassAction]);
  const handleDelete = useCallback(() => {
    const count = selectedIds.size;
    if (!count) return;
    Alert.alert(
      "Delete From Inbox",
      `Remove ${count} comment${count === 1 ? "" : "s"} from your inbox? The comments themselves stay on the work.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => runMassAction("delete") },
      ],
    );
  }, [selectedIds, runMassAction]);

  const handleReply = useCallback((comment: AO3InboxComment) => {
    if (!comment.targetHref) return;
    Linking.openURL(comment.targetHref).catch((err) => {
      console.warn("[AO3InboxScreen] Could not open comment thread:", err);
    });
  }, []);

  /* ------------------------------ filters ---------------------------- */

  const handleSelectFilter = useCallback((name: string, value: string) => {
    setFilterValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  // AO3's own filter form is a plain GET back to the inbox URL.
  const handleApplyFilters = useCallback(() => {
    const params: string[] = [];
    filterGroups.forEach((group) => {
      const value = filterValues[group.name] ?? group.options.find((option) => option.checked)?.value;
      if (value !== undefined) params.push(`${encodeURIComponent(group.name)}=${encodeURIComponent(value)}`);
    });
    params.push("commit=Filter");
    goToUrl(`${inboxBaseUrl(username)}?${params.join("&")}`);
  }, [filterGroups, filterValues, username, goToUrl]);

  const handleClearFilters = useCallback(() => {
    setFilterValues({});
    goToUrl(inboxBaseUrl(username));
  }, [username, goToUrl]);

  const handleCloseFilters = useCallback(() => setFilterPanelVisible(false), []);
  const handleToggleFilters = useCallback(() => setFilterPanelVisible((prev) => !prev), []);

  /* --------------------------- header info --------------------------- */

  useEffect(() => {
    onHeaderActionsChange?.({
      title: "Inbox",
      onGoBack: () => onClose?.(),
      onToggleFilters: handleToggleFilters,
    });
  }, [onClose, onHeaderActionsChange, handleToggleFilters]);

  // Separate from the effect above so the "clear on unmount" cleanup doesn't
  // also fire (and briefly flicker the header) whenever a dependency above
  // changes — this one's dependency array never changes, so its cleanup only
  // runs once, when the screen actually unmounts.
  useEffect(() => {
    return () => onHeaderActionsChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------ stable list props ------------------------ */

  // Opening/closing the filter panel or toggling a selection re-renders this
  // whole screen; keeping FlatList's props referentially stable (only
  // changing when what they depend on changes) stops it from re-rendering
  // every row for unrelated state changes.
  const numericPages = useMemo(
    () => (pagination?.pages || []).filter((p) => !p.isPrev && !p.isNext),
    [pagination],
  );

  const hasPagination =
    !!pagination && (!!pagination.prevHref || !!pagination.nextHref || numericPages.length > 1);

  const keyExtractor = useCallback(
    (item: AO3InboxComment, index: number) => item.id || item.inboxId || String(index),
    [],
  );

  const contentContainerStyle = useMemo(
    () => [styles.listContent, { paddingTop: styles.listContent.padding + (contentContainerTopPadding || 0) }],
    [contentContainerTopPadding],
  );

  const renderItem = useCallback(
    ({ item }: { item: AO3InboxComment }) => (
      <View style={styles.itemWrap}>
        <InboxCommentCard
          comment={item}
          selected={selectedIds.has(item.inboxId)}
          onToggleSelect={toggleSelect}
          onPressAuthor={onPressAuthor}
          onOpenWork={onOpenWork}
          onReply={handleReply}
        />
      </View>
    ),
    [selectedIds, toggleSelect, onPressAuthor, onOpenWork, handleReply],
  );

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={handleRefresh}
        tintColor="#7ec14b"
        colors={["#7ec14b"]}
      />
    ),
    [refreshing, handleRefresh],
  );

  const selectedCount = selectedIds.size;
  const noneSelected = selectedCount === 0;

  const listHeader = useMemo(
    () => (
      <View style={styles.listHeader}>
        {heading ? <Text style={styles.heading}>{heading}</Text> : null}
        {items.length > 0 ? (
          <View style={styles.bulkBar}>
            <View style={styles.bulkRow}>
              <BulkButton label="Select All" onPress={selectAll} />
              <BulkButton label="Select None" onPress={selectNone} />
              {selectedCount > 0 ? <Text style={styles.selectedCount}>{selectedCount} selected</Text> : null}
            </View>
            <View style={styles.bulkRow}>
              <BulkButton
                label="Mark Read"
                icon="mail-open-outline"
                disabled={noneSelected || busy}
                onPress={handleMarkRead}
              />
              <BulkButton
                label="Mark Unread"
                icon="mail-unread-outline"
                disabled={noneSelected || busy}
                onPress={handleMarkUnread}
              />
              <BulkButton
                label="Delete"
                icon="trash-outline"
                danger
                disabled={noneSelected || busy}
                onPress={handleDelete}
              />
              {busy ? <ActivityIndicator size="small" color="#7ec14b" /> : null}
            </View>
          </View>
        ) : null}
      </View>
    ),
    [
      heading,
      items.length,
      selectedCount,
      noneSelected,
      busy,
      selectAll,
      selectNone,
      handleMarkRead,
      handleMarkUnread,
      handleDelete,
    ],
  );

  const listEmptyComponent = useMemo(
    () => (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No comments found</Text>
        <Text style={styles.emptyBody}>
          Your inbox is empty, or nothing in it matches the current filter.
        </Text>
      </View>
    ),
    [],
  );

  const listFooter = useMemo(
    () =>
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
                  <Text style={[styles.pageNumText, p.isCurrent && styles.pageNumTextActive]}>{p.label}</Text>
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
      ) : null,
    [hasPagination, pagination, numericPages, goToUrl],
  );

  return (
    // No paddingTop here: this box must stay full-screen (a background
    // layer) so the FlatList underneath can scroll its content behind the
    // app's absolutely-positioned header rather than starting after it.
    <View style={styles.container}>
      {loading ? (
        <View style={[styles.loading, { paddingTop: contentContainerTopPadding }]}>
          <ActivityIndicator size="large" color="#7ec14b" />
          <Text style={styles.loadingText}>Loading inbox...</Text>
        </View>
      ) : (
        <Animated.FlatList
          ref={listRef}
          data={items}
          extraData={selectedIds}
          keyExtractor={keyExtractor}
          // The header-height reserve lives here, on the scrollable content
          // itself, not on the outer View — so the list's own box still
          // spans the full screen and can be scrolled/pulled up underneath
          // the header with no gap, while the first rendered card still
          // starts safely below it.
          contentContainerStyle={contentContainerStyle}
          onScroll={onScroll}
          scrollEventThrottle={16}
          refreshControl={refreshControl}
          renderItem={renderItem}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={7}
          removeClippedSubviews
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmptyComponent}
          ListFooterComponent={listFooter}
        />
      )}

      <HiddenWebView
        ref={webRef}
        source={sourceHtml ? { html: sourceHtml, baseUrl: currentUrl } : { uri: currentUrl }}
        injectedJavaScript={INBOX_INJECTED_JS}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
      />

      <AO3InboxFilterPanel
        visible={filterPanelVisible}
        onClose={handleCloseFilters}
        groups={filterGroups}
        values={filterValues}
        onSelect={handleSelectFilter}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
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
  listHeader: {
    gap: 12,
    marginBottom: 16,
  },
  heading: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  bulkBar: {
    gap: 8,
  },
  bulkRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  bulkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#1c1c1c",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  bulkBtnDanger: {
    borderColor: "rgba(198, 67, 82, 0.35)",
  },
  bulkBtnDisabled: {
    opacity: 0.4,
  },
  bulkBtnText: {
    color: "#ddd",
    fontSize: 12,
    fontWeight: "600",
  },
  bulkBtnTextDanger: {
    color: "#f66",
  },
  selectedCount: {
    color: "#7ec14b",
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 4,
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

export default AO3InboxScreen;
