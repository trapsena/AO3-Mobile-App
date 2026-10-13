// Saves an AO3 work's download (EPUB, PDF, ...) into the app's own "Fanfics"
// folder — the app's private document storage, which stays until the app is
// uninstalled (unlike the cache folder, which the system may clear). Not
// visible in the phone's Files app, since it's the app's own folder.
import { Directory, File, Paths } from "expo-file-system";
import { getCookieHeader } from "./ao3Auth";

export const DOWNLOADS_FOLDER_NAME = "Fanfics";

export interface DownloadedFanfic {
  fileName: string;
  // Where it was saved, for showing to the person.
  folder: string;
  uri: string;
  sizeBytes: number;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// "Title - 1234.epub": the fic's own title makes the file recognisable, and the
// work id keeps two fics with the same title apart. Characters that file
// systems reject are dropped, and the length is capped.
export function buildDownloadFileName(title: string, workId: string | null, href: string, format: string): string {
  const extension = (href.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i)?.[1] ?? format).toLowerCase();
  const cleanTitle = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  const base = [cleanTitle || "Fanfic", workId].filter(Boolean).join(" - ");
  return `${base}.${extension}`;
}

// Everything except an HTML download is a binary file; if the response starts
// like a web page it is AO3's sign-in or error page, not the work.
const looksLikeWebPage = (bytes: Uint8Array) => {
  const head = String.fromCharCode(...bytes.subarray(0, 64)).trimStart().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
};

export async function downloadFanfic(options: {
  href: string;
  format: string;
  title: string;
  workId: string | null;
}): Promise<DownloadedFanfic> {
  const { href, format, title, workId } = options;

  const folder = new Directory(Paths.document, DOWNLOADS_FOLDER_NAME);
  folder.create({ intermediates: true, idempotent: true });

  const file = new File(folder, buildDownloadFileName(title, workId, href, format));
  // Downloading the same fic and format again replaces the earlier copy.
  if (file.exists) file.delete();

  // Sent so a restricted (sign-in only) work downloads for the signed-in user.
  const cookie = await getCookieHeader();
  const saved = await File.downloadFileAsync(href, file, {
    headers: cookie ? { Cookie: cookie } : undefined,
    idempotent: true,
  });

  try {
    const isHtmlFormat = format.toLowerCase() === "html";
    const size = saved.size ?? 0;
    if (size <= 0) throw new Error("The downloaded file was empty.");
    if (!isHtmlFormat && looksLikeWebPage(saved.bytesSync().subarray(0, 64))) {
      throw new Error("AO3 returned a web page instead of the file (are you still signed in?).");
    }
  } catch (error) {
    if (saved.exists) saved.delete();
    throw error;
  }

  return { fileName: saved.name, folder: `${DOWNLOADS_FOLDER_NAME}/`, uri: saved.uri, sizeBytes: saved.size ?? 0 };
}
