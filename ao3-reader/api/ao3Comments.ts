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

// Reads the fields a comment form must send back: where it posts to, its
// authenticity token, and the hidden fields (who is commenting, which
// controller) it carries. Shared by the reply form and a chapter's own form.
function readCommentForm(formHtml: string): AO3ReplyForm | null {
  const actionUrl = toAbsoluteAO3Url(getAttr(formHtml, "action"));
  const authenticityToken = getInputValue(formHtml, "authenticity_token");
  if (!actionUrl || !authenticityToken) {
    console.warn("[ao3Comments] Comment form missing action or token", { actionUrl, hasToken: !!authenticityToken });
    return null;
  }

  const fields: Record<string, string> = {};
  let pseudId = getInputValue(formHtml, "comment[pseud_id]");
  if (!pseudId) {
    // An account with several pseuds gets a menu instead of a hidden field.
    const select = formHtml.match(/<select\b(?=[^>]*\bname=["']comment\[pseud_id\]["'])[^>]*>([\s\S]*?)<\/select>/i);
    const options = select ? select[1].match(/<option\b[^>]*>/gi) ?? [] : [];
    const chosen = options.find((option) => /\bselected\b/i.test(option)) ?? options[0];
    pseudId = chosen ? getAttr(chosen, "value") : undefined;
  }
  if (pseudId) fields["comment[pseud_id]"] = pseudId;
  const controllerName = getInputValue(formHtml, "controller_name");
  if (controllerName) fields.controller_name = controllerName;

  const submitMatch = formHtml.match(/<input\b(?=[^>]*\btype=["']submit["'])[^>]*>/i);
  const commitLabel = (submitMatch ? getAttr(submitMatch[0], "value") : undefined) || "Comment";

  return { actionUrl, authenticityToken, fields, commitLabel };
}

export interface AO3ChapterCommentForm extends AO3ReplyForm {
  // The name the comment will be posted under ("Comment as trapsena").
  postingAs?: string;
}

// The "Comment as ..." form at the foot of a chapter page (loaded with
// ?show_comments=true, which is what the comments drawer already fetches), or
// null when the page has none — comments closed, or not signed in.
export function parseChapterCommentForm(html: string): AO3ChapterCommentForm | null {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  const formHtml = forms.find((form) => /\baction=["'][^"']*\/(?:chapters|works)\/\d+\/comments\/?["']/i.test(form));
  if (!formHtml) return null;
  const form = readCommentForm(formHtml);
  if (!form) return null;
  const byline = formHtml.match(/<span\b[^>]*\bclass=["']byline["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
  const postingAs = byline ? decodeHtmlAttribute(byline.replace(/<[^>]+>/g, "")).trim() : "";
  return { ...form, postingAs: postingAs || undefined };
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
    return readCommentForm(formMatch[0]);
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

export type AO3PostCommentResult =
  | { ok: true }
  | { ok: false; reason: "auth" | "token" | "rejected" | "unknown"; message?: string; status?: number };

// AO3's red "flash" message on a page, e.g. <div class="flash error">...</div>.
const flashErrorText = (html: string): string | undefined => {
  const match = html.match(/<div\b[^>]*\bclass=["']flash[^"']*\berror\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  const text = match ? decodeHtmlAttribute(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "";
  return text || undefined;
};

// Posts a comment on a chapter the way the page's own form does: a plain form
// post that AO3 answers with a redirect to the new comment, not the AJAX call a
// reply uses. AO3 reports a refusal (a duplicate comment, comments turned off)
// as a message on the page it lands on, so that page is read for one.
export async function postChapterComment(
  form: AO3ReplyForm,
  commentText: string,
  referer: string,
): Promise<AO3PostCommentResult> {
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
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: referer,
      },
      body: body.toString(),
    });

    if (res.status === 401 || res.status === 403) return { ok: false, reason: "auth", status: res.status };
    if (res.status === 422) return { ok: false, reason: "token", status: res.status };
    if (!res.ok) return { ok: false, reason: "unknown", status: res.status };
    if (/\/users\/login\b/.test(res.url || "")) return { ok: false, reason: "auth", status: res.status };

    const error = flashErrorText(await res.text());
    if (error) return { ok: false, reason: "rejected", message: error };
    return { ok: true };
  } catch (err) {
    console.warn("[ao3Comments] Chapter comment post failed:", err);
    return { ok: false, reason: "unknown" };
  }
}

// A later page of a chapter's comments. AO3's own page loads these with an AJAX
// call whose answer is a script that swaps the new comments into the page (the
// same kind of answer as the reply form's), so the comments' HTML is picked out
// of it. Null when the request fails.
export async function fetchCommentsFragment(href: string): Promise<string | null> {
  try {
    const res = await fetchWithSession(href, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Accept: "text/javascript, text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) {
      console.warn("[ao3Comments] Comments page fetch was not ok:", res.status);
      return null;
    }
    return extractHtmlFromResponse(await res.text());
  } catch (err) {
    console.warn("[ao3Comments] Could not fetch a comments page:", err);
    return null;
  }
}
