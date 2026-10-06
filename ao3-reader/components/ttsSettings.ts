import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TTSSettings } from "./geminiTTS";

export const TTS_SETTINGS_KEY = "tts_settings";

type Listener = (settings: TTSSettings) => void;
const listeners = new Set<Listener>();

// The reader's settings sheet (ReaderHeader) saves these, and the open speech
// controls (SpeechControls) use them — two components with no parent in common.
// The controls used to read storage once, when they mounted, so a change made
// in the sheet only took effect after closing and reopening them. Saving now
// also broadcasts the new settings, so the controls pick them up live.
export function subscribeToTTSSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Broadcasts first, then persists, so a slider drag shows up in the controls
// without waiting on a storage write for every tick.
export async function saveTTSSettings(settings: TTSSettings): Promise<void> {
  listeners.forEach((listener) => listener(settings));
  try {
    await AsyncStorage.setItem(TTS_SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("[ttsSettings] Error saving TTS settings:", err);
  }
}
