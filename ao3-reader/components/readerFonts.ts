// components/readerFonts.ts
//
// Lets the reader's chapter text (ChapterView, rendered inside a WebView) use
// one of the custom fonts bundled under assets/fonts, instead of only the
// device's default. A font registered natively via expo-font isn't visible
// inside a WebView's own sandboxed HTML document — so instead, each font
// file is read and base64-encoded into a `@font-face` CSS rule and embedded
// directly in the page. That's done lazily (only once a font is actually
// selected) and cached here, so picking a font already used this session is
// instant on every later use.
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";

export type ReaderFontKey =
  | "system"
  | "notoSerif"
  | "openSans"
  | "quicksand"
  | "openDyslexic"
  | "robotoLight";

export const READER_FONT_OPTIONS: { key: ReaderFontKey; label: string }[] = [
  { key: "system", label: "Padrão" },
  { key: "notoSerif", label: "Noto Serif" },
  { key: "openSans", label: "Open Sans" },
  { key: "quicksand", label: "Quicksand" },
  { key: "openDyslexic", label: "OpenDyslexic" },
  { key: "robotoLight", label: "Roboto Light" },
];

// The CSS font-family name each non-system option is registered under,
// inside the reader WebView's own stylesheet (see loadReaderFontFaceCss).
const FONT_FAMILY_NAME: Record<Exclude<ReaderFontKey, "system">, string> = {
  notoSerif: "ReaderNotoSerif",
  openSans: "ReaderOpenSans",
  quicksand: "ReaderQuicksand",
  openDyslexic: "ReaderOpenDyslexic",
  robotoLight: "ReaderRobotoLight",
};

// The `font-family` CSS value to apply to the chapter body for a given
// selection — quoted custom name for a loaded font, or a plain system stack
// for "system" (ChapterView's own default before this feature existed).
export function getReaderFontFamilyCss(key: ReaderFontKey): string {
  if (key === "system") return "-apple-system, Roboto, sans-serif";
  return `"${FONT_FAMILY_NAME[key]}"`;
}

// The same family names, but for registering/reading these fonts through
// expo-font's native `useFonts` — used by the font picker UI (ReaderHeader)
// to preview each option in its own actual typeface. Independent of the
// WebView CSS registration above (different rendering context entirely),
// but reusing the same strings keeps the two trivially easy to cross-reference.
export function getReaderFontNativeFamilyName(key: ReaderFontKey): string | undefined {
  if (key === "system") return undefined;
  return FONT_FAMILY_NAME[key];
}

interface FontFaceSource {
  // The static asset module id Metro resolves `require(...)` to — must stay
  // a literal require() call below for Metro to bundle the file at all.
  module: number;
  format: "truetype" | "opentype";
  weight?: number;
  style?: "normal" | "italic";
}

const FONT_FACES: Record<Exclude<ReaderFontKey, "system">, FontFaceSource[]> = {
  notoSerif: [
    { module: require("../assets/fonts/NotoSerif-VariableFont_wdth,wght.ttf"), format: "truetype", style: "normal" },
    { module: require("../assets/fonts/NotoSerif-Italic-VariableFont_wdth,wght.ttf"), format: "truetype", style: "italic" },
  ],
  openSans: [
    { module: require("../assets/fonts/OpenSans-VariableFont_wdth,wght.ttf"), format: "truetype", style: "normal" },
    { module: require("../assets/fonts/OpenSans-Italic-VariableFont_wdth,wght.ttf"), format: "truetype", style: "italic" },
  ],
  quicksand: [
    { module: require("../assets/fonts/Quicksand-VariableFont_wght.ttf"), format: "truetype", style: "normal" },
  ],
  openDyslexic: [
    { module: require("../assets/fonts/OpenDyslexic-Regular.otf"), format: "opentype", weight: 400, style: "normal" },
    { module: require("../assets/fonts/OpenDyslexic-Bold.otf"), format: "opentype", weight: 700, style: "normal" },
    { module: require("../assets/fonts/OpenDyslexic-Italic.otf"), format: "opentype", weight: 400, style: "italic" },
    { module: require("../assets/fonts/OpenDyslexic-BoldItalic.otf"), format: "opentype", weight: 700, style: "italic" },
  ],
  robotoLight: [
    { module: require("../assets/fonts/Roboto-Light.ttf"), format: "truetype", weight: 300, style: "normal" },
  ],
};

async function readFontFaceAsBase64(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  if (!asset.localUri) {
    throw new Error("[readerFonts] Font asset has no localUri after downloadAsync");
  }
  return FileSystem.readAsStringAsync(asset.localUri, { encoding: FileSystem.EncodingType.Base64 });
}

const fontFaceCssCache = new Map<ReaderFontKey, Promise<string>>();

// Builds (and caches) the full `@font-face` CSS block for one reader font
// option — "" for "system", which needs no custom font at all.
export function loadReaderFontFaceCss(key: ReaderFontKey): Promise<string> {
  if (key === "system") return Promise.resolve("");

  const cached = fontFaceCssCache.get(key);
  if (cached) return cached;

  const familyName = FONT_FAMILY_NAME[key];
  const promise = Promise.all(
    FONT_FACES[key].map(async (face) => {
      const base64 = await readFontFaceAsBase64(face.module);
      const mime = face.format === "opentype" ? "font/otf" : "font/ttf";
      return (
        `@font-face { font-family: "${familyName}"; ` +
        `src: url(data:${mime};base64,${base64}) format("${face.format}"); ` +
        `font-weight: ${face.weight ?? 400}; font-style: ${face.style ?? "normal"}; }`
      );
    }),
  ).then((rules) => rules.join("\n"));

  fontFaceCssCache.set(key, promise);
  return promise;
}
