import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Dimensions,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from "react-native";
import Slider from "@react-native-community/slider";
import * as Speech from "expo-speech";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { X } from "lucide-react-native";
import type { TTSProvider } from "./geminiTTS";

interface ReaderConfigModalProps {
  visible: boolean;
  fontSize: number;
  lineHeight: number;
  padding: number;
  onChangeFontSize: (value: number) => void;
  onChangeLineHeight: (value: number) => void;
  onChangePadding: (value: number) => void;
  onClose: () => void;
}

interface TTSSettings {
  provider: TTSProvider;
  language: string;
  rate: number;
  pitch: number;
  geminiApiKey?: string;
  geminiVoice?: string;
}

interface Voice {
  identifier: string;
  language: string;
  name: string;
}

const SCREEN_HEIGHT = Dimensions.get("window").height;
const TTS_SETTINGS_KEY = "tts_settings";

const GEMINI_VOICES = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Aoede",
];

const ReaderConfigModal: React.FC<ReaderConfigModalProps> = ({
  visible,
  fontSize,
  lineHeight,
  padding,
  onChangeFontSize,
  onChangeLineHeight,
  onChangePadding,
  onClose,
}) => {
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const [activeTab, setActiveTab] = useState<"text" | "tts">("text");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [ttsSettings, setTtsSettings] = useState<TTSSettings>({
    provider: "expo",
    language: "pt-BR",
    rate: 1.0,
    pitch: 1.0,
    geminiVoice: "Zephyr",
  });

  useEffect(() => {
    if (visible) {
      loadVoicesAndSettings();
    }
  }, [visible]);

  const loadVoicesAndSettings = async () => {
    try {
      const saved = await AsyncStorage.getItem(TTS_SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const loadedSettings = {
          provider: parsed.provider || "expo",
          language: parsed.language || "pt-BR",
          rate: parsed.rate || 1.0,
          pitch: parsed.pitch || 1.0,
          geminiApiKey: parsed.geminiApiKey,
          geminiVoice: parsed.geminiVoice || "Zephyr",
        };
        setTtsSettings(loadedSettings);
        
        // Só carrega as vozes se for Expo Speech
        if (loadedSettings.provider === "expo") {
          setLoadingVoices(true);
          const availableVoices = await Speech.getAvailableVoicesAsync();
          setVoices(availableVoices as Voice[]);
          setLoadingVoices(false);
        }
      } else {
        // Primeira vez - carregar vozes do Expo
        setLoadingVoices(true);
        const availableVoices = await Speech.getAvailableVoicesAsync();
        setVoices(availableVoices as Voice[]);
        setLoadingVoices(false);
      }
    } catch (err) {
      console.warn("[ReaderConfigModal] Error loading voices or settings:", err);
      setLoadingVoices(false);
    }
  };

  const saveTTSSettings = async (settings: TTSSettings) => {
    try {
      await AsyncStorage.setItem(TTS_SETTINGS_KEY, JSON.stringify(settings));
      setTtsSettings(settings);
    } catch (err) {
      console.warn("[ReaderConfigModal] Error saving TTS settings:", err);
    }
  };

  const handleProviderChange = async (provider: TTSProvider) => {
    const updated = { ...ttsSettings, provider };
    saveTTSSettings(updated);
    
    // Carregar vozes do Expo quando trocar para ele
    if (provider === "expo" && voices.length === 0) {
      setLoadingVoices(true);
      try {
        const availableVoices = await Speech.getAvailableVoicesAsync();
        setVoices(availableVoices as Voice[]);
      } catch (err) {
        console.warn("[ReaderConfigModal] Error loading voices:", err);
      } finally {
        setLoadingVoices(false);
      }
    }
  };

  const handleLanguageChange = (language: string) => {
    const updated = { ...ttsSettings, language };
    saveTTSSettings(updated);
  };

  const handleRateChange = (rate: number) => {
    const updated = { ...ttsSettings, rate };
    saveTTSSettings(updated);
  };

  const handlePitchChange = (pitch: number) => {
    const updated = { ...ttsSettings, pitch };
    saveTTSSettings(updated);
  };

  const handleGeminiApiKeyChange = (apiKey: string) => {
    const updated = { ...ttsSettings, geminiApiKey: apiKey };
    saveTTSSettings(updated);
  };

  const handleGeminiVoiceChange = (voice: string) => {
    const updated = { ...ttsSettings, geminiVoice: voice };
    saveTTSSettings(updated);
  };

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : SCREEN_HEIGHT,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible]);

  return (
    <>
      {visible && (
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={onClose}
        />
      )}

      <Animated.View
        style={[
          styles.sheet,
          {
            transform: [{ translateY }],
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Configurações de leitura</Text>
          <TouchableOpacity onPress={onClose}>
            <X color="#fff" size={22} />
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === "text" && styles.activeTab]}
            onPress={() => setActiveTab("text")}
          >
            <Text style={[styles.tabText, activeTab === "text" && styles.activeTabText]}>
              Texto
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === "tts" && styles.activeTab]}
            onPress={() => setActiveTab("tts")}
          >
            <Text style={[styles.tabText, activeTab === "tts" && styles.activeTabText]}>
              Voz (TTS)
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <ScrollView
          style={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          {activeTab === "text" && (
            <>
              <View style={styles.section}>
                <Text style={styles.label}>Tamanho da fonte: {fontSize.toFixed(0)}</Text>
                <Slider
                  minimumValue={12}
                  maximumValue={28}
                  value={fontSize}
                  onValueChange={onChangeFontSize}
                  minimumTrackTintColor="#fff"
                />
              </View>

              <View style={styles.section}>
                <Text style={styles.label}>Espaçamento entre linhas: {lineHeight}</Text>
                <Slider
                  minimumValue={18}
                  maximumValue={40}
                  step={1}
                  value={lineHeight}
                  onValueChange={onChangeLineHeight}
                  minimumTrackTintColor="#fff"
                />
              </View>

              <View style={styles.section}>
                <Text style={styles.label}>Padding lateral: {padding.toFixed(0)}</Text>
                <Slider
                  minimumValue={10}
                  maximumValue={50}
                  value={padding}
                  onValueChange={onChangePadding}
                  minimumTrackTintColor="#fff"
                />
              </View>
            </>
          )}

          {activeTab === "tts" && (
            <>
              {/* Provider Selection - SEMPRE VISÍVEL */}
              <View style={styles.section}>
                <Text style={styles.label}>Motor de TTS</Text>
                <View style={styles.providerContainer}>
                  <TouchableOpacity
                    style={[
                      styles.providerButton,
                      ttsSettings.provider === "expo" && styles.providerButtonActive,
                    ]}
                    onPress={() => handleProviderChange("expo")}
                  >
                    <Text
                      style={[
                        styles.providerButtonText,
                        ttsSettings.provider === "expo" && styles.providerButtonTextActive,
                      ]}
                    >
                      Expo Speech
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.providerButton,
                      ttsSettings.provider === "gemini" && styles.providerButtonActive,
                    ]}
                    onPress={() => handleProviderChange("gemini")}
                  >
                    <Text
                      style={[
                        styles.providerButtonText,
                        ttsSettings.provider === "gemini" && styles.providerButtonTextActive,
                      ]}
                    >
                      Gemini TTS
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {loadingVoices ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color="#fff" />
                  <Text style={styles.loadingText}>Carregando vozes...</Text>
                </View>
              ) : (
                <>
                  {/* Expo Speech Settings */}
                  {ttsSettings.provider === "expo" && (
                    <>
                      <View style={styles.section}>
                        <Text style={styles.label}>Linguagem / Voz</Text>
                        <ScrollView 
                          style={styles.voicesContainer} 
                          horizontal 
                          showsHorizontalScrollIndicator={false}
                        >
                          {voices.length > 0 ? (
                            voices.map((voice) => (
                              <TouchableOpacity
                                key={voice.identifier}
                                style={[
                                  styles.voiceButton,
                                  ttsSettings.language === voice.language && styles.voiceButtonActive,
                                ]}
                                onPress={() => handleLanguageChange(voice.language)}
                              >
                                <Text
                                  style={[
                                    styles.voiceButtonText,
                                    ttsSettings.language === voice.language && styles.voiceButtonTextActive,
                                  ]}
                                  numberOfLines={1}
                                >
                                  {voice.language}
                                </Text>
                              </TouchableOpacity>
                            ))
                          ) : (
                            <Text style={styles.noVoicesText}>Nenhuma voz disponível</Text>
                          )}
                        </ScrollView>
                      </View>

                      <View style={styles.section}>
                        <Text style={styles.label}>Velocidade: {ttsSettings.rate.toFixed(2)}</Text>
                        <Slider
                          minimumValue={0.5}
                          maximumValue={2.0}
                          step={0.1}
                          value={ttsSettings.rate}
                          onValueChange={handleRateChange}
                          minimumTrackTintColor="#fff"
                        />
                      </View>

                      <View style={styles.section}>
                        <Text style={styles.label}>Tom: {ttsSettings.pitch.toFixed(2)}</Text>
                        <Slider
                          minimumValue={0.5}
                          maximumValue={2.0}
                          step={0.1}
                          value={ttsSettings.pitch}
                          onValueChange={handlePitchChange}
                          minimumTrackTintColor="#fff"
                        />
                      </View>
                    </>
                  )}

                  {/* Gemini TTS Settings */}
                  {ttsSettings.provider === "gemini" && (
                    <>
                      <View style={styles.section}>
                        <Text style={styles.label}>API Key do Gemini</Text>
                        <TextInput
                          style={styles.input}
                          value={ttsSettings.geminiApiKey || ""}
                          onChangeText={handleGeminiApiKeyChange}
                          placeholder="AIza..."
                          placeholderTextColor="#666"
                          secureTextEntry
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        <Text style={styles.hint}>
                          Obtenha sua chave em: aistudio.google.com
                        </Text>
                      </View>

                      <View style={styles.section}>
                        <Text style={styles.label}>Voz do Gemini</Text>
                        <ScrollView 
                          style={styles.voicesContainer} 
                          horizontal 
                          showsHorizontalScrollIndicator={false}
                        >
                          {GEMINI_VOICES.map((voice) => (
                            <TouchableOpacity
                              key={voice}
                              style={[
                                styles.voiceButton,
                                ttsSettings.geminiVoice === voice && styles.voiceButtonActive,
                              ]}
                              onPress={() => handleGeminiVoiceChange(voice)}
                            >
                              <Text
                                style={[
                                  styles.voiceButtonText,
                                  ttsSettings.geminiVoice === voice && styles.voiceButtonTextActive,
                                ]}
                              >
                                {voice}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                      </View>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </ScrollView>
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    backgroundColor: "#111",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
    maxHeight: SCREEN_HEIGHT * 0.85,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  title: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  tabsContainer: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#333",
    marginBottom: 15,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
  },
  activeTab: {
    borderBottomColor: "#4dd0e1",
  },
  tabText: {
    color: "#999",
    fontSize: 14,
    fontWeight: "600",
  },
  activeTabText: {
    color: "#4dd0e1",
  },
  contentContainer: {
    maxHeight: SCREEN_HEIGHT * 0.6,
  },
  section: {
    marginVertical: 12,
  },
  label: {
    color: "#ccc",
    marginBottom: 8,
    fontSize: 14,
    fontWeight: "500",
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  loadingText: {
    color: "#999",
    marginTop: 12,
    fontSize: 14,
  },
  providerContainer: {
    flexDirection: "row",
    gap: 10,
  },
  providerButton: {
    flex: 1,
    backgroundColor: "#222",
    borderWidth: 1,
    borderColor: "#333",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  providerButtonActive: {
    backgroundColor: "#4dd0e1",
    borderColor: "#4dd0e1",
  },
  providerButtonText: {
    color: "#999",
    fontSize: 14,
    fontWeight: "600",
  },
  providerButtonTextActive: {
    color: "#000",
  },
  voicesContainer: {
    marginHorizontal: -5,
    paddingHorizontal: 5,
  },
  voiceButton: {
    backgroundColor: "#222",
    borderWidth: 1,
    borderColor: "#333",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginHorizontal: 5,
  },
  voiceButtonActive: {
    backgroundColor: "#4dd0e1",
    borderColor: "#4dd0e1",
  },
  voiceButtonText: {
    color: "#999",
    fontSize: 12,
    fontWeight: "500",
  },
  voiceButtonTextActive: {
    color: "#000",
  },
  noVoicesText: {
    color: "#666",
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 10,
  },
  input: {
    backgroundColor: "#222",
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#fff",
    fontSize: 14,
  },
  hint: {
    color: "#666",
    fontSize: 12,
    marginTop: 6,
    fontStyle: "italic",
  },
});

export default ReaderConfigModal;