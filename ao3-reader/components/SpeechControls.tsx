import React, { useState, useEffect, useMemo, useRef } from "react";
import { AppState, View, TouchableOpacity, Text, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { TTSServiceFactory, TTSSettings } from "./geminiTTS";
import { useNotificationTTS } from "./NotificationTTS";
import { subscribeToTTSSettings, TTS_SETTINGS_KEY } from "./ttsSettings";
import { ThemeColors, useTheme } from "../contexts/ThemeContext";

interface Props {
  paragraphs: string[];
  onClose: () => void;
  index?: number;
  onIndexChange?: (i: number) => void;
  // What the phone's notification controller shows while reading — the fic and
  // the chapter (see NotificationTTS.ts).
  title?: string;
  subtitle?: string;
}

const SpeechControls: React.FC<Props> = ({
  paragraphs,
  onClose,
  index,
  onIndexChange,
  title,
  subtitle
}) => {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [internalIndex, setInternalIndex] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // Set once the saved voice settings have been read (or found missing), so
  // reading can wait for them instead of starting in the default voice.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [ttsSettings, setTtsSettings] = useState<TTSSettings>({
    provider: "expo",
    language: "pt-BR",
    rate: 1.0,
    pitch: 1.0,
    geminiVoice: "Zephyr",
  });
  
  const currentIndex = typeof index === "number" ? index : internalIndex;
  const playingRef = useRef(false);
  const ttsServiceRef = useRef(TTSServiceFactory.getService(ttsSettings));
  // The live paragraph position. `currentIndex` is a snapshot from the last
  // render, which is stale for anything that fires between renders — taps on
  // the phone's notification controller arrive outside React altogether.
  const indexRef = useRef(currentIndex);
  useEffect(() => {
    indexRef.current = currentIndex;
  }, [currentIndex]);

  // Load TTS settings on mount
  useEffect(() => {
    loadTTSSettings();
  }, []);

  // Settings changed in the reader's settings sheet while these controls are
  // open (engine, language, voice, rate, pitch...) used to be picked up only
  // by closing and reopening them, since storage was read once on mount.
  useEffect(() => subscribeToTTSSettings(setTtsSettings), []);

  // Update TTS service when settings change
  useEffect(() => {
    const next = TTSServiceFactory.getService(ttsSettings);
    const switchedEngine = next !== ttsServiceRef.current;
    ttsServiceRef.current = next;
    // Changing the engine makes the factory stop the old one. If it was
    // reading on its own, carry on from the same paragraph with the new one.
    // Rate/pitch/voice changes within an engine apply from the next paragraph.
    if (switchedEngine && playingRef.current) {
      void speakContinuously(indexRef.current);
    }
  }, [ttsSettings]);

  // Switching TTS on means "read to me", so reading starts by itself from the
  // current paragraph instead of waiting for a second tap on play. It waits
  // for the saved voice settings (declared after the effect above so the
  // loaded engine is already in place when it fires) and for the chapter text,
  // which may still be loading when TTS is switched on. Only once per time the
  // controls open: pausing afterwards stays paused.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current || !settingsLoaded || paragraphs.length === 0) return;
    autoStartedRef.current = true;
    void speakContinuously(indexRef.current);
  }, [settingsLoaded, paragraphs.length]);

  const loadTTSSettings = async () => {
    try {
      const saved = await AsyncStorage.getItem(TTS_SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setTtsSettings({
          provider: parsed.provider || "expo",
          language: parsed.language || "pt-BR",
          rate: parsed.rate || 1.0,
          pitch: parsed.pitch || 1.0,
          geminiApiKey: parsed.geminiApiKey,
          geminiVoice: parsed.geminiVoice || "Zephyr",
        });
        console.log("[SpeechControls] Loaded TTS settings:", parsed);
      }
    } catch (err) {
      console.warn("[SpeechControls] Error loading TTS settings:", err);
    } finally {
      setSettingsLoaded(true);
    }
  };

  const speak = async (text: string, onDone?: () => void) => {
    const service = ttsServiceRef.current;
    await service.stop();
    setIsSpeaking(true);
    
    await service.speak(text, () => {
      setIsSpeaking(false);
      onDone?.();
    });
  };

  const speakContinuously = async (i: number) => {
    if (!paragraphs || i >= paragraphs.length) {
      setIsSpeaking(false);
      playingRef.current = false;
      return;
    }

    notifyIndex(i);

    const txt = paragraphs[i] ?? "";
    if (!txt) {
      speakContinuously(i + 1);
      return;
    }

    playingRef.current = true;
    setIsSpeaking(true);

    const service = ttsServiceRef.current;
    await service.stop();
    
    await service.speak(txt, () => {
      if (playingRef.current && i < paragraphs.length - 1) {
        scheduleNext(i + 1);
      } else {
        setIsSpeaking(false);
        playingRef.current = false;
      }
    });
  };

  // Hands over to the next paragraph. The 80 ms breather only works while the
  // app is in the foreground: React Native's JS timers stop once the Activity
  // pauses, so a timer pending at that moment (or set after it) wouldn't fire
  // until the app came back, and the reading would stall mid-chapter. Whenever
  // the app isn't active, carry on straight away instead.
  const pendingNextRef = useRef<{ timer: ReturnType<typeof setTimeout>; run: () => void } | null>(null);

  const cancelPendingNext = () => {
    const pending = pendingNextRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingNextRef.current = null;
  };

  const scheduleNext = (i: number) => {
    const run = () => {
      void speakContinuously(i);
    };
    if (AppState.currentState !== "active") {
      run();
      return;
    }
    const timer = setTimeout(() => {
      pendingNextRef.current = null;
      run();
    }, 80);
    pendingNextRef.current = { timer, run };
  };

  // Backgrounding while that 80 ms timer is pending would strand it, so flush
  // it the moment the app stops being active.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") return;
      const pending = pendingNextRef.current;
      if (!pending) return;
      cancelPendingNext();
      pending.run();
    });
    return () => {
      subscription.remove();
      cancelPendingNext();
    };
  }, []);

  const notifyIndex = (i: number) => {
    indexRef.current = i;
    if (onIndexChange) onIndexChange(i);
    else setInternalIndex(i);
  };

  const pauseSpeech = async () => {
    cancelPendingNext();
    playingRef.current = false;
    await ttsServiceRef.current.stop();
    setIsSpeaking(false);
  };

  const resumeSpeech = async () => {
    if (playingRef.current) return; // already reading on its own
    await speakContinuously(indexRef.current);
  };

  const handlePlayPause = async () => {
    if (isSpeaking) {
      await pauseSpeech();
    } else {
      await speakContinuously(indexRef.current);
    }
  };

  const skipBy = async (steps: number) => {
    if (paragraphs.length === 0) return;
    const from = indexRef.current;
    const target = Math.min(Math.max(from + steps, 0), paragraphs.length - 1);
    if (target === from) return;

    // If it was reading on its own, carry on from the new spot — otherwise a
    // skip (above all one from the notification, where there's no screen to
    // look at) would quietly end the reading after a single paragraph.
    const wasReading = playingRef.current;
    cancelPendingNext();
    playingRef.current = false;
    await ttsServiceRef.current.stop();

    if (wasReading) {
      await speakContinuously(target);
      return;
    }

    notifyIndex(target);
    const txt = paragraphs[target];
    if (txt) {
      await speak(txt, () => setIsSpeaking(false));
    }
  };

  const handleNext = () => skipBy(1);
  const handlePrev = () => skipBy(-1);

  // The phone's notification controller: play/pause and previous/next from the
  // notification shade, and the reading keeps going with the app in the
  // background. Its buttons call the same handlers as the ones below.
  useNotificationTTS({
    speaking: isSpeaking,
    title: title ?? "",
    subtitle: subtitle ?? "",
    progress: paragraphs.length > 0 ? `${currentIndex + 1}/${paragraphs.length}` : "",
    onPlay: resumeSpeech,
    onPause: pauseSpeech,
    onSkip: skipBy,
  });

  useEffect(() => {
    return () => {
      const service = ttsServiceRef.current;
      service.stop();
    };
  }, []);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onClose}>
        <Ionicons name="close" size={24} color={colors.text} />
      </TouchableOpacity>

      <TouchableOpacity onPress={handlePrev}>
        <Ionicons name="play-back" size={28} color={colors.text} />
      </TouchableOpacity>

      <TouchableOpacity onPress={handlePlayPause}>
        <Ionicons
          name={isSpeaking ? "pause-circle" : "play-circle"}
          size={36}
          color={colors.text}
        />
      </TouchableOpacity>

      <TouchableOpacity onPress={handleNext}>
        <Ionicons name="play-forward" size={28} color={colors.text} />
      </TouchableOpacity>

      <Text style={styles.index}>
        {currentIndex + 1}/{paragraphs.length}
      </Text>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  index: {
    color: colors.textMuted,
    fontSize: 14,
  },
});

export default SpeechControls;