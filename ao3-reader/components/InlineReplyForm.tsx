import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";

// AO3's own comment threads (and its Inbox) load this inline, right where
// the comment sits, once you tap Reply — rather than sending you to the
// comment's page in the browser. Its text lives in local state (not lifted
// to the caller) specifically so typing only re-renders this one form, not
// whatever list of comments it's embedded in.
interface Props {
  loading: boolean;
  error: string | null;
  submitting: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  // Lets each screen match its own existing accent color (e.g. the Inbox's
  // green vs. the Reader's teal) without forking this component.
  accentColor?: string;
}

const InlineReplyForm: React.FC<Props> = ({
  loading,
  error,
  submitting,
  onSubmit,
  onCancel,
  accentColor,
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const resolvedAccentColor = accentColor ?? colors.accent;
  const [text, setText] = useState("");

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }, [text, onSubmit]);

  const canSubmit = !!text.trim() && !submitting;

  return (
    <View style={styles.replyBox}>
      {loading ? (
        <View style={styles.replyLoadingRow}>
          <ActivityIndicator size="small" color={resolvedAccentColor} />
          <Text style={styles.replyLoadingText}>Loading reply form...</Text>
        </View>
      ) : error ? (
        <Text style={styles.replyErrorText}>{error}</Text>
      ) : (
        <>
          <TextInput
            style={styles.replyInput}
            placeholder="Write a reply..."
            placeholderTextColor={colors.textFaint}
            value={text}
            onChangeText={setText}
            editable={!submitting}
            multiline
            textAlignVertical="top"
          />
          <View style={styles.replyActionsRow}>
            <TouchableOpacity style={styles.replyCancelBtn} onPress={onCancel} disabled={submitting}>
              <Text style={styles.replyCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.replySubmitBtn,
                { backgroundColor: resolvedAccentColor },
                !canSubmit && styles.replySubmitBtnDisabled,
              ]}
              onPress={handleSubmit}
              disabled={!canSubmit}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={colors.accentText} />
              ) : (
                <Text style={styles.replySubmitText}>Comment</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  replyBox: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  replyLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  replyLoadingText: {
    color: colors.textFaint,
    fontSize: 13,
  },
  replyErrorText: {
    color: colors.danger,
    fontSize: 13,
  },
  replyInput: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 14,
    minHeight: 90,
  },
  replyActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  replyCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  replyCancelText: {
    color: colors.textMuted,
    fontWeight: "600",
    fontSize: 13,
  },
  replySubmitBtn: {
    minWidth: 88,
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  replySubmitBtnDisabled: {
    opacity: 0.5,
  },
  replySubmitText: {
    color: colors.accentText,
    fontWeight: "700",
    fontSize: 13,
  },
});

export default InlineReplyForm;
