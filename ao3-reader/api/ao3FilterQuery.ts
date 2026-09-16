// api/ao3FilterQuery.ts
import {
  AO3FacetTagType,
  AO3FilterFacets,
  AO3FilterKind,
  AO3FilterSelection,
  BOOKMARK_FACET_TAG_TYPES,
  WORK_FACET_TAG_TYPES,
} from "./ao3FilterTypes";

/**
 * Turns a selection into the query string AO3's own filter form would have
 * submitted. Pass this to a listing screen as `${baseUrl}?${queryString}`
 * (same pattern already used for pagination elsewhere in this app) to
 * re-fetch the page with filters applied.
 *
 * `extraParams` is for page-context fields the real ERB sends as hidden
 * inputs (collection_id, tag_id, fandom_id, pseud_id, user_id, ...) — those
 * depend on which screen/context you're filtering from, not on the filter
 * selections themselves, so the panel doesn't hardcode them. Pass whatever
 * your listing screen already knows from its own URL/route params.
 */
export function buildFilterQueryString(
  kind: AO3FilterKind,
  selection: AO3FilterSelection,
  extraParams?: Record<string, string | undefined>,
): string {
  const prefix = kind === "bookmarks" ? "bookmark_search" : "work_search";
  const params: string[] = [];

  const push = (key: string, value?: string | null) => {
    if (value === undefined || value === null || value === "") return;
    params.push(`${prefix}[${key}]=${encodeURIComponent(value)}`);
  };

  const pushChecked = (key: string, checked?: boolean) => {
    // Rails' f.check_box submits "1" when checked; unchecked boxes are
    // simply omitted (the form's hidden "0" fallback isn't needed here
    // since we're building a query string, not submitting the real form).
    if (checked) params.push(`${prefix}[${key}]=1`);
  };

  push("sort_column", selection.sortColumn);

  if (kind === "works" || kind === "bookmarks") {
    const tagTypes: AO3FacetTagType[] = kind === "bookmarks" ? BOOKMARK_FACET_TAG_TYPES : WORK_FACET_TAG_TYPES;
    const includePrefix = `include_${prefix}`;
    const excludePrefix = `exclude_${prefix}`;

    tagTypes.forEach((tagType) => {
      (selection.includeTagIds?.[tagType] || []).forEach((id) => {
        params.push(`${includePrefix}[${tagType}_ids][]=${encodeURIComponent(id)}`);
      });
      (selection.excludeTagIds?.[tagType] || []).forEach((id) => {
        params.push(`${excludePrefix}[${tagType}_ids][]=${encodeURIComponent(id)}`);
      });
    });

    push("other_tag_names", selection.otherTagNames);
    push("excluded_tag_names", selection.excludedTagNames);
    push("words_from", selection.wordsFrom);
    push("words_to", selection.wordsTo);
    push("language_id", selection.languageId);
  }

  if (kind === "bookmarks") {
    push("other_bookmark_tag_names", selection.otherBookmarkTagNames);
    push("excluded_bookmark_tag_names", selection.excludedBookmarkTagNames);
    push("bookmarkable_query", selection.query);
    push("bookmark_query", selection.bookmarkQuery);
    pushChecked("rec", selection.recOnly);
    pushChecked("with_notes", selection.withNotesOnly);
  }

  if (kind === "works") {
    push("query", selection.query);
    push("crossover", selection.crossover);
    push("complete", selection.complete);
    push("date_from", selection.dateFrom);
    push("date_to", selection.dateTo);
  }

  if (kind === "collection-works") {
    // Not include/exclude-prefixed — collections use a plain checkbox list.
    (selection.collectionIds || []).forEach((id) => {
      params.push(`${prefix}[collection_ids][]=${encodeURIComponent(id)}`);
    });
  }

  if (extraParams) {
    Object.entries(extraParams).forEach(([key, value]) => {
      if (value !== undefined && value !== "") {
        params.push(`${key}=${encodeURIComponent(value)}`);
      }
    });
  }

  return params.join("&");
}

/**
 * The inverse direction — seeds a selection from whatever the currently
 * loaded page's filter sidebar already has checked/selected, so opening the
 * filter panel for the first time reflects the search that's actually on
 * screen (matching how AO3's own filter form retains its state) instead of
 * starting blank. Callers should only call this once per fresh page load
 * (e.g. the first facets received for a screen instance) — re-deriving on
 * every reload would stomp on in-progress edits the person hasn't applied yet.
 */
export function deriveSelectionFromFacets(facets: AO3FilterFacets): AO3FilterSelection {
  const includeTagIds: Partial<Record<AO3FacetTagType, string[]>> = {};
  Object.entries(facets.tagFacets || {}).forEach(([tagType, options]) => {
    const checkedIds = (options || []).filter((option) => option.checked).map((option) => option.id);
    if (checkedIds.length) includeTagIds[tagType as AO3FacetTagType] = checkedIds;
  });

  const selectedSort = facets.sortOptions.find((option) => option.selected);
  const collectionIds = (facets.collections || []).filter((c) => c.checked).map((c) => c.id);

  return {
    sortColumn: selectedSort?.value,
    includeTagIds: Object.keys(includeTagIds).length ? includeTagIds : undefined,
    collectionIds: collectionIds.length ? collectionIds : undefined,
  };
}
