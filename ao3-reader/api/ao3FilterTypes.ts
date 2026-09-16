// api/ao3FilterTypes.ts
//
// AO3 serves three variants of the same "Filters" sidebar, all built from
// the same underlying Rails form pattern but with different field sets:
//
//   - "works"            /works, a fandom/tag's works page, etc.
//   - "bookmarks"        /bookmarks, a fandom/tag's bookmarks page, etc.
//   - "collection-works" a user's works-within-their-collections page
//                        (much smaller: just sort + which collection)
//
// These types model the union of everything all three variants can contain,
// with each field's applicability documented per-kind. AO3FilterPanel reads
// `kind` to decide which subset to actually render.

export type AO3FilterKind = "works" | "bookmarks" | "collection-works";

// The 8 facet groups that appear as "Include ___ / Exclude ___" checkbox
// lists. "tag" (a catch-all bookmarker tag facet) only exists for bookmarks.
export type AO3FacetTagType =
  | "rating"
  | "archive_warning"
  | "category"
  | "fandom"
  | "character"
  | "relationship"
  | "freeform"
  | "tag";

export const WORK_FACET_TAG_TYPES: AO3FacetTagType[] = [
  "rating",
  "archive_warning",
  "category",
  "fandom",
  "character",
  "relationship",
  "freeform",
];

export const BOOKMARK_FACET_TAG_TYPES: AO3FacetTagType[] = [
  ...WORK_FACET_TAG_TYPES,
  "tag",
];

export interface AO3FilterFacetOption {
  id: string;
  name: string;
  count?: number;
  /** Whether AO3 pre-checked this option server-side (reflects the current search). */
  checked?: boolean;
}

export interface AO3FilterSortOption {
  value: string;
  label: string;
  selected?: boolean;
}

/**
 * The available *options* for a given search context — scraped from the
 * currently-loaded results page's own filter sidebar (AO3 doesn't expose a
 * separate "get facets" endpoint; the options with live counts are rendered
 * inline with the results every time). See ao3FilterExtractionJs.ts.
 */
export interface AO3FilterFacets {
  kind: AO3FilterKind;
  sortOptions: AO3FilterSortOption[];
  /** Present for "works" and "bookmarks" only, keyed by facet tag type. */
  tagFacets?: Partial<Record<AO3FacetTagType, AO3FilterFacetOption[]>>;
  /** Present for "collection-works" only. */
  collections?: AO3FilterFacetOption[];
}

/**
 * The person's current filter selections/entries. Every field is optional
 * and kind-specific fields are simply ignored by the query builder for
 * kinds where they don't apply.
 */
export interface AO3FilterSelection {
  sortColumn?: string;

  // works + bookmarks
  includeTagIds?: Partial<Record<AO3FacetTagType, string[]>>;
  excludeTagIds?: Partial<Record<AO3FacetTagType, string[]>>;
  otherTagNames?: string;
  excludedTagNames?: string;
  wordsFrom?: string;
  wordsTo?: string;
  languageId?: string;
  /** "Search within results" — work_search[query] or bookmark_search[bookmarkable_query]. */
  query?: string;

  // bookmarks-only
  otherBookmarkTagNames?: string;
  excludedBookmarkTagNames?: string;
  /** "Search bookmarker's tags and notes" — bookmark_search[bookmark_query]. */
  bookmarkQuery?: string;
  recOnly?: boolean;
  withNotesOnly?: boolean;

  // works-only
  crossover?: "" | "T" | "F";
  complete?: "" | "T" | "F";
  dateFrom?: string;
  dateTo?: string;

  // collection-works-only
  collectionIds?: string[];
}

export const EMPTY_AO3_FILTER_SELECTION: AO3FilterSelection = {};
