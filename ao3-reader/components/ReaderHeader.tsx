import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import * as Speech from "expo-speech";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Settings, X } from "lucide-react-native";
import CommentsDrawer from "./CommentsDrawer";
import type { TTSProvider } from "./geminiTTS";

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

const TTS_SETTINGS_KEY = "tts_settings";

const GEMINI_VOICES = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Aoede",
];

interface ReaderHeaderProps {
  fanficTitle: string;
  chapterTitle: string;
  fontSize: number;
  lineSpacing: number;
  paragraphSpacing: number;
  padding: number;
  currentUrl?: string;
  onConfigChange: (config: {
    fontSize?: number;
    lineSpacing?: number;
    paragraphSpacing?: number;
    padding?: number;
  }) => void;
  onToggleTts?: () => void;
  isTtsActive?: boolean;
}

const ReaderHeader: React.FC<ReaderHeaderProps> = ({
  fanficTitle,
  chapterTitle,
  fontSize,
  lineSpacing,
  paragraphSpacing,
  padding,
  currentUrl = "",
  onConfigChange,
  onToggleTts,
  isTtsActive = false,
}) => {
  const [visible, setVisible] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(false);
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
      console.warn("[ReaderHeader] Error loading voices or settings:", err);
      setLoadingVoices(false);
    }
  };

  const saveTTSSettings = async (settings: TTSSettings) => {
    try {
      await AsyncStorage.setItem(TTS_SETTINGS_KEY, JSON.stringify(settings));
      setTtsSettings(settings);
    } catch (err) {
      console.warn("[ReaderHeader] Error saving TTS settings:", err);
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
        console.warn("[ReaderHeader] Error loading voices:", err);
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

  return (
    <>
      {/* 🧭 Header principal */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={styles.fanficTitle}>
            {fanficTitle}
          </Text>
          <Text numberOfLines={1} style={styles.chapterTitle}>
            {chapterTitle}
          </Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TouchableOpacity onPress={() => onToggleTts && onToggleTts()} style={{ marginRight: 4 }}>
            <Ionicons name="headset" size={20} color={isTtsActive ? "#4cd137" : "#fff"} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setCommentsVisible(true)}>
            <Ionicons name="chatbubble-outline" size={20} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setVisible(true)}>
            <Settings color="#fff" size={22} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ⚙️ Modal de configuração */}
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Configurações de Leitura</Text>
              <TouchableOpacity onPress={() => setVisible(false)}>
                <X color="#fff" size={20} />
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
            <ScrollView style={styles.contentContainer} showsVerticalScrollIndicator={false}>
              {activeTab === "text" && (
                <>
                  <View style={styles.setting}>
                    <Text style={styles.label}>Tamanho da fonte: {fontSize}px</Text>
                    <Slider
                      minimumValue={12}
                      maximumValue={28}
                      value={fontSize}
                      onValueChange={(v) => onConfigChange({ fontSize: v })}
                    />
                  </View>

                  <View style={styles.setting}>
                    <Text style={styles.label}>Espaçamento entre linhas: {lineSpacing}</Text>
                    <Slider
                      minimumValue={1.2}
                      maximumValue={2.5}
                      step={0.1}
                      value={lineSpacing}
                      onValueChange={(v) => onConfigChange({ lineSpacing: v })}
                    />
                  </View>

                  <View style={styles.setting}>
                    <Text style={styles.label}>
                      Espaçamento entre parágrafos: {paragraphSpacing}
                    </Text>
                    <Slider
                      minimumValue={0}
                      maximumValue={20}
                      step={1}
                      value={paragraphSpacing}
                      onValueChange={(v) => onConfigChange({ paragraphSpacing: v })}
                    />
                  </View>

                  <View style={styles.setting}>
                    <Text style={styles.label}>Padding lateral: {padding}px</Text>
                    <Slider
                      minimumValue={10}
                      maximumValue={50}
                      step={1}
                      value={padding}
                      onValueChange={(v) => onConfigChange({ padding: v })}
                    />
                  </View>
                </>
              )}

              {activeTab === "tts" && (
                <>
                  {/* Provider Selection - SEMPRE VISÍVEL */}
                  <View style={styles.setting}>
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
                          <View style={styles.setting}>
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

                          <View style={styles.setting}>
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

                          <View style={styles.setting}>
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
                          <View style={styles.setting}>
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

                          <View style={styles.setting}>
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
          </View>
        </View>
      </Modal>

      {/* Comments Drawer */}
      <CommentsDrawer
        visible={commentsVisible}
        currentUrl={currentUrl}
        onClose={() => setCommentsVisible(false)}
      />
    </>
  );
};

const styles = StyleSheet.create({
  header: {
    backgroundColor: "#111",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  fanficTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  chapterTitle: {
    color: "#aaa",
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#222",
    padding: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  tabsContainer: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#333",
    marginBottom: 12,
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
    maxHeight: 400,
  },
  setting: {
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
    backgroundColor: "#333",
    borderWidth: 1,
    borderColor: "#444",
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
    backgroundColor: "#333",
    borderWidth: 1,
    borderColor: "#444",
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
    backgroundColor: "#333",
    borderWidth: 1,
    borderColor: "#444",
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

export default ReaderHeader;