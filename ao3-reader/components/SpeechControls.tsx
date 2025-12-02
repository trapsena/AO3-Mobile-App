import React, { useState, useEffect, useRef } from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { TTSServiceFactory, TTSSettings } from "./geminiTTS";

interface Props {
  paragraphs: string[];
  onClose: () => void;
  index?: number;
  onIndexChange?: (i: number) => void;
}

const TTS_SETTINGS_KEY = "tts_settings";

const SpeechControls: React.FC<Props> = ({ 
  paragraphs, 
  onClose, 
  index, 
  onIndexChange 
}) => {
  const [internalIndex, setInternalIndex] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
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

  // Load TTS settings on mount
  useEffect(() => {
    loadTTSSettings();
  }, []);

  // Update TTS service when settings change
  useEffect(() => {
    ttsServiceRef.current = TTSServiceFactory.getService(ttsSettings);
  }, [ttsSettings]);

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
        setTimeout(() => speakContinuously(i + 1), 80);
      } else {
        setIsSpeaking(false);
        playingRef.current = false;
      }
    });
  };

  const notifyIndex = (i: number) => {
    if (onIndexChange) onIndexChange(i);
    else setInternalIndex(i);
  };

  const handlePlayPause = async () => {
    const service = ttsServiceRef.current;
    
    if (isSpeaking) {
      playingRef.current = false;
      await service.stop();
      setIsSpeaking(false);
    } else {
      await speakContinuously(currentIndex);
    }
  };

  const handleNext = async () => {
    if (currentIndex < paragraphs.length - 1) {
      const next = currentIndex + 1;
      playingRef.current = false;
      
      const service = ttsServiceRef.current;
      await service.stop();
      
      notifyIndex(next);
      const txt = paragraphs[next];
      if (txt) {
        await speak(txt, () => setIsSpeaking(false));
      }
    }
  };

  const handlePrev = async () => {
    if (currentIndex > 0) {
      const prev = currentIndex - 1;
      playingRef.current = false;
      
      const service = ttsServiceRef.current;
      await service.stop();
      
      notifyIndex(prev);
      const txt = paragraphs[prev];
      if (txt) {
        await speak(txt, () => setIsSpeaking(false));
      }
    }
  };

  useEffect(() => {
    return () => {
      const service = ttsServiceRef.current;
      service.stop();
    };
  }, []);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onClose}>
        <Ionicons name="close" size={24} color="white" />
      </TouchableOpacity>

      <TouchableOpacity onPress={handlePrev}>
        <Ionicons name="play-back" size={28} color="white" />
      </TouchableOpacity>

      <TouchableOpacity onPress={handlePlayPause}>
        <Ionicons
          name={isSpeaking ? "pause-circle" : "play-circle"}
          size={36}
          color="white"
        />
      </TouchableOpacity>

      <TouchableOpacity onPress={handleNext}>
        <Ionicons name="play-forward" size={28} color="white" />
      </TouchableOpacity>

      <Text style={styles.index}>
        {currentIndex + 1}/{paragraphs.length}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(0,0,0,0.9)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderColor: "#333",
  },
  index: {
    color: "#aaa",
    fontSize: 14,
  },
});

export default SpeechControls;