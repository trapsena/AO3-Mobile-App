// api/ao3Comments.ts
//
// Fetches and submits AO3's inline "Reply" form (e.g. from the Inbox), the
// same plain-regex approach AO3HistoryScreen already uses for its delete
// form — no WebView needed for a fragment this small.
import { fetchWithSession } from "./ao3Auth";

export interface AO3ReplyForm {
  actionUrl: string;
  authenticityToken: string;
  // Every other hidden field the form carries (comment[pseud_id],
  // controller_name, ...) besides authenticity_token, replayed as-is.
  fields: Record<string, string>;
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
  const inputMatch = formHtml.match(
    new RegExp(`<input\\b(?=[^>]*\\bname=["']${escapeRegExp(name)}["'])[^>]*>`, "i"),
  );
  return inputMatch ? getAttr(inputMatch[0], "value") : undefined;
};

export const toAbsoluteAO3Url = (href?: string) => {
  if (!href) return undefined;
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) return `https://archiveofourown.org${href}`;
  return `https://archiveofourown.org/${href}`;
};

// AO3's real response to this `data-remote="true"` link (confirmed against
// a captured response) is a Rails UJS `.js` template — several statements,
// not just one — that string-replaces a DOM node's contents:
//
//   $j('#reply-to-comment').show();
//   window.location.hash = 'reply-to-comment';
//   $j('#reply-to-comment').draggable({ opacity: 0.80 });
//   $j('#reply-to-comment').html("<div class=\"post comment\" ...>...<\/div>");
//   $j('#comment_cancel').click(function() { ... });
//
// This app has no JS-eval'ing WebView in the loop here to run that script,
// so this finds the `.html("...")` call's escaped string argument (there's
// more JS *after* it, so it can't just be "everything to the end of the
// string") and un-escapes it back into real HTML. Falls back to treating
// the whole body as HTML directly if no such call is found.
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
        // Covers \" \' \/ \\ and anything else JS might escape — the
        // backslash is simply dropped, leaving the literal character.
        return ch;
    }
  });
}

export async function fetchReplyForm(replyHref: string): Promise<AO3ReplyForm | null> {
  try {
    const res = await fetchWithSession(replyHref, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Accept: "text/javascript, text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) {
      console.warn("[ao3Comments] Reply form fetch was not ok:", res.status);
      return null;
    }

    const html = extractHtmlFromResponse(await res.text());
    const formMatch = html.match(/<form\b[\s\S]*?<\/form>/i);
    if (!formMatch) {
      console.warn("[ao3Comments] No <form> found in reply response");
      return null;
    }
    const formHtml = formMatch[0];

    const actionUrl = toAbsoluteAO3Url(getAttr(formHtml, "action"));
    const authenticityToken = getInputValue(formHtml, "authenticity_token");
    if (!actionUrl || !authenticityToken) {
      console.warn("[ao3Comments] Reply form missing action or token", { actionUrl, hasToken: !!authenticityToken });
      return null;
    }

    const fields: Record<string, string> = {};
    const pseudId = getInputValue(formHtml, "comment[pseud_id]");
    if (pseudId) fields["comment[pseud_id]"] = pseudId;
    const controllerName = getInputValue(formHtml, "controller_name");
    if (controllerName) fields.controller_name = controllerName;

    const submitMatch = formHtml.match(/<input\b(?=[^>]*\btype=["']submit["'])[^>]*>/i);
    const commitLabel = (submitMatch ? getAttr(submitMatch[0], "value") : undefined) || "Comment";

    return { actionUrl, authenticityToken, fields, commitLabel };
  } catch (err) {
    console.warn("[ao3Comments] Could not fetch reply form:", err);
    return null;
  }
}

export type AO3PostReplyResult =
  | { ok: true }
  | { ok: false; reason: "auth" | "token" | "unknown"; status?: number };

export async function postReplyComment(
  form: AO3ReplyForm,
  commentText: string,
  referer: string,
): Promise<AO3PostReplyResult> {
  const body = new URLSearchParams();
  body.append("authenticity_token", form.authenticityToken);
  Object.entries(form.fields).forEach(([key, value]) => body.append(key, value));
  body.append("comment[comment_content]", commentText);
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
    console.warn("[ao3Comments] Reply post failed:", err);
    return { ok: false, reason: "unknown" };
  }
}
