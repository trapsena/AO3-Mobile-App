import { fetchWithSession } from "./ao3Auth";

export interface AO3TagSuggestion {
  id: string;
  name: string;
}

// AO3 only serves these endpoints' JSON to requests that look like its own
// jQuery AJAX calls — a plain GET without these headers gets routed as a
// normal page request instead and 404s, even though the path itself is
// otherwise valid (confirmed against a real captured request).
async function fetchAutocomplete(url: string, term: string): Promise<AO3TagSuggestion[]> {
  console.log("[ao3Autocomplete] Requesting:", url);

  try {
    const res = await fetchWithSession(url, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*; q=0.01",
      },
    });
    if (!res.ok) {
      console.warn("[ao3Autocomplete] Request failed:", res.status, url);
      return [];
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      console.warn("[ao3Autocomplete] Unexpected response shape:", data);
      return [];
    }

    const suggestions = data
      .filter((item): item is { id?: string; name: string } => !!item && typeof item.name === "string")
      .map((item) => ({ id: String(item.id ?? item.name), name: item.name }));

    console.log("[ao3Autocomplete] Response:", suggestions.length, "suggestions for term:", term, suggestions);

    return suggestions;
  } catch (err) {
    console.warn("[ao3Autocomplete] fetchAutocomplete failed:", err);
    return [];
  }
}

// e.g. https://archiveofourown.org/autocomplete/tag?term=problema -> a JSON
// array of { id, name } (id and name are usually identical for freeform tags).
export async function fetchTagAutocomplete(term: string): Promise<AO3TagSuggestion[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];
  return fetchAutocomplete(`https://archiveofourown.org/autocomplete/tag?term=${encodeURIComponent(trimmed)}`, trimmed);
}

// Same shape and same AJAX-only gating as the tag endpoint, just for the
// "Add to collections" field on a bookmark's edit form, e.g.
// https://archiveofourown.org/autocomplete/open_collection_names?term=asds
export async function fetchCollectionAutocomplete(term: string): Promise<AO3TagSuggestion[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];
  return fetchAutocomplete(
    `https://archiveofourown.org/autocomplete/open_collection_names?term=${encodeURIComponent(trimmed)}`,
    trimmed,
  );
}
