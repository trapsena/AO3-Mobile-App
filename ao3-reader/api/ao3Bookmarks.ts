import { fetchWithSession } from "./ao3Auth";

// A bookmarker link's href looks like "/users/trapsena/pseuds/trapsena/bookmarks"
// (or the bare "/users/trapsena") — either way the username is the first
// path segment after "/users/".
export const extractUsernameFromUsersUrl = (href?: string | null): string | null => {
  if (!href) return null;
  const match = href.match(/\/users\/([^\/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
};

// Rails' non-JS fallback for a `data-method="delete"` link is a hidden form
// posting `_method=delete` + the page's CSRF token — this pulls that token
// out of the standard `<meta name="csrf-token" content="...">` tag Rails
// puts in every page's `<head>`, attribute order agnostic.
export const extractCsrfToken = (html: string): string | undefined => {
  const match =
    html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i);
  return match ? match[1] : undefined;
};

export type DeleteBookmarkResult =
  | { ok: true }
  | { ok: false; reason: "auth" | "token" | "unknown"; status?: number };

// Shared network primitive for removing a bookmark — used by both the
// bookmarks screen and the profile/listing screen's own "recent bookmarks"
// section, since AO3 renders the exact same Edit/Delete/etc actions in both
// places whenever the viewer owns the bookmark.
export async function deleteAo3Bookmark(
  deleteHref: string,
  csrfToken: string,
  refererUrl: string,
): Promise<DeleteBookmarkResult> {
  const body = new URLSearchParams();
  body.append("_method", "delete");
  body.append("authenticity_token", csrfToken);

  try {
    const res = await fetchWithSession(deleteHref, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: refererUrl,
      },
      body: body.toString(),
    });

    console.log("[ao3Bookmarks] Delete response", {
      status: res.status,
      ok: res.ok,
      redirected: res.redirected,
      finalUrl: res.url,
    });

    if (res.ok) return { ok: true };

    const bodyText = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403 || /sign in|log in/i.test(bodyText)) {
      return { ok: false, reason: "auth", status: res.status };
    }
    if (res.status === 422) {
      return { ok: false, reason: "token", status: res.status };
    }
    return { ok: false, reason: "unknown", status: res.status };
  } catch (err) {
    console.warn("[ao3Bookmarks] deleteAo3Bookmark threw an error:", err);
    return { ok: false, reason: "unknown" };
  }
}
