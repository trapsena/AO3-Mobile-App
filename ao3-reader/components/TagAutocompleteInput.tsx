import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  NativeSyntheticEvent,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import { AO3TagSuggestion, fetchTagAutocomplete } from "../api/ao3Autocomplete";

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  placeholderTextColor?: string;
  style?: StyleProp<TextStyle>;
}

const splitTags = (value: string) =>
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const TagAutocompleteInput: React.FC<Props> = ({
  value,
  onChangeText,
  placeholder,
  placeholderTextColor,
  style,
}) => {
  // Already-committed tags render as removable chips above the text box —
  // matching AO3's own "added tag" pills — while `draft` is just whatever's
  // being typed for the *next* tag and isn't part of `value` until it's
  // committed (by picking a suggestion, typing a comma, or hitting return).
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<AO3TagSuggestion[]>([]);
  const [highlightTerm, setHighlightTerm] = useState("");
  const [loading, setLoading] = useState(false);

  const chips = useMemo(() => splitTags(value), [value]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every keystroke so a slow, now-stale request can't clobber
  // suggestions for whatever's actually in the box by the time it resolves.
  const requestSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blurRef.current) clearTimeout(blurRef.current);
    };
  }, []);

  const scheduleFetch = useCallback((term: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = term.trim();
    const seq = ++requestSeqRef.current;

    if (!trimmed) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const results = await fetchTagAutocomplete(trimmed);
      if (seq !== requestSeqRef.current) return;
      setHighlightTerm(trimmed);
      setSuggestions(results);
      setLoading(false);
    }, 400);
  }, []);

  const commitTags = useCallback(
    (newTags: string[]) => {
      if (newTags.length === 0) return;
      onChangeText([...chips, ...newTags].join(", "));
    },
    [chips, onChangeText],
  );

  const handleChangeText = useCallback(
    (text: string) => {
      if (text.includes(",")) {
        // Typing or pasting a comma commits everything before it as its own
        // tag (supports pasting several at once), leaving only the part
        // after the last comma as the still-being-typed draft.
        const parts = text.split(",");
        const toCommit = parts.slice(0, -1).map((p) => p.trim()).filter(Boolean);
        const remainder = parts[parts.length - 1];
        commitTags(toCommit);
        setDraft(remainder);
        scheduleFetch(remainder);
        return;
      }
      setDraft(text);
      scheduleFetch(text);
    },
    [commitTags, scheduleFetch],
  );

  const clearSuggestions = useCallback(() => {
    requestSeqRef.current++;
    setSuggestions([]);
    setLoading(false);
  }, []);

  const handleSelect = useCallback(
    (suggestion: AO3TagSuggestion) => {
      if (blurRef.current) clearTimeout(blurRef.current);
      // AO3's autocomplete/tag endpoint returns { id, name } where `id` is
      // the tag's canonical identifier — for freeform tags that's the same
      // string as `name`, but it's the field that should be treated as
      // authoritative, so committed chips are built from it.
      commitTags([suggestion.id]);
      setDraft("");
      clearSuggestions();
    },
    [commitTags, clearSuggestions],
  );

  const commitDraft = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    commitTags([trimmed]);
    setDraft("");
    clearSuggestions();
  }, [draft, commitTags, clearSuggestions]);

  const removeChip = useCallback(
    (index: number) => {
      onChangeText(chips.filter((_, i) => i !== index).join(", "));
    },
    [chips, onChangeText],
  );

  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      // Backspacing on an empty draft deletes the last committed chip
      // instead — the usual tag-input convention.
      if (e.nativeEvent.key === "Backspace" && draft === "" && chips.length > 0) {
        removeChip(chips.length - 1);
      }
    },
    [draft, chips, removeChip],
  );

  const handleBlur = useCallback(() => {
    // Delay so a tap on a suggestion below still lands before the dropdown
    // unmounts out from under it.
    blurRef.current = setTimeout(() => clearSuggestions(), 150);
  }, [clearSuggestions]);

  const showDropdown = loading || suggestions.length > 0;

  return (
    <View style={styles.wrapper}>
      {chips.length > 0 ? (
        <View style={styles.chipRow}>
          {chips.map((chip, index) => (
            <View key={`${chip}-${index}`} style={styles.chip}>
              <Text style={styles.chipText}>{chip}</Text>
              <TouchableOpacity
                onPress={() => removeChip(index)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                style={styles.chipRemoveBtn}
              >
                <Text style={styles.chipRemoveText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      <TextInput
        style={style}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        value={draft}
        onChangeText={handleChangeText}
        onKeyPress={handleKeyPress}
        onSubmitEditing={commitDraft}
        onBlur={handleBlur}
        blurOnSubmit={false}
      />

      {showDropdown ? (
        <View style={styles.dropdown}>
          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#7ec14b" />
            </View>
          ) : (
            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="always" style={styles.suggestionList}>
              {suggestions.map((item) => (
                <TouchableOpacity key={item.id} style={styles.suggestionRow} onPress={() => handleSelect(item)}>
                  <HighlightedText text={item.name} highlight={highlightTerm} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
};

const HighlightedText: React.FC<{ text: string; highlight: string }> = ({ text, highlight }) => {
  const index = highlight ? text.toLowerCase().indexOf(highlight.toLowerCase()) : -1;
  if (index === -1) {
    return (
      <Text style={styles.suggestionText} numberOfLines={2}>
        {text}
      </Text>
    );
  }

  const before = text.slice(0, index);
  const match = text.slice(index, index + highlight.length);
  const after = text.slice(index + highlight.length);

  return (
    <Text style={styles.suggestionText} numberOfLines={2}>
      {before}
      <Text style={styles.suggestionMatch}>{match}</Text>
      {after}
    </Text>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: "relative",
    zIndex: 10,
  } as ViewStyle,
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 999,
    paddingLeft: 10,
    paddingRight: 4,
    paddingVertical: 4,
    gap: 6,
  },
  chipText: {
    color: "#eee",
    fontSize: 12,
  },
  chipRemoveBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#444",
    alignItems: "center",
    justifyContent: "center",
  },
  chipRemoveText: {
    color: "#999",
    fontSize: 11,
    lineHeight: 13,
  },
  dropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 4,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 8,
    maxHeight: 240,
    overflow: "hidden",
    zIndex: 20,
    elevation: 8,
  },
  loadingRow: {
    paddingVertical: 10,
    alignItems: "center",
  },
  suggestionList: {
    maxHeight: 240,
  },
  suggestionRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  suggestionText: {
    color: "#ccc",
    fontSize: 13,
  },
  suggestionMatch: {
    color: "#fff",
    fontWeight: "700",
  },
});

export default TagAutocompleteInput;
