// api/ao3FilterExtractionJs.ts
//
// AO3 doesn't have a separate "get available filters" endpoint — the filter
// sidebar's checkbox options (with live counts reflecting the *current*
// search) are rendered in the exact same HTML response as the results list
// itself. So this isn't its own hidden-WebView fetch: it's a function to
// call from *inside* whichever screen's injected JS already loads that
// page (AO3WorksScreen's WORKS_INJECTED_JS, AO3BookmarksScreen's
// BOOKMARKS_INJECTED_JS, etc.), right alongside the existing item extraction.
//
// It assumes `text(el)` (whitespace-collapsing textContent helper) already
// exists in scope, matching the convention used in this app's other
// injected-JS strings — splice AO3_FILTER_EXTRACTION_JS in via template
// literal alongside a screen's own IIFE body, after `text` is defined.

export const AO3_FILTER_EXTRACTION_JS = `
function parseFacetLabelText(labelText) {
  // AO3 renders facet labels as "Name (1,234)" — split the trailing count
  // off, tolerating thousands separators, and fall back to the raw text
  // (count omitted) if it doesn't match that shape.
  var match = labelText.match(/^(.*?)\\s*\\(([\\d,]+)\\)\\s*$/);
  if (match) {
    return { name: match[1].trim(), count: parseInt(match[2].replace(/,/g, ""), 10) };
  }
  return { name: labelText, count: undefined };
}

function collectFacetOptionsFromDd(dd) {
  if (!dd) return [];
  var options = [];
  Array.from(dd.querySelectorAll("li")).forEach(function(li) {
    var input = li.querySelector("input[type='checkbox'], input[type='radio']");
    var label = li.querySelector("label");
    if (!input || !label) return;
    var parsed = parseFacetLabelText(text(label));
    options.push({
      id: input.value,
      name: parsed.name,
      count: parsed.count,
      checked: !!input.checked,
    });
  });
  return options;
}

function collectAO3Filters(kind) {
  var WORK_FACET_TAG_TYPES = ["rating", "archive_warning", "category", "fandom", "character", "relationship", "freeform"];
  var BOOKMARK_FACET_TAG_TYPES = WORK_FACET_TAG_TYPES.concat(["tag"]);
  var tagTypes = kind === "bookmarks" ? BOOKMARK_FACET_TAG_TYPES : WORK_FACET_TAG_TYPES;

  var tagFacets = {};
  if (kind === "works" || kind === "bookmarks") {
    tagTypes.forEach(function(tagType) {
      // AO3 gives each group a predictable id: #include_fandom_tags,
      // #exclude_relationship_tags, etc. (only the "include" side actually
      // needs scraping for options — "exclude" reuses the same tag universe,
      // AO3 just hides already-included tags from its own exclude list).
      var dd = document.querySelector("#include_" + tagType + "_tags");
      var options = collectFacetOptionsFromDd(dd);
      if (options.length) tagFacets[tagType] = options;
    });
  }

  var collections = [];
  if (kind === "collection-works") {
    Array.from(document.querySelectorAll("input[name=\\"work_search[collection_ids][]\\"]")).forEach(function(input) {
      var li = input.closest("li");
      var label = li ? li.querySelector("label") : null;
      if (!label) return;
      var parsed = parseFacetLabelText(text(label));
      collections.push({
        id: input.value,
        name: parsed.name,
        count: parsed.count,
        checked: !!input.checked,
      });
    });
  }

  var sortSelect = document.querySelector(
    "#work_search_sort_column, #bookmark_search_sort_column, select[name$='[sort_column]']"
  );
  var sortOptions = sortSelect
    ? Array.from(sortSelect.querySelectorAll("option")).map(function(o) {
        return { value: o.value, label: text(o), selected: !!o.selected };
      })
    : [];

  return {
    kind: kind,
    tagFacets: tagFacets,
    collections: collections,
    sortOptions: sortOptions,
  };
}
`;
