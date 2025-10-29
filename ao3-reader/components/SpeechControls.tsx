import React, { useState, useEffect } from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import * as Speech from "expo-speech";
import { Ionicons } from "@expo/vector-icons";

interface Props {
  paragraphs: string[];
  onClose: () => void;
  // optional controlled index and callback so parent can highlight current paragraph
  index?: number;
  onIndexChange?: (i: number) => void;
}

const SpeechControls: React.FC<Props> = ({ paragraphs, onClose, index, onIndexChange }) => {
  const [internalIndex, setInternalIndex] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const currentIndex = typeof index === "number" ? index : internalIndex;
  const playingRef = React.useRef(false);

  // Fala o parágrafo atual
  const speak = (text: string, opts?: { onDone?: () => void }) => {
    Speech.stop();
    Speech.speak(text, {
      language: "pt-BR",
      rate: 1.0,
      pitch: 1.0,
      onDone: opts?.onDone ?? (() => setIsSpeaking(false)),
    });
    setIsSpeaking(true);
  };

  // Speak a paragraph and optionally continue to the next paragraphs until the end
  const speakContinuously = (i: number) => {
    if (!paragraphs || i >= paragraphs.length) {
      setIsSpeaking(false);
      playingRef.current = false;
      return;
    }

    // notify parent of index (so highlight updates)
    notifyIndex(i);

    const txt = paragraphs[i] ?? "";
    if (!txt) {
      // advance to next
      speakContinuously(i + 1);
      return;
    }

    // mark as playing
    playingRef.current = true;
    setIsSpeaking(true);

    // speak and onDone continue if still playing
    Speech.stop();
    Speech.speak(txt, {
      language: "pt-BR",
      rate: 1.0,
      pitch: 1.0,
      onDone: () => {
        if (playingRef.current && i < paragraphs.length - 1) {
          // small delay to avoid race conditions
          setTimeout(() => speakContinuously(i + 1), 80);
        } else {
          setIsSpeaking(false);
          playingRef.current = false;
        }
      },
    });
  };

  const notifyIndex = (i: number) => {
    if (onIndexChange) onIndexChange(i);
    else setInternalIndex(i);
  };

  const handlePlayPause = () => {
    if (isSpeaking) {
      // pause/stop
      playingRef.current = false;
      Speech.stop();
      setIsSpeaking(false);
    } else {
      // start continuous reading from currentIndex
      speakContinuously(currentIndex);
    }
  };

  const handleNext = () => {
    if (currentIndex < paragraphs.length - 1) {
      const next = currentIndex + 1;
      // stop any continuous play, then speak the next paragraph (single)
      playingRef.current = false;
      Speech.stop();
      notifyIndex(next);
      const txt = paragraphs[next];
      if (txt) speak(txt, { onDone: () => setIsSpeaking(false) });
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      const prev = currentIndex - 1;
      playingRef.current = false;
      Speech.stop();
      notifyIndex(prev);
      const txt = paragraphs[prev];
      if (txt) speak(txt, { onDone: () => setIsSpeaking(false) });
    }
  };

  useEffect(() => {
    return () => {
      // call but don't return the promise from cleanup
      Speech.stop();
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
