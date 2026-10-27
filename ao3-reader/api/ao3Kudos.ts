// Leaving kudos on a work: reading the "Kudos ♥" form off a chapter page and
// posting it to AO3's /kudos endpoint.
import { fetchWithSession } from "./ao3Auth";
import { getAttr, getInputValue } from "./ao3Comments";

export interface AO3KudosForm {
  actionUrl: string;
  authenticityToken: string;
  // kudo[commentable_id] / kudo[commentable_type]: the work the kudos go to.
  commentableId: string;
  commentableType: string;
  commitLabel: string;
}

// The form every chapter page carries at its foot:
//   <form id="new_kudo" action="/kudos" method="post">
//     authenticity_token, kudo[commentable_id], kudo[commentable_type], submit "Kudos ♥"
// Null when the page has none (you're signed out, or it's your own work).
export function parseKudosForm(html: string): AO3KudosForm | null {
  const formHtml = html.match(/<form\b[^>]*\bid=["']new_kudo["'][\s\S]*?<\/form>/i)?.[0];
  if (!formHtml) return null;
  const authenticityToken = getInputValue(formHtml, "authenticity_token");
  const commentableId = getInputValue(formHtml, "kudo[commentable_id]");
  const commentableType = getInputValue(formHtml, "kudo[commentable_type]");
  if (!authenticityToken || !commentableId || !commentableType) return null;
  const action = getAttr(formHtml, "action") || "/kudos";
  const submit = formHtml.match(/<input\b(?=[^>]*\btype=["']submit["'])[^>]*>/i);
  return {
    actionUrl: /^https?:\/\//i.test(action) ? action : `https://archiveofourown.org${action.startsWith("/") ? "" : "/"}${action}`,
    authenticityToken,
    commentableId,
    commentableType,
    commitLabel: (submit ? getAttr(submit[0], "value") : undefined) || "Kudos ♥",
  };
}

export interface AO3KudosResult {
  // True when the kudos were left. "Already left" is not ok, but is `alreadyGiven`.
  ok: boolean;
  alreadyGiven?: boolean;
  // What to tell the person — AO3's own wording when it gave one.
  message: string;
}

const THANKS = "Thank you for leaving kudos!";
const ALREADY = "You have already left kudos here. :)";

// AO3 answers in one of two shapes: on success the notice
// <div id="kudos_message" class="notice">Thank you for leaving kudos!</div>
// (possibly inside a script, so its quotes may be escaped), and on a repeat a
// JSON body {"error_message": "You have already left kudos here. :)"}.
export function readKudosResponse(status: number, body: string): AO3KudosResult {
  try {
    const json = JSON.parse(body);
    if (json && typeof json.error_message === "string") {
      return {
        ok: false,
        alreadyGiven: /already left kudos/i.test(json.error_message),
        message: json.error_message,
      };
    }
  } catch {
    // Not JSON: look for the notice below.
  }

  const notice = body.match(/id=\\?["']kudos_message\\?["'][^>]*>([\s\S]*?)<\\?\/div>/i)?.[1];
  const text = notice ? notice.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
  if (text) return { ok: true, message: text };

  if (status >= 200 && status < 300) {
    return /already left kudos/i.test(body)
      ? { ok: false, alreadyGiven: true, message: ALREADY }
      : { ok: true, message: THANKS };
  }
  if (status === 401 || status === 403) {
    return { ok: false, message: "AO3 may have signed you out. Reload and sign in again to leave kudos." };
  }
  if (status === 422) return { ok: false, message: "AO3 rejected the request. Reload the chapter and try again." };
  return { ok: false, message: "Couldn't leave kudos right now. Please try again." };
}

export async function postKudos(form: AO3KudosForm, referer: string): Promise<AO3KudosResult> {
  const body = new URLSearchParams();
  body.append("authenticity_token", form.authenticityToken);
  body.append("kudo[commentable_id]", form.commentableId);
  body.append("kudo[commentable_type]", form.commentableType);
  body.append("commit", form.commitLabel);

  try {
    const res = await fetchWithSession(form.actionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        Referer: referer,
      },
      body: body.toString(),
    });
    return readKudosResponse(res.status, await res.text());
  } catch (err) {
    console.warn("[ao3Kudos] Posting kudos failed:", err);
    return { ok: false, message: "Couldn't reach AO3. Check your connection and try again." };
  }
}
