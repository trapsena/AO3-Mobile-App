// "Mark for Later" / "Mark as Read": the work-page button that adds a work to
// (or takes it off) your Marked for Later list. AO3 shows only the one that
// applies:
//   not marked yet -> <form action="/works/<id>/mark_for_later">  Mark for Later
//   already marked -> <form action="/works/<id>/mark_as_read">    Mark as Read
// each a Rails button_to (a POST carrying _method=patch and a token).
import { fetchWithSession } from "./ao3Auth";
import { getAttr, getInputValue } from "./ao3Comments";
import { toText } from "./htmlText";

export interface AO3MarkForm {
  actionUrl: string;
  authenticityToken: string;
  // The hidden _method field ("patch").
  method: string;
  // True when the work is on the Marked for Later list now (so the form on offer
  // is "Mark as Read"); false when it isn't (the form is "Mark for Later").
  marked: boolean;
}

const MARK_ACTION = /\/works\/\d+\/mark_(for_later|as_read)\b/i;

// The Mark for Later / Mark as Read form on a work or chapter page; null when
// there isn't one (signed out, or a page that isn't a work).
export function parseMarkForm(html: string): AO3MarkForm | null {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  const formHtml = forms.find((form) => MARK_ACTION.test(getAttr(form, "action") ?? ""));
  if (!formHtml) return null;
  const action = getAttr(formHtml, "action") ?? "";
  const authenticityToken = getInputValue(formHtml, "authenticity_token");
  if (!authenticityToken) return null;
  return {
    actionUrl: /^https?:\/\//i.test(action) ? action : `https://archiveofourown.org${action.startsWith("/") ? "" : "/"}${action}`,
    authenticityToken,
    method: getInputValue(formHtml, "_method") || "patch",
    marked: /mark_as_read/i.test(action),
  };
}

export interface AO3MarkResult {
  ok: boolean;
  // AO3's own message when it gave one ("This work was added to your Marked for Later list.").
  message: string;
  // The form that is on offer now (the opposite action), to keep the menu right.
  form?: AO3MarkForm;
}

// AO3's flash message on the page it lands on, as plain text.
function flashMessage(html: string, kind: "notice" | "error" | "caution"): string | undefined {
  const match = html.match(new RegExp(`<div\\b[^>]*\\bclass=["']flash[^"']*\\b${kind}\\b[^"']*["'][^>]*>([\\s\\S]*?)</div>`, "i"));
  const text = match ? toText(match[1].replace(/<[^>]+>/g, "")) : "";
  return text || undefined;
}

export async function postMark(form: AO3MarkForm, referer: string): Promise<AO3MarkResult> {
  const body = new URLSearchParams();
  body.append("_method", form.method);
  body.append("authenticity_token", form.authenticityToken);

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

    const signedOut = res.status === 401 || res.status === 403 || /\/users\/login\b/.test(res.url || "");
    if (signedOut) return { ok: false, message: "AO3 may have signed you out. Reload and sign in again." };
    if (res.status === 422) return { ok: false, message: "AO3 rejected the request. Reload the chapter and try again." };
    if (!res.ok) return { ok: false, message: "Couldn't update Marked for Later right now. Please try again." };

    const html = await res.text();
    const error = flashMessage(html, "error") ?? flashMessage(html, "caution");
    if (error) return { ok: false, message: error };

    const notice = flashMessage(html, "notice");
    // The page it lands on carries the opposite button; failing that, flip this one.
    const next =
      parseMarkForm(html) ??
      ({
        ...form,
        marked: !form.marked,
        actionUrl: form.actionUrl.replace(/mark_(?:for_later|as_read)/i, form.marked ? "mark_for_later" : "mark_as_read"),
      } as AO3MarkForm);
    return {
      ok: true,
      message: notice ?? (next.marked ? "This work was added to your Marked for Later list." : "This work was removed from your Marked for Later list."),
      form: next,
    };
  } catch (err) {
    console.warn("[ao3MarkForLater] Request failed:", err);
    return { ok: false, message: "Couldn't reach AO3. Check your connection and try again." };
  }
}
