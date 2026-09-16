import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  AO3FacetTagType,
  AO3FilterFacetOption,
  AO3FilterFacets,
  AO3FilterKind,
  AO3FilterSelection,
  BOOKMARK_FACET_TAG_TYPES,
  WORK_FACET_TAG_TYPES,
} from "../api/ao3FilterTypes";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const PANEL_WIDTH = Math.min(340, SCREEN_WIDTH * 0.88);

const FACET_LABELS: Record<AO3FacetTagType, string> = {
  rating: "Rating",
  archive_warning: "Archive Warning",
  category: "Category",
  fandom: "Fandom",
  character: "Character",
  relationship: "Relationship",
  freeform: "Additional Tags",
  tag: "Bookmarker's Tags",
};

interface Props {
  visible: boolean;
  onClose: () => void;
  kind: AO3FilterKind;
  facets: AO3FilterFacets;
  value: AO3FilterSelection;
  onChange: (next: AO3FilterSelection) => void;
  onApply: () => void;
  onClear?: () => void;
}

type TriState = "include" | "exclude" | undefined;

const AO3FilterPanel: React.FC<Props> = ({ visible, onClose, kind, facets, value, onChange, onApply, onClear }) => {
  const translateX = useRef(new Animated.Value(PANEL_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [expanded, setExpanded] = useState<Partial<Record<AO3FacetTagType, boolean>>>({});

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateX, { toValue: visible ? 0 : PANEL_WIDTH, duration: 260, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: visible ? 1 : 0, duration: 260, useNativeDriver: true }),
    ]).start();
  }, [visible, translateX, backdropOpacity]);

  const tagTypes = useMemo(
    () => (kind === "bookmarks" ? BOOKMARK_FACET_TAG_TYPES : WORK_FACET_TAG_TYPES),
    [kind],
  );

  const triStateFor = (tagType: AO3FacetTagType, id: string): TriState => {
    if (value.includeTagIds?.[tagType]?.includes(id)) return "include";
    if (value.excludeTagIds?.[tagType]?.includes(id)) return "exclude";
    return undefined;
  };

  const cycleTriState = (tagType: AO3FacetTagType, id: string) => {
    const current = triStateFor(tagType, id);
    const withoutId = (ids?: string[]) => (ids || []).filter((existing) => existing !== id);

    const nextInclude = { ...value.includeTagIds };
    const nextExclude = { ...value.excludeTagIds };
    nextInclude[tagType] = withoutId(nextInclude[tagType]);
    nextExclude[tagType] = withoutId(nextExclude[tagType]);

    if (current === undefined) {
      nextInclude[tagType] = [...(nextInclude[tagType] || []), id];
    } else if (current === "include") {
      nextExclude[tagType] = [...(nextExclude[tagType] || []), id];
    }
    // current === "exclude" -> falls through to fully cleared (already removed above)

    onChange({ ...value, includeTagIds: nextInclude, excludeTagIds: nextExclude });
  };

  const toggleCollectionId = (id: string) => {
    const current = value.collectionIds || [];
    const next = current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id];
    onChange({ ...value, collectionIds: next });
  };

  const set = <K extends keyof AO3FilterSelection>(key: K, val: AO3FilterSelection[K]) => {
    onChange({ ...value, [key]: val });
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "auto" : "none"}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.panel, { transform: [{ translateX }] }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Filters</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Sort by — every kind has this */}
          {facets.sortOptions.length > 0 ? (
            <Section title="Sort by">
              <View style={styles.chipRow}>
                {facets.sortOptions.map((opt) => (
                  <Chip
                    key={opt.value}
                    label={opt.label}
                    active={value.sortColumn ? value.sortColumn === opt.value : !!opt.selected}
                    onPress={() => set("sortColumn", opt.value)}
                  />
                ))}
              </View>
            </Section>
          ) : null}

          {/* Collection picker — collection-works only */}
          {kind === "collection-works" ? (
            <Section title="Collection">
              {(facets.collections || []).map((c) => (
                <FacetCheckboxRow
                  key={c.id}
                  option={c}
                  checked={(value.collectionIds || []).includes(c.id)}
                  onPress={() => toggleCollectionId(c.id)}
                />
              ))}
            </Section>
          ) : null}

          {/* Tag facet groups — works + bookmarks only */}
          {kind !== "collection-works"
            ? tagTypes.map((tagType) => {
                const options = facets.tagFacets?.[tagType] || [];
                if (options.length === 0) return null;
                const isOpen = !!expanded[tagType];
                return (
                  <View key={tagType} style={styles.section}>
                    <TouchableOpacity
                      style={styles.sectionHeader}
                      onPress={() => setExpanded((prev) => ({ ...prev, [tagType]: !prev[tagType] }))}
                    >
                      <Text style={styles.sectionTitle}>{FACET_LABELS[tagType]}</Text>
                      <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={18} color="#999" />
                    </TouchableOpacity>
                    {isOpen ? (
                      <View style={styles.chipRow}>
                        {options.map((opt) => {
                          const state = triStateFor(tagType, opt.id);
                          return (
                            <TriStateChip
                              key={opt.id}
                              option={opt}
                              state={state}
                              onPress={() => cycleTriState(tagType, opt.id)}
                            />
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })
            : null}

          {/* Free-text tag entry — works + bookmarks */}
          {kind !== "collection-works" ? (
            <Section title="Other tags to include">
              <TextInput
                style={styles.textInput}
                placeholder="Comma-separated tag names"
                placeholderTextColor="#666"
                value={value.otherTagNames || ""}
                onChangeText={(t) => set("otherTagNames", t)}
              />
            </Section>
          ) : null}
          {kind !== "collection-works" ? (
            <Section title="Other tags to exclude">
              <TextInput
                style={styles.textInput}
                placeholder="Comma-separated tag names"
                placeholderTextColor="#666"
                value={value.excludedTagNames || ""}
                onChangeText={(t) => set("excludedTagNames", t)}
              />
            </Section>
          ) : null}

          {/* Bookmarker's own tags — bookmarks only */}
          {kind === "bookmarks" ? (
            <Section title="Other bookmarker's tags to include">
              <TextInput
                style={styles.textInput}
                placeholder="Comma-separated tag names"
                placeholderTextColor="#666"
                value={value.otherBookmarkTagNames || ""}
                onChangeText={(t) => set("otherBookmarkTagNames", t)}
              />
            </Section>
          ) : null}
          {kind === "bookmarks" ? (
            <Section title="Other bookmarker's tags to exclude">
              <TextInput
                style={styles.textInput}
                placeholder="Comma-separated tag names"
                placeholderTextColor="#666"
                value={value.excludedBookmarkTagNames || ""}
                onChangeText={(t) => set("excludedBookmarkTagNames", t)}
              />
            </Section>
          ) : null}

          {/* Crossover / Completion — works only */}
          {kind === "works" ? (
            <Section title="Crossovers">
              <View style={styles.chipRow}>
                <Chip label="Include" active={value.crossover === ""} onPress={() => set("crossover", "")} />
                <Chip label="Exclude" active={value.crossover === "F"} onPress={() => set("crossover", "F")} />
                <Chip label="Only" active={value.crossover === "T"} onPress={() => set("crossover", "T")} />
              </View>
            </Section>
          ) : null}
          {kind === "works" ? (
            <Section title="Completion Status">
              <View style={styles.chipRow}>
                <Chip label="All" active={value.complete === ""} onPress={() => set("complete", "")} />
                <Chip label="Complete" active={value.complete === "T"} onPress={() => set("complete", "T")} />
                <Chip label="WIP" active={value.complete === "F"} onPress={() => set("complete", "F")} />
              </View>
            </Section>
          ) : null}

          {/* Word count — works + bookmarks */}
          {kind !== "collection-works" ? (
            <Section title="Word Count">
              <View style={styles.rangeRow}>
                <TextInput
                  style={[styles.textInput, styles.rangeInput]}
                  placeholder="From"
                  placeholderTextColor="#666"
                  keyboardType="number-pad"
                  value={value.wordsFrom || ""}
                  onChangeText={(t) => set("wordsFrom", t)}
                />
                <TextInput
                  style={[styles.textInput, styles.rangeInput]}
                  placeholder="To"
                  placeholderTextColor="#666"
                  keyboardType="number-pad"
                  value={value.wordsTo || ""}
                  onChangeText={(t) => set("wordsTo", t)}
                />
              </View>
            </Section>
          ) : null}

          {/* Date updated — works only */}
          {kind === "works" ? (
            <Section title="Date Updated">
              <View style={styles.rangeRow}>
                <TextInput
                  style={[styles.textInput, styles.rangeInput]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#666"
                  value={value.dateFrom || ""}
                  onChangeText={(t) => set("dateFrom", t)}
                />
                <TextInput
                  style={[styles.textInput, styles.rangeInput]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#666"
                  value={value.dateTo || ""}
                  onChangeText={(t) => set("dateTo", t)}
                />
              </View>
            </Section>
          ) : null}

          {/* Search within results — works + bookmarks (different labels) */}
          {kind !== "collection-works" ? (
            <Section title="Search within results">
              <TextInput
                style={styles.textInput}
                placeholder="Search text"
                placeholderTextColor="#666"
                value={value.query || ""}
                onChangeText={(t) => set("query", t)}
              />
            </Section>
          ) : null}
          {kind === "bookmarks" ? (
            <Section title="Search bookmarker's tags and notes">
              <TextInput
                style={styles.textInput}
                placeholder="Search text"
                placeholderTextColor="#666"
                value={value.bookmarkQuery || ""}
                onChangeText={(t) => set("bookmarkQuery", t)}
              />
            </Section>
          ) : null}

          {/* Bookmark types — bookmarks only */}
          {kind === "bookmarks" ? (
            <Section title="Bookmark Types">
              <ToggleRow label="Recs only" value={!!value.recOnly} onToggle={() => set("recOnly", !value.recOnly)} />
              <ToggleRow
                label="Only bookmarks with notes"
                value={!!value.withNotesOnly}
                onToggle={() => set("withNotesOnly", !value.withNotesOnly)}
              />
            </Section>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          {onClear ? (
            <TouchableOpacity style={styles.clearBtn} onPress={onClear}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.applyBtn}
            onPress={() => {
              onApply();
              onClose();
            }}
          >
            <Text style={styles.applyBtnText}>Sort and Filter</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
};

/* ------------------------------------------------------------------ */

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const Chip: React.FC<{ label: string; active?: boolean; onPress: () => void }> = ({ label, active, onPress }) => (
  <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const TriStateChip: React.FC<{ option: AO3FilterFacetOption; state: TriState; onPress: () => void }> = ({
  option,
  state,
  onPress,
}) => (
  <TouchableOpacity
    style={[styles.chip, state === "include" && styles.chipInclude, state === "exclude" && styles.chipExclude]}
    onPress={onPress}
  >
    {state === "include" ? <Ionicons name="add" size={13} color="#000" style={styles.chipIcon} /> : null}
    {state === "exclude" ? <Ionicons name="remove" size={13} color="#fff" style={styles.chipIcon} /> : null}
    <Text
      style={[
        styles.chipText,
        state === "include" && styles.chipTextInclude,
        state === "exclude" && styles.chipTextExclude,
      ]}
    >
      {option.name}
      {option.count !== undefined ? ` (${option.count})` : ""}
    </Text>
  </TouchableOpacity>
);

const FacetCheckboxRow: React.FC<{ option: AO3FilterFacetOption; checked: boolean; onPress: () => void }> = ({
  option,
  checked,
  onPress,
}) => (
  <TouchableOpacity style={styles.checkboxRow} onPress={onPress}>
    <Ionicons name={checked ? "checkbox" : "square-outline"} size={20} color={checked ? "#7ec14b" : "#666"} />
    <Text style={styles.checkboxLabel}>
      {option.name}
      {option.count !== undefined ? ` (${option.count})` : ""}
    </Text>
  </TouchableOpacity>
);

const ToggleRow: React.FC<{ label: string; value: boolean; onToggle: () => void }> = ({ label, value, onToggle }) => (
  <TouchableOpacity style={styles.checkboxRow} onPress={onToggle}>
    <Ionicons name={value ? "checkbox" : "square-outline"} size={20} color={value ? "#7ec14b" : "#666"} />
    <Text style={styles.checkboxLabel}>{label}</Text>
  </TouchableOpacity>
);

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: PANEL_WIDTH,
    backgroundColor: "#111",
    borderLeftWidth: 1,
    borderLeftColor: "#222",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  scrollContent: {
    padding: 16,
    gap: 4,
  },
  section: {
    marginBottom: 14,
    gap: 8,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: "#ccc",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    gap: 4,
  },
  chipActive: {
    backgroundColor: "#7ec14b",
    borderColor: "#7ec14b",
  },
  chipInclude: {
    backgroundColor: "#7ec14b",
    borderColor: "#7ec14b",
  },
  chipExclude: {
    backgroundColor: "#a33",
    borderColor: "#a33",
  },
  chipIcon: {
    marginRight: -2,
  },
  chipText: {
    color: "#ccc",
    fontSize: 13,
  },
  chipTextActive: {
    color: "#000",
    fontWeight: "700",
  },
  chipTextInclude: {
    color: "#000",
    fontWeight: "700",
  },
  chipTextExclude: {
    color: "#fff",
    fontWeight: "700",
  },
  textInput: {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: "#fff",
    fontSize: 14,
  },
  rangeRow: {
    flexDirection: "row",
    gap: 8,
  },
  rangeInput: {
    flex: 1,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  checkboxLabel: {
    color: "#ddd",
    fontSize: 14,
    flexShrink: 1,
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#222",
  },
  clearBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#333",
  },
  clearBtnText: {
    color: "#ccc",
    fontWeight: "600",
  },
  applyBtn: {
    flex: 1,
    backgroundColor: "#7ec14b",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  applyBtnText: {
    color: "#000",
    fontWeight: "700",
  },
});

export default AO3FilterPanel;
