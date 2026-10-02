import React, { useMemo } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AO3BookmarkData, createAO3WorkBlurbStyles, renderCommaLinkList } from "./AO3WorkBlurb";
import { extractUsernameFromUsersUrl } from "../api/ao3Bookmarks";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";

// The bookmarker's own info (who bookmarked it, when, their personal tags,
// their notes) is metadata *about the bookmark*, not the work itself — shown
// as a separate box below the main card. When the viewer owns the bookmark
// (isOwnUser), this also renders the Edit/Delete/Add to Collection/Share
// actions AO3 itself shows in that case. Shared between AO3ListingScreen's
// "recent bookmarks" section and AO3BookmarksScreen's full bookmarks list.
interface Props {
  bookmark: AO3BookmarkData;
  isOwnUser: boolean;
  removing: boolean;
  onEdit: (href: string) => void;
  onDelete: (bookmark: AO3BookmarkData) => void;
  onAddToCollection: (href: string) => void;
  onShare: (href: string) => void;
  // When given, tapping the "Bookmarked by X" byline navigates in-app
  // instead of opening the profile in the external browser.
  onPressBookmarker?: (username: string) => void;
}

const BookmarkOwnerCard: React.FC<Props> = ({
  bookmark,
  isOwnUser,
  removing,
  onEdit,
  onDelete,
  onAddToCollection,
  onShare,
  onPressBookmarker,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // renderCommaLinkList (from AO3WorkBlurb) expects that component's own
  // styles shape, not this card's — built here too so the bookmarker tags
  // line stays themed consistently with the rest of the app's tag chips.
  const commaLinkStyles = useMemo(() => createAO3WorkBlurbStyles(colors), [colors]);
  const hasByline = !!(bookmark.bookmarker || bookmark.datetime);
  const hasTags = !!(bookmark.userMeta && bookmark.userMeta.length > 0);
  const hasNotes = !!bookmark.summary;
  const actions = isOwnUser ? bookmark.ownActions : undefined;
  const hasActions =
    !!actions && !!(actions.editHref || actions.deleteHref || actions.addToCollectionHref || actions.shareHref);

  if (!hasByline && !hasTags && !hasNotes && !hasActions) return null;

  const handlePressBookmarker = () => {
    const href = bookmark.bookmarker?.href;
    const username = extractUsernameFromUsersUrl(href);
    if (onPressBookmarker && username) {
      onPressBookmarker(username);
    } else if (href) {
      Linking.openURL(href);
    }
  };

  return (
    <View style={styles.card}>
      {hasByline ? (
        <Text style={styles.byline}>
          {bookmark.bookmarker ? (
            <>
              Bookmarked by{" "}
              <Text style={styles.bookmarkerLink} onPress={bookmark.bookmarker.href ? handlePressBookmarker : undefined}>
                {bookmark.bookmarker.label}
              </Text>
            </>
          ) : null}
          {bookmark.datetime ? (
            <Text style={styles.date}>
              {bookmark.bookmarker ? "  ·  " : ""}
              {bookmark.datetime}
            </Text>
          ) : null}
        </Text>
      ) : null}

      {hasTags ? (
        <View style={styles.block}>
          <Text style={styles.label}>Bookmarker's Tags</Text>
          {renderCommaLinkList(bookmark.userMeta, "muted", undefined, commaLinkStyles)}
        </View>
      ) : null}

      {hasNotes ? (
        <View style={styles.block}>
          <Text style={styles.label}>Notes</Text>
          <Text style={styles.notes}>{bookmark.summary}</Text>
        </View>
      ) : null}

      {hasActions ? (
        <View style={styles.actionsRow}>
          {actions?.editHref ? (
            <TouchableOpacity style={styles.actionBtn} onPress={() => onEdit(actions.editHref!)}>
              <Ionicons name="pencil-outline" size={14} color={colors.textMuted} />
              <Text style={styles.actionText}>Edit</Text>
            </TouchableOpacity>
          ) : null}
          {actions?.addToCollectionHref ? (
            <TouchableOpacity style={styles.actionBtn} onPress={() => onAddToCollection(actions.addToCollectionHref!)}>
              <Ionicons name="albums-outline" size={14} color={colors.textMuted} />
              <Text style={styles.actionText}>Add to Collection</Text>
            </TouchableOpacity>
          ) : null}
          {actions?.shareHref ? (
            <TouchableOpacity style={styles.actionBtn} onPress={() => onShare(actions.shareHref!)}>
              <Ionicons name="share-social-outline" size={14} color={colors.textMuted} />
              <Text style={styles.actionText}>Share</Text>
            </TouchableOpacity>
          ) : null}
          {actions?.deleteHref ? (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnDanger]}
              onPress={() => onDelete(bookmark)}
              disabled={removing}
            >
              {removing ? (
                <ActivityIndicator size="small" color={colors.danger} />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={14} color={colors.danger} />
                  <Text style={[styles.actionText, styles.actionTextDanger]}>Delete</Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    marginTop: 8,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  byline: {
    color: colors.textMuted,
    fontSize: 13,
  },
  bookmarkerLink: {
    color: colors.accent,
    fontWeight: "700",
  },
  date: {
    color: colors.textFaint,
  },
  block: {
    gap: 4,
  },
  label: {
    color: colors.textFaint,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  notes: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 2,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionBtnDanger: {
    borderColor: "rgba(198, 67, 82, 0.35)",
  },
  actionText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  actionTextDanger: {
    color: colors.danger,
  },
});

// Memoized for the same reason as AO3WorkBlurb — a FlatList row shouldn't
// re-render just because unrelated state elsewhere on the screen changed.
export default React.memo(BookmarkOwnerCard);
