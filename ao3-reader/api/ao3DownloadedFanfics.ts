// The list behind the Downloaded Works screen: every HTML work in the app's
// "Fanfics" folder, with the card data (tags, stats, ...) read out of each
// file's own <dl class="tags"> block. That data is saved on the phone (one
// AsyncStorage entry per file), so opening the screen shows every card
// straight away; a file is only read again when it is new or has changed.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, FileMode, Paths } from "expo-file-system";
import type { AO3WorkBlurbData } from "../components/AO3WorkBlurb";
import { DOWNLOADS_FOLDER_NAME } from "./ao3Download";
import { parseDownloadedFanficHtml } from "./ao3DownloadedMeta";
import { DownloadedWork, parseDownloadedWork } from "./ao3DownloadedWork";
import { decodeUtf8 } from "./htmlText";

// One storage entry per downloaded file ("<prefix><file name>") rather than one
// big list, so the list can grow without hitting AsyncStorage's per-row size
// limit. Bump the version when the parser starts producing different data: old
// entries are then read again from their files.
const KEY_PREFIX = "ao3_downloaded_fanfic_v1:";
const CACHE_VERSION = 2;

// The title, tags and summary sit at the very top of the file, long before the
// story text, so only this much of each (possibly multi-megabyte) file is read.
const HEAD_BYTES = 128 * 1024;

export interface DownloadedFanficEntry {
  fileName: string;
  uri: string;
  sizeBytes: number;
  // When the file was written (milliseconds since epoch); 0 if unknown.
  savedAt: number;
  work: AO3WorkBlurbData;
}

interface StoredEntry {
  version: number;
  sizeBytes: number;
  savedAt: number;
  work: AO3WorkBlurbData;
}

const isHtmlFile = (name: string) => /\.html?$/i.test(name);

const byNewestFirst = (a: DownloadedFanficEntry, b: DownloadedFanficEntry) =>
  b.savedAt - a.savedAt || a.fileName.localeCompare(b.fileName);

const downloadsFolder = () => new Directory(Paths.document, DOWNLOADS_FOLDER_NAME);

async function readStoredEntries(): Promise<Map<string, StoredEntry>> {
  const stored = new Map<string, StoredEntry>();
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(KEY_PREFIX));
    if (keys.length === 0) return stored;
    for (const [key, raw] of await AsyncStorage.multiGet(keys)) {
      if (!raw) continue;
      try {
        const entry = JSON.parse(raw) as StoredEntry;
        const valid =
          entry &&
          entry.version === CACHE_VERSION &&
          typeof entry.sizeBytes === "number" &&
          typeof entry.savedAt === "number" &&
          entry.work &&
          typeof entry.work.title === "string";
        if (valid) stored.set(key.slice(KEY_PREFIX.length), entry);
      } catch {
        // A damaged entry is simply read again from its file.
      }
    }
  } catch (error) {
    console.warn("[ao3DownloadedFanfics] Could not read the saved list:", error);
  }
  return stored;
}

function readHead(file: File, size: number): string {
  try {
    const handle = file.open(FileMode.ReadOnly);
    try {
      return decodeUtf8(handle.readBytes(Math.min(size, HEAD_BYTES)));
    } finally {
      handle.close();
    }
  } catch {
    return decodeUtf8(file.bytesSync().subarray(0, HEAD_BYTES));
  }
}

function parseFile(file: File, size: number): AO3WorkBlurbData {
  try {
    return parseDownloadedFanficHtml(readHead(file, size), file.name);
  } catch (error) {
    // Unreadable file: still list it, as a card with just its file-name title.
    console.warn("[ao3DownloadedFanfics] Could not read", file.name, error);
    return parseDownloadedFanficHtml("", file.name);
  }
}

// What was saved last time, without looking at the folder — instant, so the
// screen can draw its cards before the folder check below has finished. A file
// deleted since then is dropped by that check.
export async function loadCachedDownloadedFanfics(): Promise<DownloadedFanficEntry[]> {
  const stored = await readStoredEntries();
  const folder = downloadsFolder();
  const entries: DownloadedFanficEntry[] = [];
  stored.forEach((entry, fileName) => {
    entries.push({
      fileName,
      uri: new File(folder, fileName).uri,
      sizeBytes: entry.sizeBytes,
      savedAt: entry.savedAt,
      work: entry.work,
    });
  });
  return entries.sort(byNewestFirst);
}

async function syncNow(): Promise<DownloadedFanficEntry[]> {
  const stored = await readStoredEntries();
  const folder = downloadsFolder();
  const files = folder.exists ? folder.list().filter((item): item is File => item instanceof File && isHtmlFile(item.name)) : [];

  const entries: DownloadedFanficEntry[] = [];
  const toSave: Array<[string, string]> = [];
  const present = new Set<string>();

  for (const file of files) {
    const fileName = file.name;
    const info = file.info();
    const sizeBytes = info.size ?? 0;
    if (sizeBytes <= 0) continue;
    const savedAt = info.modificationTime ?? 0;
    present.add(fileName);

    // Same size and same write time as when it was read: nothing has changed.
    const previous = stored.get(fileName);
    let work: AO3WorkBlurbData;
    if (previous && previous.sizeBytes === sizeBytes && previous.savedAt === savedAt) {
      work = previous.work;
    } else {
      work = parseFile(file, sizeBytes);
      const entry: StoredEntry = { version: CACHE_VERSION, sizeBytes, savedAt, work };
      toSave.push([KEY_PREFIX + fileName, JSON.stringify(entry)]);
    }
    entries.push({ fileName, uri: file.uri, sizeBytes, savedAt, work });
  }

  const toRemove: string[] = [];
  stored.forEach((_entry, fileName) => {
    if (!present.has(fileName)) toRemove.push(KEY_PREFIX + fileName);
  });

  try {
    if (toSave.length > 0) await AsyncStorage.multiSet(toSave);
    if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
  } catch (error) {
    // The list is still right for this visit; it is just read again next time.
    console.warn("[ao3DownloadedFanfics] Could not save the list:", error);
  }

  return entries.sort(byNewestFirst);
}

// Reads one downloaded file in full and splits it into chapters (see
// api/ao3DownloadedWork.ts), for reading it in the app without a connection.
export async function loadDownloadedWork(fileName: string): Promise<DownloadedWork> {
  const file = new File(downloadsFolder(), fileName);
  if (!file.exists) throw new Error("This download is no longer on the phone.");
  const work = parseDownloadedWork(await file.text(), fileName);
  if (work.chapters.length === 0) throw new Error("The story text couldn't be found in this file.");
  return work;
}

// Brings the saved list in line with the folder: reads any new or changed
// file, forgets deleted ones, and returns the current list (newest first).
// Runs one at a time, so a sync started by a finished download and one started
// by opening the screen cannot overwrite each other.
let syncQueue: Promise<unknown> = Promise.resolve();
export function syncDownloadedFanfics(): Promise<DownloadedFanficEntry[]> {
  const run = syncQueue.then(syncNow, syncNow);
  syncQueue = run.catch(() => undefined);
  return run;
}
