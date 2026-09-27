import { fetchWithSession } from "./ao3Auth";

export interface AO3TagSuggestion {
  id: string;
  name: string;
}

// AO3's own tag-entry fields hit this same endpoint as you type, e.g.
// https://archiveofourown.org/autocomplete/tag?term=problema -> a JSON array
// of { id, name } (id and name are usually identical for freeform tags).
export async function fetchTagAutocomplete(term: string): Promise<AO3TagSuggestion[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];

  const url = `https://archiveofourown.org/autocomplete/tag?term=${encodeURIComponent(trimmed)}`;
  console.log("[ao3Autocomplete] Requesting:", url);

  try {
    // AO3 only serves this endpoint's JSON to requests that look like its
    // own jQuery AJAX calls — a plain GET without these headers gets routed
    // as a normal page request instead and 404s, even though the path
    // itself is otherwise valid (confirmed against a real captured request).
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

    console.log("[ao3Autocomplete] Response:", suggestions.length, "suggestions for term:", trimmed, suggestions);

    return suggestions;
  } catch (err) {
    console.warn("[ao3Autocomplete] fetchTagAutocomplete failed:", err);
    return [];
  }
}
