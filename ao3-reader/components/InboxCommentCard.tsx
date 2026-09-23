import React, { useCallback, useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AO3InboxComment } from "../api/ao3InboxTypes";
import type { AO3Link } from "./AO3WorkBlurb";

// Long enough that collapsing it is worth an extra tap (some authors reply
// with multi-thousand-character essays).
const COLLAPSE_THRESHOLD = 420;

interface Props {
  comment: AO3InboxComment;
  selected: boolean;
  onToggleSelect: (inboxId: string) => void;
  onPressAuthor?: (author: AO3Link) => void;
  // Called with the work URL when the comment's target title is tapped.
  onOpenWork?: (workUrl: string) => void;
  // Opens the comment's thread on AO3 — the inbox's own reply link is
  // AJAX-only, so replying happens there.
  onReply: (comment: AO3InboxComment) => void;
}

const InboxCommentCard: React.FC<Props> = ({
  comment,
  selected,
  onToggleSelect,
  onPressAuthor,
  onOpenWork,
  onReply,
}) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = comment.body.length > COLLAPSE_THRESHOLD;

  const handleAuthor = useCallback(() => {
    if (comment.author) onPressAuthor?.(comment.author);
  }, [comment.author, onPressAuthor]);

  const handleTarget = useCallback(() => {
    if (comment.workUrl && onOpenWork) onOpenWork(comment.workUrl);
    else if (comment.targetHref) onReply(comment);
  }, [comment, onOpenWork, onReply]);

  const handleSelect = useCallback(() => onToggleSelect(comment.inboxId), [onToggleSelect, comment.inboxId]);
  const handleReply = useCallback(() => onReply(comment), [onReply, comment]);
  const handleToggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);

  return (
    <View style={[styles.card, !comment.isRead && styles.cardUnread, selected && styles.cardSelected]}>
      <View style={styles.topRow}>
        {comment.avatarUrl ? (
          <Image source={{ uri: comment.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]} />
        )}

        <View style={styles.main}>
          <Text style={styles.byline}>
            <Text style={styles.author} onPress={comment.author ? handleAuthor : undefined}>
              {comment.author?.label ?? "Anonymous"}
            </Text>
            {comment.targetLabel ? (
              <>
                <Text style={styles.on}> on </Text>
                <Text style={styles.target} onPress={handleTarget}>
                  {comment.targetLabel}
                </Text>
              </>
            ) : null}
          </Text>
          {comment.datetime ? <Text style={styles.date}>{comment.datetime}</Text> : null}
        </View>
      </View>

      {comment.body ? (
        <View>
          <Text style={styles.body} numberOfLines={expanded ? undefined : isLong ? 8 : undefined}>
            {comment.body}
          </Text>
          {isLong ? (
            <TouchableOpacity onPress={handleToggleExpanded} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={styles.moreToggle}>{expanded ? "Show less" : "Show more"}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actionsRow}>
        <View style={styles.badges}>
          {!comment.isRead ? (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>New</Text>
            </View>
          ) : null}
          {comment.isReplied ? (
            <View style={styles.repliedBadge}>
              <Ionicons name="checkmark-done" size={13} color="#7ec14b" />
              <Text style={styles.repliedText}>Replied</Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity style={styles.actionBtn} onPress={handleReply}>
          <Ionicons name="arrow-undo-outline" size={14} color="#ddd" />
          <Text style={styles.actionText}>Reply</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, selected && styles.actionBtnSelected]}
          onPress={handleSelect}
        >
          <Ionicons
            name={selected ? "checkbox" : "square-outline"}
            size={15}
            color={selected ? "#7ec14b" : "#ddd"}
          />
          <Text style={styles.actionText}>Select</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  cardUnread: {
    borderLeftWidth: 3,
    borderLeftColor: "#7ec14b",
  },
  cardSelected: {
    borderColor: "#7ec14b",
    backgroundColor: "#141a10",
  },
  topRow: {
    flexDirection: "row",
    gap: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderWidth: 1,
    borderColor: "#333",
  },
  avatarPlaceholder: {
    backgroundColor: "#1c1c1c",
  },
  main: {
    flex: 1,
    gap: 3,
  },
  byline: {
    color: "#a6a6a6",
    fontSize: 14,
    lineHeight: 19,
  },
  author: {
    color: "#7ec14b",
    fontWeight: "700",
  },
  on: {
    color: "#8b8b8b",
  },
  target: {
    color: "#d6d6d6",
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  date: {
    color: "#8b8b8b",
    fontSize: 12,
  },
  body: {
    color: "#efefef",
    fontSize: 14,
    lineHeight: 20,
  },
  moreToggle: {
    color: "#7ec14b",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#222",
  },
  badges: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  newBadge: {
    backgroundColor: "#7ec14b",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  newBadgeText: {
    color: "#000",
    fontSize: 10,
    fontWeight: "800",
  },
  repliedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  repliedText: {
    color: "#7ec14b",
    fontSize: 11,
    fontWeight: "600",
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
  actionBtnSelected: {
    borderColor: "#7ec14b",
  },
  actionText: {
    color: "#ddd",
    fontSize: 12,
    fontWeight: "600",
  },
});

// Memoized: the inbox list re-renders whenever any row's selection changes,
// but only the toggled row's props actually differ.
export default React.memo(InboxCommentCard);
