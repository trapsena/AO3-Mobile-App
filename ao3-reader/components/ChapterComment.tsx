import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";

// AO3's limit for one comment (its own form counts down from this).
export const MAX_COMMENT_LENGTH = 10000;

interface Props {
  // Whether AO3 has offered a comment form for this chapter yet.
  available: boolean;
  // True while the page (and with it the form) is still being fetched.
  loading: boolean;
  // The name the comment will be posted under — "Comment as <name>".
  postingAs?: string;
  submitting: boolean;
  // Resolves true when AO3 accepted the comment, which clears the box; on false
  // (the caller has already told the person why) the text is kept to retry.
  onSubmit: (text: string) => Promise<boolean>;
}

// "Comment as <you>" box for the chapter being read, at the top of the comments
// drawer: AO3's own top-level comment form (plain text with limited HTML, a
// 10000 character limit and its live "characters left" count). The text is
// local state, so typing re-renders only this box and not the whole thread.
const ChapterComment: React.FC<Props> = ({ available, loading, postingAs, submitting, onSubmit }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [text, setText] = useState("");

  const left = MAX_COMMENT_LENGTH - text.length;
  const canSubmit = available && !submitting && text.trim().length > 0 && left >= 0;

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (await onSubmit(trimmed)) setText("");
  }, [text, onSubmit]);

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>
        Comment as {postingAs ? <Text style={styles.byline}>{postingAs}</Text> : "you"}
      </Text>

      {!available ? (
        loading ? (
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.statusText}>Loading comment form...</Text>
          </View>
        ) : (
          <Text style={styles.statusText}>Comments aren't available for this chapter.</Text>
        )
      ) : (
        <>
          <Text style={styles.footnote}>Plain text with limited HTML</Text>
          <TextInput
            style={styles.input}
            placeholder="Write a comment..."
            placeholderTextColor={colors.textFaint}
            value={text}
            onChangeText={setText}
            editable={!submitting}
            multiline
            textAlignVertical="top"
          />
          <View style={styles.footerRow}>
            <Text style={[styles.counter, left < 0 && styles.counterOver]}>
              {left >= 0 ? `${left} characters left` : `${-left} characters over the limit`}
            </Text>
            <TouchableOpacity
              style={[styles.submit, !canSubmit && styles.submitDisabled]}
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={colors.accentText} />
              ) : (
                <Text style={styles.submitText}>Comment</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
};

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    box: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 14,
      gap: 10,
      marginTop: 8,
    },
    heading: { color: colors.text, fontSize: 15 },
    byline: { color: colors.accent, fontWeight: "700" },
    footnote: { color: colors.textFaint, fontSize: 12, textAlign: "right" },
    input: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.text,
      fontSize: 14,
      minHeight: 110,
      maxHeight: 260,
    },
    footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
    counter: { color: colors.textFaint, fontSize: 12, flexShrink: 1 },
    counterOver: { color: colors.danger },
    submit: {
      minWidth: 96,
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: 8,
      backgroundColor: colors.accent,
    },
    submitDisabled: { opacity: 0.5 },
    submitText: { color: colors.accentText, fontWeight: "700", fontSize: 14 },
    statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    statusText: { color: colors.textFaint, fontSize: 13 },
  });

export default ChapterComment;
