import React, { useMemo } from "react";
import {
  ImageBackground,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";
import { hexToRgba } from "./colorUtils";

// A handful of module-level helper components/functions below (TagPill,
// renderLinkList, RequiredSymbol, etc.) render tag pills/icons used all over
// this card, but live outside AO3WorkBlurb itself, so they can't read its
// component-local `styles` (built from the current theme via createStyles)
// directly — each takes it as an explicit prop/argument instead.
export type AO3WorkBlurbStyles = ReturnType<typeof createAO3WorkBlurbStyles>;

export type AO3TagGroup = "warnings" | "relationships" | "characters" | "freeforms";
export type AO3BlurbKind = "work" | "bookmark" | "series";
type AO3RequiredTagKind = "rating" | "warnings" | "category" | "status";

export interface AO3Link {
  label: string;
  href?: string;
}

export interface AO3SeriesInfo {
  part?: number | string;
  title: string;
  href?: string;
}

export interface AO3WorkStats {
  language?: string;
  words?: number | string;
  chapters?: string | number;
  // Only present on a series blurb's stats (how many works it contains) —
  // left undefined for work/bookmark stats, where it never applies.
  works?: number | string;
  kudos?: number | string;
  hits?: number | string;
  comments?: number | string;
  bookmarks?: number | string;
}

export interface AO3WorkTagGroups {
  warnings?: AO3Link[];
  relationships?: AO3Link[];
  characters?: AO3Link[];
  freeforms?: AO3Link[];
}

export interface AO3RequiredTags {
  rating?: AO3Link;
  warnings?: AO3Link[];
  category?: AO3Link[];
  status?: AO3Link;
}

export interface AO3RequiredTagIcon {
  className: string;
  spriteClassName?: string;
  title?: string;
  href?: string;
}

export interface AO3WorkBlurbData {
  id: string | number;
  title: string;
  workUrl?: string;
  author?: AO3Link;
  fandoms?: AO3Link[];
  rating?: AO3Link;
  warnings?: AO3Link[];
  category?: AO3Link[];
  status?: AO3Link;
  requiredTags?: AO3RequiredTags;
  requiredTagIcons?: AO3RequiredTagIcon[];
  publishedAt?: string;
  summary?: string | React.ReactNode;
  series?: AO3SeriesInfo;
  tags?: AO3WorkTagGroups;
  stats?: AO3WorkStats;
  extraBadges?: string[];
}

export interface AO3BookmarkMeta {
  label: string;
  href?: string;
}

// The "Edit" / "Delete" / "Add to Collection" / "Share" links AO3 renders
// inside a bookmark's `.own.user.module.group` — only present server-side
// when the page is being viewed by the person who made that bookmark.
export interface AO3BookmarkOwnActions {
  editHref?: string;
  deleteHref?: string;
  addToCollectionHref?: string;
  shareHref?: string;
}

export interface AO3BookmarkData {
  id: string | number;
  title: string;
  workUrl?: string;
  workAuthor?: AO3Link;
  bookmarker?: AO3Link;
  status?: AO3Link;
  bookmarkStatusIcon?: AO3RequiredTagIcon;
  requiredTags?: AO3RequiredTags;
  requiredTagIcons?: AO3RequiredTagIcon[];
  count?: number | string;
  datetime?: string;
  userMeta?: AO3BookmarkMeta[];
  summary?: string | React.ReactNode;
  tags?: AO3WorkTagGroups;
  fandoms?: AO3Link[];
  stats?: AO3WorkStats;
  extraBadges?: string[];
  // Whether AO3's own markup marked this bookmark's module as "own" (i.e.
  // `ownActions` below was actually rendered server-side). Screens should
  // still gate showing those actions on comparing the logged-in session's
  // username against whose bookmarks page this is, rather than this alone.
  isOwnModule?: boolean;
  ownActions?: AO3BookmarkOwnActions;
}

// A series blurb, as shown in a profile's "Recent series" list — narrower
// than a work blurb (no chapters/kudos/hits/comments, no "part of a series"
// self-reference), but rendered by the same AO3WorkBlurb card for visual
// consistency with works/bookmarks.
export interface AO3SeriesBlurbData {
  id: string | number;
  title: string;
  seriesUrl?: string;
  author?: AO3Link;
  fandoms?: AO3Link[];
  rating?: AO3Link;
  warnings?: AO3Link[];
  category?: AO3Link[];
  status?: AO3Link;
  requiredTagIcons?: AO3RequiredTagIcon[];
  publishedAt?: string;
  summary?: string | React.ReactNode;
  tags?: AO3WorkTagGroups;
  stats?: AO3WorkStats;
  extraBadges?: string[];
}

interface Props {
  kind?: AO3BlurbKind;
  work?: AO3WorkBlurbData;
  bookmark?: AO3BookmarkData;
  series?: AO3SeriesBlurbData;
  onPressWork?: (item: AO3WorkBlurbData | AO3BookmarkData) => void;
  onPressAuthor?: (author: AO3Link) => void;
  onPressTag?: (tag: AO3Link, group?: AO3TagGroup | "fandoms" | "rating" | "status" | "category" | "warnings" | "bookmarkerTags") => void;
  style?: ViewStyle;
}

const formatStat = (value?: number | string) => {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
};

const openUrl = async (href?: string) => {
  if (!href) return;
  try {
    await Linking.openURL(href);
  } catch (err) {
    console.warn("[AO3WorkBlurb] Could not open URL:", href, err);
  }
};

const SYMBOL_SPRITE_URI = "https://archiveofourown.org/images/imageset.png";
const SYMBOL_SIZE = 25;
const SYMBOL_SPRITE_WIDTH = 200;
const SYMBOL_SPRITE_HEIGHT = 835;

const SYMBOL_OFFSETS: Record<string, { left: number; top: number }> = {
  "rating-general-audience": { left: -50, top: -25 },
  "rating-explicit": { left: -25, top: -25 },
  "rating-mature": { left: -75, top: -25 },
  "rating-notrated": { left: -150, top: 0 },
  "rating-teen": { left: 0, top: -25 },
  "category-femslash": { left: -25, top: 0 },
  "category-gen": { left: -50, top: 0 },
  "category-slash": { left: 0, top: 0 },
  "category-het": { left: -75, top: 0 },
  "category-multi": { left: -100, top: 0 },
  "category-other": { left: -125, top: 0 },
  "complete-no": { left: -100, top: -25 },
  "complete-yes": { left: -175, top: -25 },
  "warning-yes": { left: -150, top: -25 },
  "warning-choosenotto": { left: -125, top: -25 },
  "warning-no": { left: -150, top: 0 },
  "status-private": { left: -175, top: -50 },
  "status-public": { left: -125, top: -50 },
  "status-hidden": { left: -150, top: -50 },
  "status-rec": { left: -100, top: -50 },
};

const resolveSpriteClassName = (className?: string) => {
  if (!className) return "rating-notrated";

  const classes = className.split(/\s+/).filter(Boolean);
  const direct = classes.find((cls) => SYMBOL_OFFSETS[cls]);
  if (direct) return direct;

  const prefixMatch = classes.find((cls) => /^(rating|warning|category|complete|status)-/.test(cls));
  return prefixMatch ?? "rating-notrated";
};

const normalizeText = (value?: string | null) =>
  (value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const getRequiredTagClass = (kind: AO3RequiredTagKind, label?: string) => {
  const value = normalizeText(label);

  if (kind === "rating") {
    if (value.includes("general-audiences")) return "rating-general-audience";
    if (value.includes("explicit")) return "rating-explicit";
    if (value.includes("mature")) return "rating-mature";
    if (value.includes("teen")) return "rating-teen";
    return "rating-notrated";
  }

  if (kind === "warnings") {
    if (!value || value.includes("no-archive-warnings-apply")) return "warning-no";
    if (value.includes("choose-not-to-use-archive-warnings")) return "warning-choosenotto";
    return "warning-yes";
  }

  if (kind === "category") {
    if (value.includes("f-f") || value.includes("femslash")) return "category-femslash";
    if (value === "gen") return "category-gen";
    if (value.includes("m-m") || value.includes("slash")) return "category-slash";
    if (value.includes("f-m") || value.includes("het")) return "category-het";
    if (value.includes("multi")) return "category-multi";
    if (value.includes("other")) return "category-other";
    return "category-none";
  }

  if (kind === "status") {
    if (value.includes("complete") || value === "finished") return "complete-yes";
    if (value.includes("work-in-progress") || value.includes("in-progress") || value.includes("ongoing") || value.includes("wip")) return "complete-no";
    if (value.includes("private")) return "status-private";
    if (value.includes("public")) return "status-public";
    if (value.includes("hidden")) return "status-hidden";
    if (value.includes("recommended") || value === "rec") return "status-rec";
    return "complete-no";
  }

  return "rating-notrated";
};

const getSpriteOffset = (className: string) => SYMBOL_OFFSETS[resolveSpriteClassName(className)] ?? SYMBOL_OFFSETS["rating-notrated"];

const RequiredSymbol: React.FC<{ className: string; title?: string; styles: AO3WorkBlurbStyles }> = ({
  className,
  title,
  styles,
}) => {
  const offset = getSpriteOffset(className);

  return (
    <ImageBackground
      source={{ uri: SYMBOL_SPRITE_URI }}
      style={styles.symbolFrame}
      imageStyle={[
        styles.symbolImage,
        {
          transform: [{ translateX: offset.left }, { translateY: offset.top }],
        },
      ]}
      accessibilityLabel={title || className}
    />
  );
};

const BOOKMARK_STATUS_IMAGES: Record<string, string> = {
  rec: "https://archiveofourown.org/images/skins/iconsets/default/bookmark-rec.png",
  public: "https://archiveofourown.org/images/skins/iconsets/default/bookmark-public.png",
  private: "https://archiveofourown.org/images/skins/iconsets/default/bookmark-private.png",
  hidden: "https://archiveofourown.org/images/skins/iconsets/default/bookmark-hidden.png",
};

const resolveBookmarkStatusName = (className?: string) => {
  const normalized = (className ?? "").toLowerCase();
  if (normalized.includes("private")) return "private";
  if (normalized.includes("hidden")) return "hidden";
  if (normalized.includes("rec")) return "rec";
  return "public";
};

const BookmarkStatusSquare: React.FC<{ className?: string; title?: string; styles: AO3WorkBlurbStyles }> = ({
  className,
  title,
  styles,
}) => {
  const kind = resolveBookmarkStatusName(className);
  const source = BOOKMARK_STATUS_IMAGES[kind];

  return (
    <ImageBackground
      source={{ uri: source }}
      style={styles.symbolFrame}
      accessibilityLabel={title || kind}
    />
  );
};

const BookmarkCountSquare: React.FC<{ count?: number | string; styles: AO3WorkBlurbStyles }> = ({
  count,
  styles,
}) => {
  return (
    <View style={styles.bookmarkCountFrame}>
      <ImageBackground
        source={{ uri: SYMBOL_SPRITE_URI }}
        style={styles.symbolFrame}
        imageStyle={[
          styles.symbolImage,
          {
            transform: [{ translateX: -150 }, { translateY: 0 }],
          },
        ]}
        accessibilityLabel={count !== undefined ? String(count) : "bookmark count"}
      />
      {count !== undefined && count !== null && count !== "" ? (
        <Text style={styles.bookmarkCountText}>{count}</Text>
      ) : null}
    </View>
  );
};

const BookmarkStatusBlock: React.FC<{
  icon?: AO3RequiredTagIcon;
  count?: number | string;
  styles: AO3WorkBlurbStyles;
}> = ({ icon, count, styles }) => {
  if (!icon && count === undefined) return null;

  return (
    <View style={styles.bookmarkStatusGrid}>
      <View style={styles.bookmarkSlotLeft}>
        <BookmarkStatusSquare className={icon?.className} title={icon?.title} styles={styles} />
      </View>
      <View style={styles.bookmarkSlotRight}>
        <BookmarkCountSquare count={count} styles={styles} />
      </View>
    </View>
  );
};

const renderRequiredSymbols = (args: {
  kind: AO3BlurbKind;
  requiredTagIcons?: AO3RequiredTagIcon[];
  styles: AO3WorkBlurbStyles;
}) => {
  const { requiredTagIcons, styles } = args;
  if (!requiredTagIcons || requiredTagIcons.length === 0) return null;

  return (
    <View style={styles.requiredSymbolGrid}>
      {requiredTagIcons.slice(0, 4).map((icon, index) => {
        const className = icon.className || icon.spriteClassName || "rating-notrated";
        const positionStyle =
          index === 0
            ? styles.requiredSymbolSlotTopLeft
            : index === 1
              ? styles.requiredSymbolSlotBottomLeft
              : index === 2
                ? styles.requiredSymbolSlotTopRight
                : styles.requiredSymbolSlotBottomRight;
        return (
          <View key={`${className}-${index}`} style={[styles.requiredSymbolSlot, positionStyle]}>
            <RequiredSymbol className={className} title={icon.title} styles={styles} />
          </View>
        );
      })}
    </View>
  );
};

const TagPill: React.FC<{
  label: string;
  tone?: "muted" | "warning" | "accent";
  onPress?: () => void;
  styles: AO3WorkBlurbStyles;
}> = ({ label, tone = "muted", onPress, styles }) => {
  const content = <Text style={[styles.tagText, tone === "warning" && styles.tagTextWarning, tone === "accent" && styles.tagTextAccent]}>{label}</Text>;

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={[styles.tagPill, tone === "warning" && styles.tagPillWarning, tone === "accent" && styles.tagPillAccent]}>
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.tagPill, tone === "warning" && styles.tagPillWarning, tone === "accent" && styles.tagPillAccent]}>{content}</View>;
};

const renderLinkList = (
  items: AO3Link[] | undefined,
  tone: "muted" | "warning" | "accent",
  onPress: ((item: AO3Link) => void) | undefined,
  styles: AO3WorkBlurbStyles,
) => {
  if (!items || items.length === 0) return null;

  return (
    <View style={styles.tagRow}>
      {items.map((item, index) => (
        <TagPill
          key={`${item.label}-${index}`}
          label={item.label}
          tone={tone}
          styles={styles}
          onPress={
            onPress
              ? () => onPress(item)
              : item.href
                ? () => openUrl(item.href)
                : undefined
          }
        />
      ))}
    </View>
  );
};

// Same comma-separated inline layout as renderCommaLinkList, but for the
// combined warnings+relationships+characters+freeforms flow, where each item
// can come from a different group and needs that group passed back through
// onPressTag (e.g. a relationship/"shipping" tag opens its own works listing
// the same way a fandom tag already does).
const renderGroupedCommaLinks = (
  items: Array<{ link: AO3Link; tone: "muted" | "warning" | "accent"; group: AO3TagGroup }>,
  onPressTag: ((tag: AO3Link, group: AO3TagGroup) => void) | undefined,
  styles: AO3WorkBlurbStyles,
) => {
  if (items.length === 0) return null;

  return (
    <Text style={styles.commaTagsRow}>
      {items.map(({ link, tone, group }, index) => (
        <React.Fragment key={`${link.label}-${index}`}>
          <Text
            style={[
              styles.commaTagText,
              tone === "warning" && styles.commaTagTextWarning,
              tone === "accent" && styles.commaTagTextAccent,
            ]}
            onPress={
              onPressTag
                ? () => onPressTag(link, group)
                : link.href
                  ? () => openUrl(link.href)
                  : undefined
            }
          >
            {link.label}
          </Text>
          {index < items.length - 1 ? <Text style={styles.commaTagSeparator}>, </Text> : null}
        </React.Fragment>
      ))}
    </Text>
  );
};

// Same comma-separated inline layout as renderStringList, but for links that
// should actually be tappable (e.g. a bookmarker's own tags) — each item
// opens its href, or defers to onPress/onPressTag when provided. Exported
// since bookmark-specific metadata (like this) now renders outside the card,
// in whichever screen composes it (see AO3ListingScreen's bookmark meta box).
export const renderCommaLinkList = (
  items: AO3Link[] | undefined,
  tone: "muted" | "warning" | "accent",
  onPress: ((item: AO3Link) => void) | undefined,
  styles: AO3WorkBlurbStyles,
) => {
  if (!items || items.length === 0) return null;

  return (
    <Text style={styles.commaTagsRow}>
      {items.map((item, index) => (
        <React.Fragment key={`${item.label}-${index}`}>
          <Text
            style={[
              styles.commaTagText,
              tone === "warning" && styles.commaTagTextWarning,
              tone === "accent" && styles.commaTagTextAccent,
            ]}
            onPress={
              onPress
                ? () => onPress(item)
                : item.href
                  ? () => openUrl(item.href)
                  : undefined
            }
          >
            {item.label}
          </Text>
          {index < items.length - 1 ? <Text style={styles.commaTagSeparator}>, </Text> : null}
        </React.Fragment>
      ))}
    </Text>
  );
};

const AO3WorkBlurb: React.FC<Props> = ({ kind = "work", work, bookmark, series, onPressWork, onPressAuthor, onPressTag, style }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createAO3WorkBlurbStyles(colors), [colors]);
  const isBookmark = kind === "bookmark";
  const isSeries = kind === "series";
  const data = (isBookmark ? bookmark : isSeries ? series : work) ?? null;

  if (!data) return null;

  const stats = (isBookmark ? bookmark?.stats : isSeries ? series?.stats : work?.stats) ?? {};
  const summarySource = data.summary;
  const summary = typeof summarySource === "string" ? <Text style={styles.summaryText}>{summarySource}</Text> : summarySource;
  const requiredTagIcons = isSeries ? series?.requiredTagIcons : !isBookmark ? work?.requiredTagIcons : bookmark?.requiredTagIcons;
  const rating = isSeries ? series?.rating : !isBookmark ? work?.rating : undefined;
  const warningsList = isSeries ? series?.warnings : !isBookmark ? work?.warnings : undefined;
  const categoryList = isSeries ? series?.category : !isBookmark ? work?.category : undefined;
  const status = isSeries ? series?.status : !isBookmark ? work?.status : bookmark?.status;
  const bookmarkStatusIcon = bookmark?.bookmarkStatusIcon;
  const publishedAt = isSeries ? series?.publishedAt : work?.publishedAt;
  const title = data.title;
  // The card's byline is always "by [the fic's author]" — for a bookmark,
  // that's the underlying work's author (bookmark.workAuthor), matching how
  // AO3 itself shows it. "Bookmarked by [person]" is bookmark-specific
  // metadata and belongs in a separate box below the card, not here.
  const author = isSeries ? series?.author : !isBookmark ? work?.author : bookmark?.workAuthor;
  // A series links to its own /series/ page rather than a /works/ page, so
  // this is kept separate from a generic "data.workUrl" (which a series
  // blurb doesn't have) instead of folding it into `data`.
  const cardUrl = isSeries ? series?.seriesUrl : isBookmark ? bookmark?.workUrl : work?.workUrl;
  const tags = data.tags;
  const fandoms = data.fandoms;
  const extraBadges = data.extraBadges;
  const commaTagItems: Array<{ link: AO3Link; tone: "muted" | "warning"; group: AO3TagGroup }> = [
    ...(tags?.warnings ?? []).map((link) => ({ link, tone: "warning" as const, group: "warnings" as const })),
    ...(tags?.relationships ?? []).map((link) => ({ link, tone: "muted" as const, group: "relationships" as const })),
    ...(tags?.characters ?? []).map((link) => ({ link, tone: "muted" as const, group: "characters" as const })),
    ...(tags?.freeforms ?? []).map((link) => ({ link, tone: "muted" as const, group: "freeforms" as const })),
  ];

  return (
    <Pressable
      onPress={
        // onPressWork's signature only covers work/bookmark presses (there's
        // no "open a series" screen to hand it off to) — a series card's tap
        // always just opens its AO3 page externally.
        !isSeries && onPressWork
          ? () => onPressWork(data as AO3WorkBlurbData | AO3BookmarkData)
          : cardUrl
            ? () => openUrl(cardUrl)
            : undefined
      }
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed, style]}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          {renderRequiredSymbols({
            kind: isBookmark ? "bookmark" : "work",
            requiredTagIcons,
            styles,
          })}

          <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={3}>
            {title}
          </Text>

          {author ? (
            <Pressable
              onPress={
                onPressAuthor
                  ? () => onPressAuthor(author)
                  : author.href
                    ? () => openUrl(author.href)
                    : undefined
              }
            >
              <Text style={styles.byline} numberOfLines={2}>
                by <Text style={styles.bylineAuthor}>{author.label}</Text>
              </Text>
            </Pressable>
          ) : null}
          </View>
        </View>

        <View style={styles.headerMeta}>
          {isBookmark ? <BookmarkStatusBlock icon={bookmarkStatusIcon} count={bookmark?.count} styles={styles} /> : null}
          {!isBookmark && publishedAt ? <Text style={styles.date}>{publishedAt}</Text> : null}
        </View>
      </View>

      {renderLinkList(fandoms, "accent", (item) => onPressTag?.(item, "fandoms"), styles)}

      <View style={styles.requiredTags}>
        {!isBookmark && rating ? (
          <TagPill
            label={rating.label}
            tone="accent"
            styles={styles}
            onPress={rating.href ? () => openUrl(rating.href) : onPressTag ? () => onPressTag(rating, "rating") : undefined}
          />
        ) : null}
        {!isBookmark ? renderLinkList(warningsList, "warning", (item) => onPressTag?.(item, "warnings"), styles) : null}
        {!isBookmark ? renderLinkList(categoryList, "muted", (item) => onPressTag?.(item, "category"), styles) : null}
        {status ? (
          <TagPill
            label={status.label}
            tone={isBookmark ? "accent" : "muted"}
            styles={styles}
            onPress={status.href ? () => openUrl(status.href) : onPressTag ? () => onPressTag(status, "status") : undefined}
          />
        ) : null}
      </View>

      {commaTagItems.length > 0 ? (
        <View style={styles.tagsSection}>
          {renderGroupedCommaLinks(commaTagItems, onPressTag, styles)}
        </View>
      ) : null}

      {!isBookmark && summary ? (
        <View style={styles.summaryBlock}>
          <Text style={styles.sectionLabel}>Summary</Text>
          {summary}
        </View>
      ) : null}

      {!isBookmark && work?.series ? (
        <View style={styles.seriesBlock}>
          <Text style={styles.sectionLabel}>Series</Text>
          <Text style={styles.seriesText}>
            {typeof work.series.part !== "undefined" ? `Part ${work.series.part} of ` : ""}
            {work.series.href ? (
              <Text style={styles.seriesLink} onPress={() => openUrl(work.series?.href)}>
                {work.series.title}
              </Text>
            ) : (
              work.series.title
            )}
          </Text>
        </View>
      ) : null}

      <View style={styles.statsGrid}>
        {[
          ["Language", stats.language],
          ["Words", stats.words],
          ["Chapters", stats.chapters],
          ["Works", stats.works],
          ["Kudos", stats.kudos],
          ["Hits", stats.hits],
          ["Comments", stats.comments],
          ["Bookmarks", stats.bookmarks],
        ].map(([label, value]) => {
          const rendered = formatStat(value);
          if (!rendered) return null;
          return (
            <View key={label} style={styles.statItem}>
              <Text style={styles.statLabel}>{label}</Text>
              <Text style={styles.statValue}>{rendered}</Text>
            </View>
          );
        })}
      </View>

      {extraBadges && extraBadges.length > 0 ? (
        <View style={styles.badgesRow}>
          {extraBadges.map((badge, index) => (
            <TagPill key={`${badge}-${index}`} label={badge} tone="accent" styles={styles} />
          ))}
        </View>
      ) : null}
    </Pressable>
  );
};

// Exported so other files that reuse this component's exported helpers
// (currently just BookmarkOwnerCard, via renderCommaLinkList) can build the
// matching styles object those helpers expect, themed the same way.
export const createAO3WorkBlurbStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  cardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.995 }],
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  titleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  headerMeta: {
    alignItems: "flex-end",
    gap: 6,
  },
  titleBlock: {
    flex: 1,
  },
  requiredSymbolGrid: {
    width: 60,
    height: 56,
    position: "relative",
    flexShrink: 0,
    marginRight: 4,
  },
  requiredSymbolSlot: {
    position: "absolute",
    width: SYMBOL_SIZE,
    height: SYMBOL_SIZE,
  },
  requiredSymbolSlotTopLeft: {
    top: 0,
    left: 0,
  },
  requiredSymbolSlotBottomLeft: {
    top: 28,
    left: 0,
  },
  requiredSymbolSlotTopRight: {
    top: 0,
    left: 28,
  },
  requiredSymbolSlotBottomRight: {
    top: 28,
    left: 28,
  },
  symbolFrame: {
    width: SYMBOL_SIZE,
    height: SYMBOL_SIZE,
    overflow: "hidden",
    position: "relative",
  },
  symbolImage: {
    width: SYMBOL_SPRITE_WIDTH,
    height: SYMBOL_SPRITE_HEIGHT,
    position: "absolute",
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 22,
  },
  byline: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
  bylineAuthor: {
    color: colors.text,
    fontWeight: "600",
  },
  date: {
    color: colors.textFaint,
    fontSize: 12,
    textAlign: "right",
    paddingTop: 2,
  },
  statusBlock: {
    alignItems: "flex-end",
    gap: 4,
  },
  bookmarkStatusGrid: {
    width: 60,
    height: SYMBOL_SIZE,
    position: "relative",
    flexShrink: 0,
  },
  bookmarkSlotLeft: {
    position: "absolute",
    left: 0,
    top: 0,
    width: SYMBOL_SIZE,
    height: SYMBOL_SIZE,
  },
  bookmarkSlotRight: {
    position: "absolute",
    left: 28,
    top: 0,
    width: SYMBOL_SIZE,
    height: SYMBOL_SIZE,
  },
  bookmarkCountFrame: {
    width: SYMBOL_SIZE,
    height: SYMBOL_SIZE,
    overflow: "hidden",
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  bookmarkCountText: {
    position: "absolute",
    color: "#006699",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    width: SYMBOL_SIZE,
    height: SYMBOL_SIZE,
    lineHeight: SYMBOL_SIZE,
  },
  requiredTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagsSection: {
    gap: 8,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tagPill: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tagPillWarning: {
    backgroundColor: "rgba(198, 67, 82, 0.12)",
    borderColor: "rgba(198, 67, 82, 0.35)",
  },
  tagPillAccent: {
    backgroundColor: hexToRgba(colors.accent, 0.12),
    borderColor: hexToRgba(colors.accent, 0.35),
  },
  tagText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  tagTextWarning: {
    color: "#f1a3ad",
  },
  tagTextAccent: {
    color: colors.accent,
  },
  summaryBlock: {
    gap: 8,
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  summaryText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  seriesBlock: {
    gap: 6,
  },
  seriesText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  seriesLink: {
    color: colors.accent,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingTop: 4,
  },
  statItem: {
    minWidth: "30%",
    flexGrow: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statLabel: {
    color: colors.textFaint,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  statValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  commaTagsRow: {
    color: colors.text,
    lineHeight: 18,
  },
  commaTagText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    textDecorationLine: "underline",
  },
  commaTagSeparator: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
  },
  commaTagTextWarning: {
    color: colors.text,
    fontWeight: "700",
  },
  commaTagTextAccent: {
    borderBottomColor: colors.text,
  },
});

// Memoized since this does a fair amount of work per card (sprite/symbol
// lookups, tag-list building, stats formatting) and is rendered as a
// FlatList/SectionList row — skipping re-renders when a card's own props
// haven't changed matters for keeping unrelated state changes elsewhere on
// the screen (like toggling the filter panel) from re-rendering every
// visible card.
export default React.memo(AO3WorkBlurb);