import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  SafeAreaView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { fetchWithSession } from "../api/ao3Auth";
import AO3WorkBlurb, {
  AO3BookmarkData,
  AO3BlurbKind,
  AO3WorkBlurbData,
  renderCommaLinkList,
} from "../components/AO3WorkBlurb";

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
HiddenWebView.displayName = "AO3ListingExtractorWebView";

export interface AO3ListingItem {
  id: string;
  kind: AO3BlurbKind;
  work?: AO3WorkBlurbData;
  bookmark?: AO3BookmarkData;
}

export interface AO3ListingGroup {
  key: string;
  title: string;
  items: AO3ListingItem[];
}

interface Props {
  url: string;
  title?: string;
  showHeader?: boolean;
  onGroupsLoaded?: (groups: AO3ListingGroup[]) => void;
  onItemPress?: (item: AO3ListingItem) => void;
}

const LISTING_INJECTED_JS = `
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
      var classes = String(className).split(/\s+/).filter(Boolean);
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

  function findGroupTitle(el) {
    var current = el;
    while (current) {
      var sibling = current.previousElementSibling;
      while (sibling) {
        var heading = sibling.matches && sibling.matches("h1,h2,h3,h4,h5,h6") ? sibling : sibling.querySelector && sibling.querySelector("h1,h2,h3,h4,h5,h6");
        if (heading) {
          var headingText = text(heading);
          if (headingText) return headingText;
        }
        sibling = sibling.previousElementSibling;
      }
      current = current.parentElement;
    }
    return document.title || "AO3 Listing";
  }

  function blurbKind(root) {
    if (root.classList.contains("bookmark")) return "bookmark";
    return "work";
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
      kind: "work",
      work: {
        id: root.id || "",
        title: titleLink ? text(titleLink) : text(root),
        workUrl: titleLink ? abs(titleLink.getAttribute("href")) || undefined : undefined,
        author: authorLink ? { label: text(authorLink), href: abs(authorLink.getAttribute("href")) || undefined } : undefined,
        fandoms: fandomLinks.length ? fandomLinks : undefined,
        tags: {
          warnings: commaTags.warnings.length ? commaTags.warnings.map(function(tag) { return tag.label; }) : undefined,
          relationships: commaTags.relationships.length ? commaTags.relationships.map(function(tag) { return tag.label; }) : undefined,
          characters: commaTags.characters.length ? commaTags.characters.map(function(tag) { return tag.label; }) : undefined,
          freeforms: commaTags.freeforms.length ? commaTags.freeforms.map(function(tag) { return tag.label; }) : undefined,
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
      }
    };
  }

  function parseBookmark(root) {
    var titleLink = firstMatch(root, ["h4.heading a", ".header h4 a", "a[href*='/works/']"]);
    var workAuthor = root.querySelector("a[rel='author']");

    // The bookmarker's own info (byline, date bookmarked, their tags, their
    // notes) all live inside this block, separate from the work's own info
    // above it. Scoping to it avoids picking up the work's data by mistake.
    var ownModule = firstMatch(root, [".own.user.module.group", ".user.module.group"]);

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

    // A bookmark blurb has TWO ".datetime" elements: the work's own publish
    // date (inside .header.module, earlier in the DOM) and the bookmark's
    // own "bookmarked on" date (inside .own.user.module.group). Prefer the
    // latter explicitly instead of just grabbing the first ".datetime" found.
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
    var spriteClassName = (fullClassName && fullClassName.split(/\s+/).filter(Boolean).find(function(cls) {
      return /^(public|private|hidden|rec)/.test(cls);
    })) || "public";
    return {
      id: root.id || "",
      kind: "bookmark",
      bookmark: {
        id: root.id || "",
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
        // Prefer the bookmarker's own note; there's no separate UI slot for
        // the work's own summary on a bookmark card right now, so leave this
        // blank rather than mislabeling the work's summary as "Notes".
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
      }
    };
  }

  function parseGroup(root) {
    var title = findGroupTitle(root);
    var items = [];
    var blurbs = Array.from(root.querySelectorAll("li.work.blurb, li.bookmark.blurb"));
    if (root.matches && (root.matches("li.work.blurb") || root.matches("li.bookmark.blurb"))) {
      blurbs = [root].concat(blurbs);
    }

    var seen = new Set();
    blurbs.forEach(function(node) {
      if (!node || !node.classList) return;
      var id = node.id || text(node.querySelector("h4.heading a")) || text(node);
      if (!id || seen.has(id)) return;
      seen.add(id);
      if (node.classList.contains("bookmark")) {
        items.push(parseBookmark(node));
      } else {
        items.push(parseWork(node));
      }
    });

    return {
      key: title + "::" + (root.id || "root"),
      title: title,
      items: items,
    };
  }

  function collectGroups() {
    var candidates = Array.from(document.querySelectorAll("ol.group, ul.group, .group, section, main"));
    var blurbs = Array.from(document.querySelectorAll("li.work.blurb, li.bookmark.blurb"));

    if (blurbs.length === 0) {
      var fallback = Array.from(document.querySelectorAll("li"));
      blurbs = fallback.filter(function(node) {
        return node.classList && (node.classList.contains("work") || node.classList.contains("bookmark")) && node.classList.contains("blurb");
      });
    }

    if (blurbs.length === 0) return [];

    if (candidates.length === 0) {
      return [{
        key: "default",
        title: document.title || "AO3 Listing",
        items: blurbs.map(function(node) {
          return node.classList.contains("bookmark") ? parseBookmark(node) : parseWork(node);
        })
      }];
    }

    var groups = [];
    var used = new Set();

    candidates.forEach(function(container) {
      var localBlurbs = Array.from(container.querySelectorAll("li.work.blurb, li.bookmark.blurb"));
      if (localBlurbs.length === 0) return;

      var parsed = parseGroup(container);
      if (!parsed.items.length) return;

      parsed.items.forEach(function(item) {
        used.add(item.id);
      });
      groups.push(parsed);
    });

    var remaining = blurbs.filter(function(node) {
      return !used.has(node.id || "");
    });

    if (remaining.length) {
      groups.push({
        key: "ungrouped",
        title: "Ungrouped",
        items: remaining.map(function(node) {
          return node.classList.contains("bookmark") ? parseBookmark(node) : parseWork(node);
        })
      });
    }

    var deduped = [];
    var groupSeen = new Set();
    groups.forEach(function(group) {
      if (groupSeen.has(group.key)) return;
      groupSeen.add(group.key);
      deduped.push(group);
    });

    // For now, only surface the "Recent Bookmarks" group — the page also
    // renders a full "Bookmarks" listing which duplicates most of the same
    // items and was what looked like the list "reloading" after itself.
    var recentOnly = deduped.filter(function(group) {
      return /recent\\s+bookmarks?/i.test(group.title || "");
    });

    if (recentOnly.length) return recentOnly;

    // Fallback: title text didn't match (page markup may differ). Rather
    // than silently show nothing, fall back to everything and log why.
    console.warn("[AO3ListingScreen] No group titled like 'Recent Bookmarks' found; showing all groups. Titles seen:", deduped.map(function(g) { return g.title; }));
    return deduped;
  }

  setTimeout(function() {
    try {
      var groups = collectGroups();
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: "listingData",
        pageTitle: document.title || "",
        groups: groups,
      }));
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: "listingError",
        error: String(err && err.message ? err.message : err),
      }));
    }
  }, 350);
})();
true;
`;

// The bookmarker's own info (who bookmarked it, when, their personal tags,
// their notes) is metadata *about the bookmark*, not the work itself — shown
// as a separate box below the main card, the same way AO3HistoryScreen shows
// "last visited" info below its work cards rather than inside them.
const BookmarkMetaCard: React.FC<{ bookmark: AO3BookmarkData }> = ({ bookmark }) => {
  const hasByline = !!(bookmark.bookmarker || bookmark.datetime);
  const hasTags = !!(bookmark.userMeta && bookmark.userMeta.length > 0);
  const hasNotes = !!bookmark.summary;

  if (!hasByline && !hasTags && !hasNotes) return null;

  return (
    <View style={styles.bookmarkMetaCard}>
      {hasByline ? (
        <Text style={styles.bookmarkMetaByline}>
          {bookmark.bookmarker ? (
            <>
              Bookmarked by{" "}
              <Text
                style={styles.bookmarkMetaLink}
                onPress={bookmark.bookmarker.href ? () => Linking.openURL(bookmark.bookmarker!.href!) : undefined}
              >
                {bookmark.bookmarker.label}
              </Text>
            </>
          ) : null}
          {bookmark.datetime ? (
            <Text style={styles.bookmarkMetaDate}>
              {bookmark.bookmarker ? "  ·  " : ""}
              {bookmark.datetime}
            </Text>
          ) : null}
        </Text>
      ) : null}

      {hasTags ? (
        <View style={styles.bookmarkMetaBlock}>
          <Text style={styles.bookmarkMetaLabel}>Bookmarker's Tags</Text>
          {renderCommaLinkList(bookmark.userMeta, "muted")}
        </View>
      ) : null}

      {hasNotes ? (
        <View style={styles.bookmarkMetaBlock}>
          <Text style={styles.bookmarkMetaLabel}>Notes</Text>
          <Text style={styles.bookmarkMetaNotes}>{bookmark.summary}</Text>
        </View>
      ) : null}
    </View>
  );
};

const AO3ListingScreen: React.FC<Props> = ({ url, title, showHeader = true, onGroupsLoaded, onItemPress }) => {
  const webRef = useRef<any>(null);
  const lastPayloadRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageTitle, setPageTitle] = useState(title || "");
  const [groups, setGroups] = useState<AO3ListingGroup[]>([]);
  const [sourceHtml, setSourceHtml] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setGroups([]);
    setSourceHtml(null);

    let cancelled = false;

    (async () => {
      try {
        const res = await fetchWithSession(url);
        if (!res.ok) {
          return;
        }
        const html = await res.text();
        if (cancelled) return;
        setSourceHtml(html);
      } catch (err) {
        console.warn("[AO3ListingScreen] Session fetch failed, falling back to direct page load:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  const sections = useMemo(
    () => groups.map((group) => ({ key: group.key, title: group.title, data: group.items })),
    [groups],
  );

  const itemsById = useMemo(() => {
    const map = new Map<string, AO3ListingItem>();
    groups.forEach((group) => {
      group.items.forEach((entry) => map.set(entry.id, entry));
    });
    return map;
  }, [groups]);

  const handlePressWork = useCallback(
    (data: AO3WorkBlurbData | AO3BookmarkData) => {
      const entry = itemsById.get(String(data.id));
      if (entry) onItemPress?.(entry);
    },
    [itemsById, onItemPress],
  );

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      if (e.nativeEvent.data === lastPayloadRef.current) return;
      lastPayloadRef.current = e.nativeEvent.data;

      const payload = JSON.parse(e.nativeEvent.data);
      if (payload.type === "listingData") {
        setPageTitle(payload.pageTitle || title || "");
        const nextGroups = Array.isArray(payload.groups) ? payload.groups : [];
        setGroups(nextGroups);
        onGroupsLoaded?.(nextGroups);
      } else if (payload.type === "listingError") {
        console.warn("[AO3ListingScreen] Listing extraction failed:", payload.error);
      }
    } catch (err) {
      console.warn("[AO3ListingScreen] Could not parse listing payload:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {showHeader ? (
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {pageTitle || title || "AO3 Listing"}
          </Text>
          <Text style={styles.headerSubtitle}>
            {groups.length} group{groups.length === 1 ? "" : "s"}
          </Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#7ec14b" />
          <Text style={styles.loadingText}>Reading blurbs...</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item, index) => item.id || String(index)}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text style={styles.groupTitle}>{section.title}</Text>
          )}
          renderItem={({ item: entry }) => (
            <View style={styles.blurbWrap}>
              <AO3WorkBlurb
                kind={entry.kind}
                work={entry.work}
                bookmark={entry.bookmark}
                onPressWork={onItemPress ? handlePressWork : undefined}
              />

              {entry.kind === "bookmark" && entry.bookmark ? (
                <BookmarkMetaCard bookmark={entry.bookmark} />
              ) : null}
            </View>
          )}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No blurbs found</Text>
              <Text style={styles.emptyBody}>
                The page may not use standard AO3 listing markup, or the extractor may need a new selector.
              </Text>
            </View>
          }
        />
      )}

      <HiddenWebView
        ref={webRef}
        source={sourceHtml ? { html: sourceHtml, baseUrl: url } : { uri: url }}
        injectedJavaScript={LISTING_INJECTED_JS}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
    backgroundColor: "#0d0d0d",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  headerSubtitle: {
    color: "#9a9a9a",
    fontSize: 12,
    marginTop: 4,
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
  groupTitle: {
    color: "#7ec14b",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  blurbWrap: {
    width: "100%",
  },
  bookmarkMetaCard: {
    marginTop: 8,
    backgroundColor: "#161616",
    borderWidth: 1,
    borderColor: "#262626",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  bookmarkMetaByline: {
    color: "#c7c7c7",
    fontSize: 13,
  },
  bookmarkMetaLink: {
    color: "#7ec14b",
    fontWeight: "700",
  },
  bookmarkMetaDate: {
    color: "#8b8b8b",
  },
  bookmarkMetaBlock: {
    gap: 4,
  },
  bookmarkMetaLabel: {
    color: "#8c8c8c",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  bookmarkMetaNotes: {
    color: "#efefef",
    fontSize: 14,
    lineHeight: 20,
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
});

export default AO3ListingScreen;