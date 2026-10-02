// contexts/ThemeContext.tsx
//
// App-wide color theme: a dark/light mode plus a user-chosen accent color
// (replacing the app's original hardcoded "#7ec14b" green everywhere it was
// used for buttons/active states/spinners/etc). Persisted to AsyncStorage so
// the choice survives a restart.
//
// Every screen/component that wants themed colors calls useTheme() and reads
// `colors` — since a module-level StyleSheet.create() is evaluated once at
// import time (before any theme is loaded), themed style objects are built
// by a `createStyles(colors)` function instead, memoized per-component with
// `useMemo(() => createStyles(colors), [colors])`. See AO3WorkBlurb.tsx for
// the reference shape of that pattern.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemeMode = "dark" | "light";

export interface ThemeColors {
  // Screen/page background.
  background: string;
  // Card/panel/modal background — one step up from `background`.
  surface: string;
  // Nested surface inside a card (chips, inputs, secondary buttons).
  surfaceAlt: string;
  // A third, most-raised surface (e.g. a chip inside a filter row that's
  // already inside a panel) — kept subtle relative to `surfaceAlt`.
  surfaceRaised: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  // The user's chosen accent — buttons, active tab/chip states, spinners,
  // links, progress indicators.
  accent: string;
  // Black or white, whichever reads legibly printed on top of `accent`.
  accentText: string;
  danger: string;
}

const DARK_BASE: Omit<ThemeColors, "accent" | "accentText"> = {
  background: "#000000",
  surface: "#111111",
  surfaceAlt: "#1a1a1a",
  surfaceRaised: "#222222",
  border: "#2a2a2a",
  text: "#ffffff",
  textMuted: "#cccccc",
  textFaint: "#888888",
  danger: "#ff6666",
};

const LIGHT_BASE: Omit<ThemeColors, "accent" | "accentText"> = {
  background: "#f4f4f5",
  surface: "#ffffff",
  surfaceAlt: "#f0f0f1",
  surfaceRaised: "#e6e6e8",
  border: "#dadade",
  text: "#111111",
  textMuted: "#3f3f46",
  textFaint: "#71717a",
  danger: "#c0392b",
};

export const DEFAULT_ACCENT_COLOR = "#7ec14b";
const STORAGE_KEY = "ao3_theme_settings_v1";

function isValidHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

// Relative luminance (sRGB) — picks whichever of black/white stays readable
// printed directly on top of an arbitrary accent color, the same way
// Discord's own banner-color picker chooses "Nitro" button text color.
function getReadableTextColor(hex: string): string {
  const c = isValidHexColor(hex) ? hex : DEFAULT_ACCENT_COLOR;
  const r = parseInt(c.slice(1, 3), 16) / 255;
  const g = parseInt(c.slice(3, 5), 16) / 255;
  const b = parseInt(c.slice(5, 7), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#000000" : "#ffffff";
}

interface ThemeContextValue {
  mode: ThemeMode;
  accentColor: string;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  setAccentColor: (hex: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>("dark");
  const [accentColor, setAccentColorState] = useState(DEFAULT_ACCENT_COLOR);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw);
        if (parsed.mode === "dark" || parsed.mode === "light") setModeState(parsed.mode);
        if (typeof parsed.accentColor === "string" && isValidHexColor(parsed.accentColor)) {
          setAccentColorState(parsed.accentColor);
        }
      } catch (err) {
        console.warn("[ThemeContext] Failed to load saved theme:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((next: { mode: ThemeMode; accentColor: string }) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch((err) =>
      console.warn("[ThemeContext] Failed to save theme:", err),
    );
  }, []);

  const setMode = useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      persist({ mode: next, accentColor });
    },
    [accentColor, persist],
  );

  const setAccentColor = useCallback(
    (hex: string) => {
      if (!isValidHexColor(hex)) return;
      setAccentColorState(hex);
      persist({ mode, accentColor: hex });
    },
    [mode, persist],
  );

  const colors = useMemo<ThemeColors>(() => {
    const base = mode === "dark" ? DARK_BASE : LIGHT_BASE;
    return { ...base, accent: accentColor, accentText: getReadableTextColor(accentColor) };
  }, [mode, accentColor]);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, accentColor, colors, setMode, setAccentColor }),
    [mode, accentColor, colors, setMode, setAccentColor],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme() must be called from inside a <ThemeProvider>");
  }
  return ctx;
}
