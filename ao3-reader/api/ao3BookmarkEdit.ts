// api/ao3BookmarkEdit.ts
//
// Fetches and submits AO3's inline "Edit bookmark" form — loaded the same
// AJAX way as the comment reply forms (api/ao3Comments.ts): a `data-remote`
// link returns a Rails UJS `.js` template whose `.html("...")` call carries
// the actual form markup, not a plain HTML page.
import { fetchWithSession } from "./ao3Auth";

export interface AO3BookmarkEditForm {
  actionUrl: string;
  method: string;
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
    const formHtml = formMatch[0];

    const actionUrl = toAbsoluteAO3Url(getAttr(formHtml, "action"));
    const authenticityToken = getInputValue(formHtml, "authenticity_token");
    if (!actionUrl || !authenticityToken) {
      console.warn("[ao3BookmarkEdit] Edit form missing action or token", {
        actionUrl,
        hasToken: !!authenticityToken,
      });
      return null;
    }

    const method = getInputValue(formHtml, "_method") || "put";
    const pseudId = getInputValue(formHtml, "bookmark[pseud_id]");
    const notes = getTextareaValue(formHtml, "bookmark[bookmarker_notes]");
    const tagString = getInputValue(formHtml, "bookmark[tag_string]") || "";
    const collectionNames = getInputValue(formHtml, "bookmark[collection_names]") || "";
    const isPrivate = getCheckboxChecked(formHtml, "bookmark[private]");
    const isRec = getCheckboxChecked(formHtml, "bookmark[rec]");

    const submitMatch = formHtml.match(/<input\b(?=[^>]*\btype=["']submit["'])[^>]*>/i);
    const commitLabel = (submitMatch ? getAttr(submitMatch[0], "value") : undefined) || "Update";

    return {
      actionUrl,
      method,
      authenticityToken,
      pseudId,
      notes,
      tagString,
      collectionNames,
      isPrivate,
      isRec,
      commitLabel,
    };
  } catch (err) {
    console.warn("[ao3BookmarkEdit] Could not fetch edit form:", err);
    return null;
  }
}

export type AO3SubmitBookmarkResult = { ok: true } | { ok: false; reason: "auth" | "token" | "unknown"; status?: number };

export async function submitBookmarkEdit(
  form: AO3BookmarkEditForm,
  values: { notes: string; tagString: string; collectionNames: string; isPrivate: boolean; isRec: boolean },
  referer: string,
): Promise<AO3SubmitBookmarkResult> {
  const body = new URLSearchParams();
  body.append("_method", form.method);
  body.append("authenticity_token", form.authenticityToken);
  if (form.pseudId) body.append("bookmark[pseud_id]", form.pseudId);
  body.append("bookmark[bookmarker_notes]", values.notes);
  body.append("bookmark[tag_string]", values.tagString);
  body.append("bookmark[collection_names]", values.collectionNames);
  body.append("bookmark[private]", values.isPrivate ? "1" : "0");
  body.append("bookmark[rec]", values.isRec ? "1" : "0");
  body.append("commit", form.commitLabel);

  try {
    const res = await fetchWithSession(form.actionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/javascript, text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8",
        "X-Requested-With": "XMLHttpRequest",
        Referer: referer,
      },
      body: body.toString(),
    });

    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "auth", status: res.status };
    if (res.status === 422) return { ok: false, reason: "token", status: res.status };
    return { ok: false, reason: "unknown", status: res.status };
  } catch (err) {
    console.warn("[ao3BookmarkEdit] Edit submit failed:", err);
    return { ok: false, reason: "unknown" };
  }
}
