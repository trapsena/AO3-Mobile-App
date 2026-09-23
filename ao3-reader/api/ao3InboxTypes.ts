import type { AO3Link } from "../components/AO3WorkBlurb";

// One comment in the logged-in user's AO3 inbox (/users/<name>/inbox).
export interface AO3InboxComment {
  // The comment's own id ("feedback_comment_<id>" on the page).
  id: string;
  // The inbox row's id — what the mass-edit form's `inbox_comments[]`
  // checkboxes submit (NOT the same number as the comment id).
  inboxId: string;
  isRead: boolean;
  isReplied: boolean;
  author?: AO3Link;
  // "Chapter 5 of Please...Run With Me Again" and the comment's permalink.
  targetLabel?: string;
  targetHref?: string;
  // https://archiveofourown.org/works/<id>, when the comment is on a work —
  // lets tapping the title open that fic in the Reader.
  workUrl?: string;
  datetime?: string;
  avatarUrl?: string;
  body: string;
}

export interface AO3InboxFilterOption {
  value: string;
  label: string;
  checked: boolean;
}

// One radio group of the inbox's own filter sidebar ("Filter by read",
// "Filter by replied to", "Sort by date"), read straight off the loaded page.
export interface AO3InboxFilterGroup {
  // The radio inputs' shared `name`, e.g. "filters[read]".
  name: string;
  title: string;
  options: AO3InboxFilterOption[];
}

export type AO3InboxMassAction = "read" | "unread" | "delete";

// Whatever the page's mass-edit form rendered (action URL + hidden fields
// like _method/authenticity_token), captured so it can be replayed as-is.
export interface AO3InboxMassEditForm {
  actionUrl?: string;
  fields: Record<string, string>;
  submitValues: Partial<Record<AO3InboxMassAction, string>>;
}
