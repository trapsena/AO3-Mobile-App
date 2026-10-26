// AO3's search forms: which kinds there are, the Work Search form's fields and
// options (copied from AO3's own /works/search page), and the address a filled-in
// form turns into. The results page is the ordinary works listing, so the app shows
// it with the same screen it uses for a tag's works.

export type AO3SearchType = "works" | "people" | "bookmarks" | "tags";

export const AO3_SEARCH_TYPES: Array<{ key: AO3SearchType; label: string }> = [
  { key: "works", label: "Work Search" },
  { key: "people", label: "People Search" },
  { key: "bookmarks", label: "Bookmark Search" },
  { key: "tags", label: "Tag Search" },
];

export interface AO3SelectOption {
  value: string;
  label: string;
}

export const AO3_SEARCH_RATINGS: AO3SelectOption[] = [
  { value: "9", label: "Not Rated" },
  { value: "10", label: "General Audiences" },
  { value: "11", label: "Teen And Up Audiences" },
  { value: "12", label: "Mature" },
  { value: "13", label: "Explicit" },
];

export const AO3_SEARCH_WARNINGS: AO3SelectOption[] = [
  { value: "14", label: "Creator Chose Not To Use Archive Warnings" },
  { value: "17", label: "Graphic Depictions Of Violence" },
  { value: "18", label: "Major Character Death" },
  { value: "16", label: "No Archive Warnings Apply" },
  { value: "19", label: "Rape/Non-Con" },
  { value: "20", label: "Underage Sex" },
];

export const AO3_SEARCH_CATEGORIES: AO3SelectOption[] = [
  { value: "116", label: "F/F" },
  { value: "22", label: "F/M" },
  { value: "21", label: "Gen" },
  { value: "23", label: "M/M" },
  { value: "2246", label: "Multi" },
  { value: "24", label: "Other" },
];

export const AO3_SEARCH_COMPLETION: AO3SelectOption[] = [
  { value: "", label: "All works" },
  { value: "T", label: "Complete works only" },
  { value: "F", label: "Works in progress only" },
];

export const AO3_SEARCH_CROSSOVERS: AO3SelectOption[] = [
  { value: "", label: "Include crossovers" },
  { value: "F", label: "Exclude crossovers" },
  { value: "T", label: "Only crossovers" },
];

export const AO3_SEARCH_SORT_COLUMNS: AO3SelectOption[] = [
  { value: "_score", label: "Best Match" },
  { value: "authors_to_sort_on", label: "Creator" },
  { value: "title_to_sort_on", label: "Title" },
  { value: "created_at", label: "Date Posted" },
  { value: "revised_at", label: "Date Updated" },
  { value: "word_count", label: "Word Count" },
  { value: "hits", label: "Hits" },
  { value: "kudos_count", label: "Kudos" },
  { value: "comments_count", label: "Comments" },
  { value: "bookmarks_count", label: "Bookmarks" },
];

export const AO3_SEARCH_SORT_DIRECTIONS: AO3SelectOption[] = [
  { value: "asc", label: "Ascending" },
  { value: "desc", label: "Descending" },
];

export interface WorkSearchForm {
  query: string;
  title: string;
  creators: string;
  // AO3 date syntax, e.g. "> 1 year ago" (see its date help).
  revisedAt: string;
  complete: string;
  crossover: string;
  singleChapter: boolean;
  wordCount: string;
  languageId: string;
  // Comma-separated tag names, the way TagAutocompleteInput keeps them.
  fandomNames: string;
  ratingId: string;
  warningIds: string[];
  categoryIds: string[];
  characterNames: string;
  relationshipNames: string;
  freeformNames: string;
  hits: string;
  kudosCount: string;
  commentsCount: string;
  bookmarksCount: string;
  sortColumn: string;
  sortDirection: string;
}

export const EMPTY_WORK_SEARCH_FORM: WorkSearchForm = {
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
};

// A tag field's committed tags plus whatever was typed after them but not yet
// turned into a tag, so a search started straight from the button keeps it.
export function withPendingTag(tags: string, pending: string): string {
  const typed = pending.trim();
  return typed ? (tags.trim() ? `${tags}, ${typed}` : typed) : tags;
}

export const WORK_SEARCH_URL = "https://archiveofourown.org/works/search";

// The address AO3's own form would have gone to: empty fields are left out, the
// checkbox groups send one entry per ticked box, and sorting is always sent
// (as the form does).
export function buildWorkSearchUrl(form: WorkSearchForm): string {
  const params: string[] = [];
  const push = (key: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) params.push(`work_search[${key}]=${encodeURIComponent(trimmed)}`);
  };
  const pushAll = (key: string, values: string[]) =>
    values.forEach((value) => params.push(`work_search[${key}][]=${encodeURIComponent(value)}`));

  push("query", form.query);
  push("title", form.title);
  push("creators", form.creators);
  push("revised_at", form.revisedAt);
  push("complete", form.complete);
  push("crossover", form.crossover);
  if (form.singleChapter) params.push("work_search[single_chapter]=1");
  push("word_count", form.wordCount);
  push("language_id", form.languageId);
  push("fandom_names", form.fandomNames);
  push("rating_ids", form.ratingId);
  pushAll("archive_warning_ids", form.warningIds);
  pushAll("category_ids", form.categoryIds);
  push("character_names", form.characterNames);
  push("relationship_names", form.relationshipNames);
  push("freeform_names", form.freeformNames);
  push("hits", form.hits);
  push("kudos_count", form.kudosCount);
  push("comments_count", form.commentsCount);
  push("bookmarks_count", form.bookmarksCount);
  push("sort_column", form.sortColumn);
  push("sort_direction", form.sortDirection);
  params.push("commit=Search");
  return `${WORK_SEARCH_URL}?${params.join("&")}`;
}

// Kept for the life of the app, so coming back from the results (or switching
// to another screen and returning) finds the form as it was left.
let rememberedWorkSearchForm: WorkSearchForm = EMPTY_WORK_SEARCH_FORM;
export const getRememberedWorkSearchForm = () => rememberedWorkSearchForm;
export const rememberWorkSearchForm = (form: WorkSearchForm) => {
  rememberedWorkSearchForm = form;
};
