import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { fetchWithSession } from "../api/ao3Auth";
import { extractUsernameFromUsersUrl, extractCsrfToken, deleteAo3Bookmark } from "../api/ao3Bookmarks";
import AO3WorkBlurb, {
  AO3BookmarkData,
  AO3BlurbKind,
  AO3WorkBlurbData,
  AO3SeriesBlurbData,
  AO3Link,
} from "../components/AO3WorkBlurb";
import BookmarkOwnerCard from "../components/BookmarkOwnerCard";
import type { ProfileHeaderInfo } from "../components/Ao3Header";

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
  series?: AO3SeriesBlurbData;
}

export interface AO3ListingGroup {
  key: string;
  title: string;
  items: AO3ListingItem[];
}

// A profile's "Fandoms" box — shown once, above the Works/Series/Bookmarks
// lists, rather than as its own scrollable section (it isn't a list of
// blurb cards).
export interface AO3FandomEntry {
  label: string;
  href?: string;
  count?: number;
}

// Whatever Rails actually rendered for the Subscribe toggle form, captured
// as-is (action URL, method override, hidden fields) so it can be replayed
// exactly rather than the app having to guess create-vs-destroy semantics.
interface AO3SubscribeForm {
  actionUrl?: string;
  method: string;
  fields: Record<string, string>;
  commitLabel?: string;
  isSubscribed: boolean;
}

interface AO3ProfileActions {
  subscribe?: AO3SubscribeForm;
  blockHref?: string;
  muteHref?: string;
}

interface Props {
  url: string;
  title?: string;
  showHeader?: boolean;
  onGroupsLoaded?: (groups: AO3ListingGroup[]) => void;
  onItemPress?: (item: AO3ListingItem) => void;
  // Forwarded straight to the SectionList's onScroll so a parent (e.g. the
  // app's collapsible header) can track this screen's scroll position.
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  contentContainerTopPadding?: number;
  // Called with a username when a bookmark card's "Bookmarked by X" byline
  // is tapped, so the caller can navigate to that user's bookmarks page
  // in-app instead of opening it in the external browser.
  onPressBookmarker?: (username: string) => void;
  // The currently logged-in user (from the session), used only to decide
  // whether to show the Edit/Delete/Add to Collection/Share actions on a
  // bookmark — those only make sense (and only actually exist server-side)
  // when this matches the bookmark's own profile.
  currentUsername?: string | null;
  // Called when a work/bookmark card's author byline is tapped, so the
  // caller can open that author's profile in-app (this same screen, reused
  // for a different `url`) instead of the external browser.
  onPressAuthor?: (author: AO3Link) => void;
  // Called when the header's back button is tapped. Only meaningful when
  // this screen is used as the standalone "profile" tab (not embedded in
  // Home, which has no back button and never passes this).
  onClose?: () => void;
  // Published whenever this screen's title changes (and cleared with `null`
  // on unmount) so the app's global Ao3Header can render its own back
  // button + title instead of this component drawing its own. Only meant to
  // be passed when this screen is used as the standalone "profile" tab.
  onHeaderActionsChange?: (info: ProfileHeaderInfo | null) => void;
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

  function parseBookmark(root) {
    var titleLink = firstMatch(root, ["h4.heading a", ".header h4 a", "a[href*='/works/']"]);
    var workAuthor = root.querySelector("a[rel='author']");

    // The bookmarker's own info (byline, date bookmarked, their tags, their
    // notes, and — when this is the logged-in user's own bookmark — the
    // Edit/Delete/etc actions) all live inside this block, separate from
    // the work's own info above it. Scoping to it avoids picking up the
    // work's data by mistake.
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
    var ownActions = parseOwnActions(ownModule);
    return {
      id: root.id || "",
      kind: "bookmark",
      bookmark: {
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

  // A series blurb is a lot narrower than a work blurb (no chapters/kudos/
  // hits/comments, no "part of a series" self-reference) but shares the
  // same title/author/fandoms/required-tags/tags-commas/datetime markup, so
  // this reuses the same collect* helpers as parseWork above.
  function parseSeriesItem(root) {
    var titleLink = firstMatch(root, ["h4.heading a[href*='/series/']", "h4.heading a"]);
    var authorLink = root.querySelector("a[rel='author']");
    var fandomLinks = collectTags(root, ["h5.fandoms a.tag", ".fandoms a.tag"]);
    var commaTags = collectCommaTags(root);
    var required = collectRequired(root);
    var stats = collectStats(root);
    return {
      id: root.id || "",
      kind: "series",
      series: {
        id: root.id || "",
        title: titleLink ? text(titleLink) : text(root),
        seriesUrl: titleLink ? abs(titleLink.getAttribute("href")) || undefined : undefined,
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
        requiredTagIcons: required.icons,
        publishedAt: text(root.querySelector(".datetime")) || undefined,
        summary: collectSummary(root) || undefined,
        stats: {
          words: stats.words,
          works: stats.works,
          bookmarks: stats.bookmarks,
        },
      }
    };
  }

  // The profile page's "Fandoms" box (#user-fandoms) lists every fandom this
  // user has works in, each as "<a>Fandom Name</a> (N)" — the count sits as
  // plain text right after the link, not inside its own element.
  function collectFandoms() {
    var container = document.querySelector("#user-fandoms");
    if (!container) return [];
    var items = Array.from(container.querySelectorAll("ol.index.group > li"));
    var out = [];
    items.forEach(function(li) {
      var a = li.querySelector("a");
      if (!a) return;
      var full = text(li);
      var m = full.match(/\\((\\d[\\d,]*)\\)\\s*$/);
      out.push({
        label: text(a),
        href: abs(a.getAttribute("href")) || undefined,
        count: m ? parseInt(m[1].replace(/,/g, ""), 10) : undefined,
      });
    });
    return out;
  }

  // Each of #user-works / #user-series / #user-bookmarks lists only that
  // section's own blurbs, so no group-boundary guessing is needed the way
  // the old generic scanner had to — just scope the query to the container.
  function collectSectionItems(containerSelector, parseFn) {
    var container = document.querySelector(containerSelector);
    if (!container) return [];
    var blurbs = Array.from(container.querySelectorAll("li.work.blurb, li.series.blurb, li.bookmark.blurb"));
    var seen = new Set();
    var items = [];
    blurbs.forEach(function(node) {
      var id = node.id || "";
      if (!id || seen.has(id)) return;
      seen.add(id);
      items.push(parseFn(node));
    });
    return items;
  }

  // A profile page always lays these three out in this order (Works, then
  // Series, then Bookmarks) — this just mirrors that instead of trying to
  // infer group order/titles from generic page structure.
  function collectProfileGroups() {
    var groups = [];

    var works = collectSectionItems("#user-works", parseWork);
    if (works.length) groups.push({ key: "works", title: "Recent works", items: works });

    var series = collectSectionItems("#user-series", parseSeriesItem);
    if (series.length) groups.push({ key: "series", title: "Recent series", items: series });

    var bookmarks = collectSectionItems("#user-bookmarks", parseBookmark);
    if (bookmarks.length) groups.push({ key: "bookmarks", title: "Recent bookmarks", items: bookmarks });

    return groups;
  }

  // Each section ends with its own "<a>Works (15)</a>"-style link to the
  // full (paginated) listing — this is the section's actual total, which
  // the "Recent ..." list above it only ever shows a handful of.
  function findSectionTotal(containerSelector) {
    var container = document.querySelector(containerSelector);
    if (!container) return null;
    var links = Array.from(container.querySelectorAll("ul.actions a"));
    for (var i = 0; i < links.length; i++) {
      var t = text(links[i]);
      var m = t.match(/\\((\\d[\\d,]*)\\)\\s*$/);
      if (m) return parseInt(m[1].replace(/,/g, ""), 10);
    }
    return null;
  }

  // The profile's own picture, shown at the top of the page next to the
  // username heading. Deliberately scoped to the profile's own header block
  // (never an unscoped "p.icon img" search of the whole document) — AO3's
  // site-wide nav also renders the logged-in session user's own icon in a
  // "p.icon img" earlier in the page, and an unscoped query would match that
  // one instead whenever it comes first in document order, showing YOUR
  // picture on every profile instead of the one actually being viewed.
  function collectAvatarUrl() {
    var scope = document.querySelector(".primary.header.module") || document.querySelector(".user.pseud.home");
    if (!scope) return null;
    var img = scope.querySelector("p.icon img.icon") || scope.querySelector("p.icon img");
    return img ? abs(img.getAttribute("src")) : null;
  }

  // Subscribe/Mute/Block only render in this nav for someone ELSE's profile
  // (AO3 has nothing here on your own). Subscribe is a toggle form; rather
  // than guessing its REST semantics, this just captures whatever Rails
  // actually rendered (action URL, method override, hidden fields) so the
  // app can replay it exactly — the same "read the real form" approach used
  // for the bookmark/history delete forms elsewhere in this app.
  function collectProfileActions() {
    var nav = document.querySelector(".primary.header.module ul.navigation.actions");
    if (!nav) return null;

    var subscribe = null;
    var form = nav.querySelector("form.ajax-create-destroy");
    if (form) {
      var methodInput = form.querySelector("input[name='_method']");
      var submitBtn = form.querySelector("input[type='submit']");
      var fields = {};
      Array.from(form.querySelectorAll("input[name]")).forEach(function(input) {
        if (input.type === "submit") return;
        fields[input.name] = input.value;
      });
      subscribe = {
        actionUrl: abs(form.getAttribute("action")),
        method: methodInput ? methodInput.value.toUpperCase() : (form.getAttribute("method") || "post").toUpperCase(),
        fields: fields,
        commitLabel: submitBtn ? submitBtn.value : undefined,
        isSubscribed: !!(submitBtn && /unsubscribe/i.test(submitBtn.value || "")),
      };
    }

    var links = Array.from(nav.querySelectorAll("li > a"));
    function findLink(re) {
      var a = links.find(function(a) { return re.test(text(a)); });
      return a ? abs(a.getAttribute("href")) : undefined;
    }

    var blockHref = findLink(/block/i);
    var muteHref = findLink(/mute/i);
    if (!subscribe && !blockHref && !muteHref) return null;

    return { subscribe: subscribe, blockHref: blockHref, muteHref: muteHref };
  }

  setTimeout(function() {
    try {
      var csrfMeta = document.querySelector('meta[name="csrf-token"]');
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: "listingData",
        pageTitle: document.title || "",
        avatarUrl: collectAvatarUrl(),
        profileActions: collectProfileActions(),
        fandoms: collectFandoms(),
        groups: collectProfileGroups(),
        csrfToken: csrfMeta ? csrfMeta.getAttribute("content") : null,
        bookmarksCount: findSectionTotal("#user-bookmarks"),
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

const AO3ListingScreen: React.FC<Props> = ({
  url,
  title,
  showHeader = true,
  onGroupsLoaded,
  onItemPress,
  onScroll,
  contentContainerTopPadding = 0,
  onPressBookmarker,
  currentUsername,
  onPressAuthor,
  onClose,
  onHeaderActionsChange,
}) => {
  const webRef = useRef<any>(null);
  const lastPayloadRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageTitle, setPageTitle] = useState(title || "");
  const [groups, setGroups] = useState<AO3ListingGroup[]>([]);
  const [fandoms, setFandoms] = useState<AO3FandomEntry[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [profileActions, setProfileActions] = useState<AO3ProfileActions | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [sourceHtml, setSourceHtml] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [bookmarksCount, setBookmarksCount] = useState<number | null>(null);

  // Derived from `url` rather than a dedicated prop, so this keeps working
  // once this screen is reused to render other users' profiles (not just
  // the logged-in one) — whatever "/users/<name>" the page being shown
  // belongs to is whose bookmarks the button below should link to.
  const profileUsername = useMemo(() => extractUsernameFromUsersUrl(url), [url]);

  const isOwnUser =
    !!currentUsername &&
    !!profileUsername &&
    currentUsername.trim().toLowerCase() === profileUsername.trim().toLowerCase();

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
        setFandoms(Array.isArray(payload.fandoms) ? payload.fandoms : []);
        setAvatarUrl(typeof payload.avatarUrl === "string" ? payload.avatarUrl : null);
        const nextActions: AO3ProfileActions | null = payload.profileActions || null;
        setProfileActions(nextActions);
        setIsSubscribed(!!nextActions?.subscribe?.isSubscribed);
        if (payload.csrfToken) setCsrfToken(payload.csrfToken);
        if (typeof payload.bookmarksCount === "number") setBookmarksCount(payload.bookmarksCount);
      } else if (payload.type === "listingError") {
        console.warn("[AO3ListingScreen] Listing extraction failed:", payload.error);
      }
    } catch (err) {
      console.warn("[AO3ListingScreen] Could not parse listing payload:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleEditBookmark = useCallback((href: string) => {
    Linking.openURL(href).catch((err) => {
      console.warn("[AO3ListingScreen] Could not open edit URL:", err);
    });
  }, []);

  const handleAddBookmarkToCollection = useCallback((href: string) => {
    Linking.openURL(href).catch((err) => {
      console.warn("[AO3ListingScreen] Could not open add-to-collection URL:", err);
    });
  }, []);

  const handleShareBookmark = useCallback((href: string) => {
    Linking.openURL(href).catch((err) => {
      console.warn("[AO3ListingScreen] Could not open share URL:", err);
    });
  }, []);

  const handleDeleteBookmark = useCallback(
    (bookmark: AO3BookmarkData) => {
      const deleteHref = bookmark.ownActions?.deleteHref;
      const id = String(bookmark.id);
      if (!deleteHref) {
        console.warn("[AO3ListingScreen] Delete skipped — missing deleteHref", { id });
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
                try {
                  const res = await fetchWithSession(url);
                  const freshHtml = res.ok ? await res.text() : null;
                  token = freshHtml ? extractCsrfToken(freshHtml) ?? null : null;
                } catch (err) {
                  console.warn("[AO3ListingScreen] Could not refresh CSRF token:", err);
                }
              }

              if (!token) {
                console.warn("[AO3ListingScreen] Delete skipped — no CSRF token available");
                Alert.alert("Couldn't remove", "AO3 did not provide a fresh delete token. Reload this list and try again.");
                return;
              }

              const result = await deleteAo3Bookmark(deleteHref, token, url);

              if (result.ok) {
                setGroups((prev) =>
                  prev.map((group) => ({
                    ...group,
                    items: group.items.filter((entry) => String(entry.bookmark?.id ?? entry.id) !== id),
                  })),
                );
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
    [csrfToken, url],
  );

  // Replays whatever Rails actually rendered for the Subscribe/Unsubscribe
  // form (see collectProfileActions above) rather than re-deriving the
  // create/destroy semantics ourselves — the same "resubmit the real form"
  // approach the bookmark/history delete actions already use.
  const handleToggleSubscribe = useCallback(async () => {
    const subscribe = profileActions?.subscribe;
    if (!subscribe?.actionUrl) return;

    setSubscribing(true);
    try {
      const body = new URLSearchParams();
      Object.entries(subscribe.fields).forEach(([key, value]) => body.append(key, value));
      if (subscribe.commitLabel) body.append("commit", subscribe.commitLabel);

      const res = await fetchWithSession(subscribe.actionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: url,
        },
        body: body.toString(),
      });

      if (res.ok) {
        setIsSubscribed((prev) => !prev);
      } else {
        Alert.alert(
          "Couldn't update subscription",
          `AO3 didn't confirm the change (status ${res.status}).`,
        );
      }
    } catch (err) {
      console.warn("[AO3ListingScreen] Subscribe toggle failed:", err);
      Alert.alert("Couldn't update subscription", "Something went wrong. Please try again.");
    } finally {
      setSubscribing(false);
    }
  }, [profileActions, url]);

  const handleMute = useCallback(() => {
    if (!profileActions?.muteHref) return;
    Linking.openURL(profileActions.muteHref).catch((err) => {
      console.warn("[AO3ListingScreen] Could not open mute URL:", err);
    });
  }, [profileActions]);

  const handleBlock = useCallback(() => {
    if (!profileActions?.blockHref) return;
    Linking.openURL(profileActions.blockHref).catch((err) => {
      console.warn("[AO3ListingScreen] Could not open block URL:", err);
    });
  }, [profileActions]);

  // Only meaningful when this screen is used as the standalone "profile" tab
  // (App.tsx passes onHeaderActionsChange there, but not for the Home tab's
  // embedded usage) — harmless no-op otherwise since both calls are optional.
  // `actions` is only included when viewing someone else's profile — AO3 has
  // no Subscribe/Mute/Block on your own.
  useEffect(() => {
    onHeaderActionsChange?.({
      title: pageTitle || title || (profileUsername ? `${profileUsername}'s Profile` : "Profile"),
      onGoBack: () => onClose?.(),
      actions:
        !isOwnUser && profileActions
          ? { isSubscribed, subscribing, onToggleSubscribe: handleToggleSubscribe, onMute: handleMute, onBlock: handleBlock }
          : undefined,
    });
  }, [
    pageTitle,
    title,
    profileUsername,
    onClose,
    onHeaderActionsChange,
    isOwnUser,
    profileActions,
    isSubscribed,
    subscribing,
    handleToggleSubscribe,
    handleMute,
    handleBlock,
  ]);

  // Separate from the effect above so the "clear on unmount" cleanup doesn't
  // also fire (and briefly flicker the header) on every title update — this
  // one's dependency array never changes, so its cleanup only runs once,
  // when the screen actually unmounts.
  useEffect(() => {
    return () => onHeaderActionsChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // No paddingTop here: this box must stay full-screen (a background
    // layer) so the SectionList underneath can scroll its content behind
    // the app's absolutely-positioned header rather than starting after it.
    <View style={styles.container}>
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
        <View style={[styles.loading, { paddingTop: contentContainerTopPadding }]}>
          <ActivityIndicator size="large" color="#7ec14b" />
          <Text style={styles.loadingText}>Reading blurbs...</Text>
        </View>
      ) : (
        <Animated.SectionList
          sections={sections}
          keyExtractor={(item, index) => item.id || String(index)}
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
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            avatarUrl || profileUsername || fandoms.length ? (
              <View>
                {avatarUrl || profileUsername ? (
                  <View style={styles.profileHeaderRow}>
                    {avatarUrl ? (
                      <Image source={{ uri: avatarUrl }} style={styles.profileAvatar} />
                    ) : (
                      <View style={[styles.profileAvatar, styles.profileAvatarPlaceholder]} />
                    )}
                    <Text style={styles.profileUsername} numberOfLines={1}>
                      {profileUsername || pageTitle || "Profile"}
                    </Text>
                  </View>
                ) : null}

                {fandoms.length ? (
                  <View style={styles.fandomsBox}>
                    <Text style={styles.fandomsTitle}>Fandoms</Text>
                    <View style={styles.fandomsList}>
                      {fandoms.map((fandom, index) => (
                        <TouchableOpacity
                          key={`${fandom.label}-${index}`}
                          style={styles.fandomPill}
                          onPress={fandom.href ? () => Linking.openURL(fandom.href!) : undefined}
                          disabled={!fandom.href}
                        >
                          {/* Split into two Texts so a long fandom name only
                              ever truncates itself — the count stays in its
                              own non-shrinking Text and is never the part
                              that gets clipped by numberOfLines. */}
                          <Text style={styles.fandomPillText} numberOfLines={1}>
                            {fandom.label}
                          </Text>
                          {typeof fandom.count === "number" ? (
                            <Text style={styles.fandomPillCount}>{` (${fandom.count})`}</Text>
                          ) : null}
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.groupTitle} numberOfLines={1}>
                {section.title}
              </Text>
              {section.key === "bookmarks" && profileUsername && onPressBookmarker ? (
                <TouchableOpacity
                  style={styles.bookmarksCountBtn}
                  onPress={() => onPressBookmarker(profileUsername)}
                >
                  <Text style={styles.bookmarksCountBtnText} numberOfLines={1}>
                    Bookmarks ({bookmarksCount ?? 0})
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
          renderItem={({ item: entry }) => (
            <View style={styles.blurbWrap}>
              <AO3WorkBlurb
                kind={entry.kind}
                work={entry.work}
                bookmark={entry.bookmark}
                series={entry.series}
                // A series card has no "open reader" destination of its own —
                // tapping it just opens the series' AO3 page externally
                // (AO3WorkBlurb's own default fallback for an unhandled press).
                onPressWork={entry.kind !== "series" && onItemPress ? handlePressWork : undefined}
                onPressAuthor={onPressAuthor}
              />

              {entry.kind === "bookmark" && entry.bookmark ? (
                <BookmarkOwnerCard
                  bookmark={entry.bookmark}
                  isOwnUser={isOwnUser}
                  removing={removingIds.has(String(entry.bookmark.id))}
                  onEdit={handleEditBookmark}
                  onDelete={handleDeleteBookmark}
                  onAddToCollection={handleAddBookmarkToCollection}
                  onShare={handleShareBookmark}
                  onPressBookmarker={onPressBookmarker}
                />
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
    </View>
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
  profileHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  profileAvatar: {
    width: 56,
    height: 56,
    borderWidth: 1,
    borderColor: "#333",
  },
  profileAvatarPlaceholder: {
    backgroundColor: "#1c1c1c",
  },
  profileUsername: {
    flex: 1,
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  fandomsBox: {
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 16,
    padding: 16,
    gap: 12,
    marginBottom: 16,
  },
  fandomsTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  fandomsList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  fandomPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1c1c1c",
    borderColor: "#343434",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: "100%",
  },
  fandomPillText: {
    flexShrink: 1,
    color: "#d8d8d8",
    fontSize: 12,
    fontWeight: "600",
  },
  fandomPillCount: {
    flexShrink: 0,
    color: "#d8d8d8",
    fontSize: 12,
    fontWeight: "600",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  bookmarksCountBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#242424",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#333",
  },
  bookmarksCountBtnText: {
    color: "#ddd",
    fontSize: 12,
    fontWeight: "700",
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
    flexShrink: 1,
    color: "#7ec14b",
    fontSize: 16,
    fontWeight: "700",
  },
  blurbWrap: {
    width: "100%",
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