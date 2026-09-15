import React from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AO3BookmarkData, renderCommaLinkList } from "./AO3WorkBlurb";
import { extractUsernameFromUsersUrl } from "../api/ao3Bookmarks";

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
          {renderCommaLinkList(bookmark.userMeta, "muted")}
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
              <Ionicons name="pencil-outline" size={14} color="#ddd" />
              <Text style={styles.actionText}>Edit</Text>
            </TouchableOpacity>
          ) : null}
          {actions?.addToCollectionHref ? (
            <TouchableOpacity style={styles.actionBtn} onPress={() => onAddToCollection(actions.addToCollectionHref!)}>
              <Ionicons name="albums-outline" size={14} color="#ddd" />
              <Text style={styles.actionText}>Add to Collection</Text>
            </TouchableOpacity>
          ) : null}
          {actions?.shareHref ? (
            <TouchableOpacity style={styles.actionBtn} onPress={() => onShare(actions.shareHref!)}>
              <Ionicons name="share-social-outline" size={14} color="#ddd" />
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
                <ActivityIndicator size="small" color="#f66" />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={14} color="#f66" />
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

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    backgroundColor: "#161616",
    borderWidth: 1,
    borderColor: "#262626",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  byline: {
    color: "#c7c7c7",
    fontSize: 13,
  },
  bookmarkerLink: {
    color: "#7ec14b",
    fontWeight: "700",
  },
  date: {
    color: "#8b8b8b",
  },
  block: {
    gap: 4,
  },
  label: {
    color: "#8c8c8c",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  notes: {
    color: "#efefef",
    fontSize: 14,
    lineHeight: 20,
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#262626",
    marginTop: 2,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#1c1c1c",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  actionBtnDanger: {
    borderColor: "rgba(198, 67, 82, 0.35)",
  },
  actionText: {
    color: "#ddd",
    fontSize: 12,
    fontWeight: "600",
  },
  actionTextDanger: {
    color: "#f66",
  },
});

export default BookmarkOwnerCard;
