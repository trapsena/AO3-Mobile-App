import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  fetchCharacterAutocomplete,
  fetchFandomAutocomplete,
  fetchFreeformAutocomplete,
  fetchPseudAutocomplete,
  fetchRelationshipAutocomplete,
} from "../api/ao3Autocomplete";
import {
  buildPeopleSearchUrl,
  getRememberedPeopleSearchForm,
  PeopleSearchForm,
  rememberPeopleSearchForm,
} from "../api/ao3PeopleSearch";
import {
  AO3_SEARCH_CATEGORIES,
  AO3_SEARCH_COMPLETION,
  AO3_SEARCH_CROSSOVERS,
  AO3_SEARCH_RATINGS,
  AO3_SEARCH_SORT_COLUMNS,
  AO3_SEARCH_SORT_DIRECTIONS,
  AO3_SEARCH_TYPES,
  AO3_SEARCH_WARNINGS,
  AO3SearchType,
  AO3SelectOption,
  buildWorkSearchUrl,
  getRememberedWorkSearchForm,
  rememberWorkSearchForm,
  WorkSearchForm,
  withPendingTag,
} from "../api/ao3Search";
import {
  AO3_TAG_SEARCH_SORT_COLUMNS,
  AO3_TAG_SEARCH_SORT_DIRECTIONS,
  AO3_TAG_SEARCH_TYPES,
  AO3_TAG_SEARCH_WRANGLING,
  buildTagSearchUrl,
  EMPTY_TAG_SEARCH_FORM,
  getRememberedTagSearchForm,
  rememberTagSearchForm,
  TagSearchForm,
} from "../api/ao3TagSearch";
import { AO3_SEARCH_LANGUAGES } from "../api/ao3SearchLanguages";
import type { AO3Link } from "../components/AO3WorkBlurb";
import type { SearchHeaderInfo } from "../components/Ao3Header";
import SelectField from "../components/SelectField";
import TagAutocompleteInput from "../components/TagAutocompleteInput";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";

interface Props {
  // Called with the address of the results page when a search is submitted.
  onSearch: (results: AO3Link) => void;
  // Called with the address of the People Search results page.
  onSearchPeople: (url: string) => void;
  // Called with the address of the Tag Search results page.
  onSearchTags: (url: string) => void;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  contentContainerTopPadding?: number;
  // Published so the app's header can show which search this is and its ⋮ menu
  // for switching to another kind (cleared with `null` on unmount).
  onHeaderActionsChange?: (info: SearchHeaderInfo | null) => void;
}

type TagField = "fandomNames" | "characterNames" | "relationshipNames" | "freeformNames";

const AO3SearchScreen: React.FC<Props> = ({ onSearch, onSearchPeople, onSearchTags, onScroll, contentContainerTopPadding = 0, onHeaderActionsChange }) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [searchType, setSearchType] = useState<AO3SearchType>("works");
  const [form, setForm] = useState<WorkSearchForm>(getRememberedWorkSearchForm);
  const [resetCount, setResetCount] = useState(0);
  const [peopleForm, setPeopleForm] = useState<PeopleSearchForm>(getRememberedPeopleSearchForm);
  const peoplePendingRef = useRef({ name: "", fandom: "" });
  const [tagForm, setTagForm] = useState<TagSearchForm>(getRememberedTagSearchForm);
  const tagPendingRef = useRef({ fandoms: "" });
  // Text typed into a tag field but not yet made into a tag (see withPendingTag).
  const pendingRef = useRef<Record<TagField, string>>({
    fandomNames: "",
    characterNames: "",
    relationshipNames: "",
    freeformNames: "",
  });

  useEffect(() => {
    rememberWorkSearchForm(form);
  }, [form]);

  useEffect(() => {
    rememberPeopleSearchForm(peopleForm);
  }, [peopleForm]);

  useEffect(() => {
    rememberTagSearchForm(tagForm);
  }, [tagForm]);

  useEffect(() => {
    onHeaderActionsChange?.({ searchType, onSelectSearchType: setSearchType });
  }, [searchType, onHeaderActionsChange]);

  useEffect(() => {
    return () => onHeaderActionsChange?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = useCallback(<K extends keyof WorkSearchForm>(key: K, value: WorkSearchForm[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  }, []);

  const toggleIn = useCallback((key: "warningIds" | "categoryIds", id: string) => {
    setForm((previous) => ({
      ...previous,
      [key]: previous[key].includes(id) ? previous[key].filter((existing) => existing !== id) : [...previous[key], id],
    }));
  }, []);

  const handleSearch = useCallback(() => {
    Keyboard.dismiss();
    const pending = pendingRef.current;
    const submitted: WorkSearchForm = {
      ...form,
      fandomNames: withPendingTag(form.fandomNames, pending.fandomNames),
      characterNames: withPendingTag(form.characterNames, pending.characterNames),
      relationshipNames: withPendingTag(form.relationshipNames, pending.relationshipNames),
      freeformNames: withPendingTag(form.freeformNames, pending.freeformNames),
    };
    onSearch({ label: "Search Results", href: buildWorkSearchUrl(submitted) });
  }, [form, onSearch]);

  const handleSearchPeople = useCallback(() => {
    Keyboard.dismiss();
    onSearchPeople(
      buildPeopleSearchUrl({
        ...peopleForm,
        name: withPendingTag(peopleForm.name, peoplePendingRef.current.name),
        fandom: withPendingTag(peopleForm.fandom, peoplePendingRef.current.fandom),
      }),
    );
  }, [peopleForm, onSearchPeople]);

  const handleResetPeople = useCallback(() => {
    peoplePendingRef.current = { name: "", fandom: "" };
    setResetCount((count) => count + 1);
    setPeopleForm({ query: "", name: "", fandom: "" });
  }, []);

  const handleSearchTags = useCallback(() => {
    Keyboard.dismiss();
    onSearchTags(buildTagSearchUrl({ ...tagForm, fandoms: withPendingTag(tagForm.fandoms, tagPendingRef.current.fandoms) }));
  }, [tagForm, onSearchTags]);

  const handleResetTags = useCallback(() => {
    tagPendingRef.current = { fandoms: "" };
    setResetCount((count) => count + 1);
    setTagForm(EMPTY_TAG_SEARCH_FORM);
  }, []);

  const handleReset = useCallback(() => {
    // Text typed into a tag field but not yet made a tag lives inside that input,
    // so the inputs are remounted (resetCount is part of their key) to empty them.
    pendingRef.current = { fandomNames: "", characterNames: "", relationshipNames: "", freeformNames: "" };
    setResetCount((count) => count + 1);
    setForm((previous) => ({
      ...previous,
      query: "",
      title: "",
      creators: "",
      revisedAt: "",
      complete: "",
      crossover: "",
      singleChapter: false,
      wordCount: "",
      languageId: "",
      fandomNames: "",
      ratingId: "",
      warningIds: [],
      categoryIds: [],
      characterNames: "",
      relationshipNames: "",
      freeformNames: "",
      hits: "",
      kudosCount: "",
      commentsCount: "",
      bookmarksCount: "",
      sortColumn: "_score",
      sortDirection: "desc",
    }));
  }, []);

  const textInput = (key: keyof WorkSearchForm & string, placeholder?: string, keyboardType?: "default" | "numeric") => (
    <TextInput
      style={styles.input}
      value={form[key] as string}
      onChangeText={(text) => set(key as any, text as any)}
      placeholder={placeholder}
      placeholderTextColor={colors.textFaint}
      autoCorrect={false}
      autoCapitalize="none"
      keyboardType={keyboardType}
      returnKeyType="search"
      onSubmitEditing={handleSearch}
    />
  );

  const tagInput = (key: TagField, fetcher: typeof fetchFandomAutocomplete) => (
    <TagAutocompleteInput
        key={`${key}-${resetCount}`}
        value={form[key]}
        onChangeText={(text) => set(key, text)}
        fetchSuggestions={fetcher}
        placeholder="Start typing for suggestions!"
        placeholderTextColor={colors.textFaint}
        style={styles.input}
        onDraftChange={(draft) => {
          pendingRef.current[key] = draft;
        }}
      />
  );

  const radioGroup = (options: AO3SelectOption[], value: string, onChange: (value: string) => void) => (
    <View style={styles.choiceList}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <TouchableOpacity key={option.value || "__all"} style={styles.choiceRow} onPress={() => onChange(option.value)}>
            <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={20} color={active ? colors.accent : colors.textFaint} />
            <Text style={styles.choiceLabel}>{option.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const checkGroup = (options: AO3SelectOption[], selected: string[], onToggle: (value: string) => void) => (
    <View style={styles.choiceList}>
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <TouchableOpacity key={option.value} style={styles.choiceRow} onPress={() => onToggle(option.value)}>
            <Ionicons name={active ? "checkbox" : "square-outline"} size={20} color={active ? colors.accent : colors.textFaint} />
            <Text style={styles.choiceLabel}>{option.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // Fields with a suggestion list pass a zIndex, lower for each one further down
  // the form, so a list dropping over the field below it is drawn on top of it.
  const field = (label: string, control: React.ReactNode, hint?: string, zIndex?: number) => (
    <View style={[styles.field, zIndex !== undefined && { zIndex }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {control}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );

  const searchButton = (
    <TouchableOpacity style={styles.searchButton} onPress={handleSearch} activeOpacity={0.8}>
      <Ionicons name="search" size={16} color={colors.accentText} />
      <Text style={styles.searchButtonText}>Search</Text>
    </TouchableOpacity>
  );

  const peopleSearchButton = (
    <TouchableOpacity style={styles.searchButton} onPress={handleSearchPeople} activeOpacity={0.8}>
      <Ionicons name="search" size={16} color={colors.accentText} />
      <Text style={styles.searchButtonText}>Search People</Text>
    </TouchableOpacity>
  );

  const tagSearchButton = (
    <TouchableOpacity style={styles.searchButton} onPress={handleSearchTags} activeOpacity={0.8}>
      <Ionicons name="search" size={16} color={colors.accentText} />
      <Text style={styles.searchButtonText}>Search Tags</Text>
    </TouchableOpacity>
  );

  const typeLabel = AO3_SEARCH_TYPES.find((type) => type.key === searchType)?.label ?? "Search";

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        contentContainerStyle={[styles.content, { paddingTop: contentContainerTopPadding + 16 }]}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
      >
        {searchType === "people" ? (
          <View style={[styles.section, { zIndex: 50 }]}>
            {field(
              "Search all fields",
              <TextInput
                style={styles.input}
                value={peopleForm.query}
                onChangeText={(text) => setPeopleForm((previous) => ({ ...previous, query: text }))}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={handleSearchPeople}
              />,
            )}
            {field(
              "Name",
              <TagAutocompleteInput
                key={`people-name-${resetCount}`}
                value={peopleForm.name}
                onChangeText={(text) => setPeopleForm((previous) => ({ ...previous, name: text }))}
                fetchSuggestions={fetchPseudAutocomplete}
                placeholder="Start typing for suggestions!"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                onDraftChange={(draft) => {
                  peoplePendingRef.current.name = draft;
                }}
              />,
              undefined,
              50,
            )}
            {field(
              "Fandom",
              <TagAutocompleteInput
                key={`people-fandom-${resetCount}`}
                value={peopleForm.fandom}
                onChangeText={(text) => setPeopleForm((previous) => ({ ...previous, fandom: text }))}
                fetchSuggestions={fetchFandomAutocomplete}
                placeholder="Start typing for suggestions!"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                onDraftChange={(draft) => {
                  peoplePendingRef.current.fandom = draft;
                }}
              />,
              undefined,
              40,
            )}
            <View style={styles.footerRow}>
              <TouchableOpacity style={styles.resetButton} onPress={handleResetPeople} activeOpacity={0.7}>
                <Text style={styles.resetButtonText}>Clear form</Text>
              </TouchableOpacity>
              {peopleSearchButton}
            </View>
          </View>
        ) : searchType === "tags" ? (
          <View style={[styles.section, { zIndex: 50 }]}>
            {field(
              "Tag name",
              <TextInput
                style={styles.input}
                value={tagForm.name}
                onChangeText={(text) => setTagForm((previous) => ({ ...previous, name: text }))}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={handleSearchTags}
              />,
            )}
            {field(
              "Fandoms",
              <TagAutocompleteInput
                key={`tag-fandoms-${resetCount}`}
                value={tagForm.fandoms}
                onChangeText={(text) => setTagForm((previous) => ({ ...previous, fandoms: text }))}
                fetchSuggestions={fetchFandomAutocomplete}
                placeholder="Start typing for suggestions!"
                placeholderTextColor={colors.textFaint}
                style={styles.input}
                onDraftChange={(draft) => {
                  tagPendingRef.current.fandoms = draft;
                }}
              />,
              "Find tags wrangled to specific canonical fandoms.",
              50,
            )}
            {field("Type", radioGroup(AO3_TAG_SEARCH_TYPES, tagForm.type, (v) => setTagForm((previous) => ({ ...previous, type: v }))))}
            {field(
              "Wrangling status",
              radioGroup(AO3_TAG_SEARCH_WRANGLING, tagForm.wranglingStatus, (v) =>
                setTagForm((previous) => ({ ...previous, wranglingStatus: v })),
              ),
            )}
            {field(
              "Sort by",
              <SelectField
                value={tagForm.sortColumn}
                options={AO3_TAG_SEARCH_SORT_COLUMNS}
                onChange={(v) => setTagForm((previous) => ({ ...previous, sortColumn: v }))}
                title="Sort by"
              />,
            )}
            {field(
              "Sort direction",
              <SelectField
                value={tagForm.sortDirection}
                options={AO3_TAG_SEARCH_SORT_DIRECTIONS}
                onChange={(v) => setTagForm((previous) => ({ ...previous, sortDirection: v }))}
                title="Sort direction"
              />,
            )}
            <View style={styles.footerRow}>
              <TouchableOpacity style={styles.resetButton} onPress={handleResetTags} activeOpacity={0.7}>
                <Text style={styles.resetButtonText}>Clear form</Text>
              </TouchableOpacity>
              {tagSearchButton}
            </View>
          </View>
        ) : searchType !== "works" ? (
          <View style={styles.emptyState}>
            <Ionicons name="construct-outline" size={32} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>{typeLabel} isn't available yet</Text>
            <Text style={styles.emptyBody}>Use the ⋮ menu to go back to Work Search.</Text>
          </View>
        ) : (
          <>
            <View style={[styles.section, { zIndex: 1 }]}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Work Info</Text>
                {searchButton}
              </View>
              {field("Any Field", textInput("query"))}
              {field("Title", textInput("title"))}
              {field("Creator", textInput("creators"))}
              {field("Date", textInput("revisedAt", "e.g. > 1 year ago"), "AO3 date syntax: a year, a range, or \"< 6 months ago\".")}
              {field("Completion status", radioGroup(AO3_SEARCH_COMPLETION, form.complete, (v) => set("complete", v)))}
              {field("Crossovers", radioGroup(AO3_SEARCH_CROSSOVERS, form.crossover, (v) => set("crossover", v)))}
              <TouchableOpacity style={styles.choiceRow} onPress={() => set("singleChapter", !form.singleChapter)}>
                <Ionicons
                  name={form.singleChapter ? "checkbox" : "square-outline"}
                  size={20}
                  color={form.singleChapter ? colors.accent : colors.textFaint}
                />
                <Text style={styles.choiceLabel}>Single Chapter</Text>
              </TouchableOpacity>
              {field("Word Count", textInput("wordCount", "e.g. 1000-5000"), "Use \"> 10000\", \"< 500\" or a range.")}
              {field(
                "Language",
                <SelectField
                  value={form.languageId}
                  options={AO3_SEARCH_LANGUAGES}
                  onChange={(v) => set("languageId", v)}
                  searchable
                  allowEmpty
                  placeholder="Any language"
                  title="Language"
                />,
              )}
            </View>

            <View style={[styles.section, { zIndex: 50 }]}>
              <Text style={styles.sectionTitle}>Work Tags</Text>
              {field("Fandoms", tagInput("fandomNames", fetchFandomAutocomplete), undefined, 50)}
              {field(
                "Rating",
                <SelectField
                  value={form.ratingId}
                  options={AO3_SEARCH_RATINGS}
                  onChange={(v) => set("ratingId", v)}
                  allowEmpty
                  placeholder="Any rating"
                  title="Rating"
                />,
              )}
              {field("Warnings", checkGroup(AO3_SEARCH_WARNINGS, form.warningIds, (id) => toggleIn("warningIds", id)))}
              {field("Categories", checkGroup(AO3_SEARCH_CATEGORIES, form.categoryIds, (id) => toggleIn("categoryIds", id)))}
              {field("Characters", tagInput("characterNames", fetchCharacterAutocomplete), undefined, 40)}
              {field("Relationships", tagInput("relationshipNames", fetchRelationshipAutocomplete), undefined, 30)}
              {field("Additional Tags", tagInput("freeformNames", fetchFreeformAutocomplete), undefined, 20)}
            </View>

            <View style={[styles.section, { zIndex: 1 }]}>
              <Text style={styles.sectionTitle}>Work Stats</Text>
              {field("Hits", textInput("hits", "e.g. > 1000", "default"))}
              {field("Kudos", textInput("kudosCount", "e.g. > 100", "default"))}
              {field("Comments", textInput("commentsCount", "e.g. > 10", "default"))}
              {field("Bookmarks", textInput("bookmarksCount", "e.g. > 10", "default"))}
            </View>

            <View style={[styles.section, { zIndex: 1 }]}>
              <Text style={styles.sectionTitle}>Search</Text>
              {field(
                "Sort by",
                <SelectField
                  value={form.sortColumn}
                  options={AO3_SEARCH_SORT_COLUMNS}
                  onChange={(v) => set("sortColumn", v)}
                  title="Sort by"
                />,
              )}
              {field(
                "Sort direction",
                <SelectField
                  value={form.sortDirection}
                  options={AO3_SEARCH_SORT_DIRECTIONS}
                  onChange={(v) => set("sortDirection", v)}
                  title="Sort direction"
                />,
              )}
              <View style={styles.footerRow}>
                <TouchableOpacity style={styles.resetButton} onPress={handleReset} activeOpacity={0.7}>
                  <Text style={styles.resetButtonText}>Clear form</Text>
                </TouchableOpacity>
                {searchButton}
              </View>
            </View>
          </>
        )}
      </Animated.ScrollView>
    </View>
  );
};

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: 16, paddingBottom: 40, gap: 16 },
    section: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 14,
      gap: 14,
    },
    sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
    field: { gap: 6 },
    fieldLabel: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
    hint: { color: colors.textFaint, fontSize: 11 },
    input: {
      color: colors.text,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
    },
    choiceList: { gap: 2 },
    choiceRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
    choiceLabel: { color: colors.text, fontSize: 14, flex: 1 },
    searchButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.accent,
      borderRadius: 8,
      paddingHorizontal: 16,
      paddingVertical: 9,
    },
    searchButtonText: { color: colors.accentText, fontSize: 14, fontWeight: "700" },
    footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
    resetButton: { paddingHorizontal: 8, paddingVertical: 9 },
    resetButtonText: { color: colors.textFaint, fontSize: 13 },
    emptyState: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 24, gap: 10 },
    emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "700", textAlign: "center" },
    emptyBody: { color: colors.textFaint, fontSize: 13, textAlign: "center", lineHeight: 18 },
  });

export default AO3SearchScreen;
