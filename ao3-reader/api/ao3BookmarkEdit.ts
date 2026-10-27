// api/ao3BookmarkEdit.ts
//
// Fetches and submits AO3's inline "Edit bookmark" form — loaded the same
// AJAX way as the comment reply forms (api/ao3Comments.ts): a `data-remote`
// link returns a Rails UJS `.js` template whose `.html("...")` call carries
// the actual form markup, not a plain HTML page.
import { fetchWithSession } from "./ao3Auth";

export interface AO3BookmarkEditForm {
  actionUrl: string;
  // The hidden _method ("put" when editing); empty for a new bookmark, which is a plain post.
  method: string;
  // True for the "save a bookmark!" form, false when editing an existing bookmark.
  isNew: boolean;
  authenticityToken: string;
  pseudId?: string;
  notes: string;
  tagString: string;
  collectionNames: string;
  isPrivate: boolean;
  isRec: boolean;
  commitLabel: string;
}

const decodeHtmlAttribute = (value?: string | null) =>
  (value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getAttr = (html: string, name: string) => {
  const match = html.match(new RegExp(`\\b${escapeRegExp(name)}=["']([^"']*)["']`, "i"));
  return match ? decodeHtmlAttribute(match[1]) : undefined;
};

const getInputValue = (formHtml: string, name: string) => {
  const inputMatch = formHtml.match(new RegExp(`<input\\b(?=[^>]*\\bname=["']${escapeRegExp(name)}["'])[^>]*>`, "i"));
  return inputMatch ? getAttr(inputMatch[0], "value") : undefined;
};

const getCheckboxChecked = (formHtml: string, name: string) => {
  const inputMatch = formHtml.match(
    new RegExp(`<input\\b(?=[^>]*\\btype=["']checkbox["'])(?=[^>]*\\bname=["']${escapeRegExp(name)}["'])[^>]*>`, "i"),
  );
  return !!inputMatch && /\bchecked\b/i.test(inputMatch[0]);
};

const getTextareaValue = (formHtml: string, name: string) => {
  const match = formHtml.match(
    new RegExp(`<textarea\\b(?=[^>]*\\bname=["']${escapeRegExp(name)}["'])[^>]*>([\\s\\S]*?)<\\/textarea>`, "i"),
  );
  return match ? decodeHtmlAttribute(match[1]) : "";
};

export const toAbsoluteAO3Url = (href?: string) => {
  if (!href) return undefined;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) return `https://archiveofourown.org${href}`;
  return `https://archiveofourown.org/${href}`;
};

function extractHtmlFromResponse(body: string): string {
  const match = body.match(/\.html\(\s*"((?:\\.|[^"\\])*)"\s*\)/);
  if (!match) return body;
  return match[1].replace(/\\(.)/g, (_, ch: string) => {
    switch (ch) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      default:
        return ch;
    }
  });
}

export async function fetchBookmarkEditForm(editHref: string): Promise<AO3BookmarkEditForm | null> {
  try {
    const res = await fetchWithSession(editHref, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Accept: "text/javascript, text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) {
      console.warn("[ao3BookmarkEdit] Edit form fetch was not ok:", res.status);
      return null;
    }

    const html = extractHtmlFromResponse(await res.text());
    const formMatch = html.match(/<form\b[\s\S]*?<\/form>/i);
    if (!formMatch) {
      console.warn("[ao3BookmarkEdit] No <form> found in edit response");
      return null;
    }
    return readBookmarkForm(formMatch[0]);
  } catch (err) {
    console.warn("[ao3BookmarkEdit] Could not fetch edit form:", err);
    return null;
  }
}

// Reads a bookmark form — the "save a bookmark!" one (posts to
// /works/<id>/bookmarks) or the edit one (/bookmarks/<id>, with _method=put) —
// into its values, as AO3 rendered them (an edit form arrives filled in).
function readBookmarkForm(formHtml: string): AO3BookmarkEditForm | null {
  const actionUrl = toAbsoluteAO3Url(getAttr(formHtml, "action"));
  const authenticityToken = getInputValue(formHtml, "authenticity_token");
  if (!actionUrl || !authenticityToken) {
    console.warn("[ao3BookmarkEdit] Bookmark form missing action or token", {
      actionUrl,
      hasToken: !!authenticityToken,
    });
    return null;
  }

  // Only an existing bookmark's address ends /bookmarks/<its id>.
  const isNew = !/\/bookmarks\/\d+\/?$/.test(actionUrl);
  const method = getInputValue(formHtml, "_method") || (isNew ? "" : "put");
  const pseudId = getInputValue(formHtml, "bookmark[pseud_id]");
  const notes = getTextareaValue(formHtml, "bookmark[bookmarker_notes]");
  const tagString = getInputValue(formHtml, "bookmark[tag_string]") || "";
  const collectionNames = getInputValue(formHtml, "bookmark[collection_names]") || "";
  const isPrivate = getCheckboxChecked(formHtml, "bookmark[private]");
  const isRec = getCheckboxChecked(formHtml, "bookmark[rec]");

  const submitMatch = formHtml.match(/<input\b(?=[^>]*\btype=["']submit["'])[^>]*>/i);
  const commitLabel = (submitMatch ? getAttr(submitMatch[0], "value") : undefined) || (isNew ? "Create" : "Update");

  return {
    actionUrl,
    method,
    isNew,
    authenticityToken,
    pseudId,
    notes,
    tagString,
    collectionNames,
    isPrivate,
    isRec,
    commitLabel,
  };
}

// The bookmark form on a work or chapter page — "save a bookmark!" when the work
// isn't bookmarked yet, the filled-in edit form when it is. Null when the page
// has none (signed out).
export function parseBookmarkForm(html: string): AO3BookmarkEditForm | null {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  const formHtml = forms.find((form) => /\bname=["']bookmark\[bookmarker_notes\]["']/i.test(form));
  return formHtml ? readBookmarkForm(formHtml) : null;
}

export type AO3SubmitBookmarkResult =
  | { ok: true; message?: string }
  | { ok: false; reason: "auth" | "token" | "rejected" | "unknown"; message?: string; status?: number };

// AO3's flash message (<div class="flash notice|error">) on the page a submit lands on.
const flashText = (html: string, kind: "notice" | "error"): string | undefined => {
  const pattern = kind === "error"
    ? /<div\b[^>]*\bclass=["']flash[^"']*\berror\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
    : /<div\b[^>]*\bclass=["']flash[^"']*\bnotice\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;
  const match = html.match(pattern);
  const text = match ? decodeHtmlAttribute(match[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : "";
  return text || undefined;
};

export async function submitBookmarkEdit(
  form: AO3BookmarkEditForm,
  values: { notes: string; tagString: string; collectionNames: string; isPrivate: boolean; isRec: boolean },
  referer: string,
): Promise<AO3SubmitBookmarkResult> {
  const body = new URLSearchParams();
  if (form.method) body.append("_method", form.method);
  body.append("authenticity_token", form.authenticityToken);
  if (form.pseudId) body.append("bookmark[pseud_id]", form.pseudId);
  body.append("bookmark[bookmarker_notes]", values.notes);
  body.append("bookmark[tag_string]", values.tagString);
  body.append("bookmark[collection_names]", values.collectionNames);
  body.append("bookmark[private]", values.isPrivate ? "1" : "0");
  body.append("bookmark[rec]", values.isRec ? "1" : "0");
  body.append("commit", form.commitLabel);

  try {
    // A new bookmark is posted the way the page's own form does it (a plain form
    // post, answered with a redirect to the bookmark); an edit keeps the AJAX
    // call it has always used.
    const res = await fetchWithSession(form.actionUrl, {
      method: "POST",
      headers: form.isNew
        ? {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Referer: referer,
          }
        : {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "text/javascript, text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8",
            "X-Requested-With": "XMLHttpRequest",
            Referer: referer,
          },
      body: body.toString(),
    });

    if (res.ok && form.isNew) {
      if (/\/users\/login\b/.test(res.url || "")) return { ok: false, reason: "auth", status: res.status };
      const html = await res.text();
      const error = flashText(html, "error");
      if (error) return { ok: false, reason: "rejected", message: error };
      return { ok: true, message: flashText(html, "notice") };
    }
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "auth", status: res.status };
    if (res.status === 422) return { ok: false, reason: "token", status: res.status };
    return { ok: false, reason: "unknown", status: res.status };
  } catch (err) {
    console.warn("[ao3BookmarkEdit] Edit submit failed:", err);
    return { ok: false, reason: "unknown" };
  }
}
