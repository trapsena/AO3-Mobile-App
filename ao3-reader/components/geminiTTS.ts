// services/TTSService.ts
import * as Speech from "expo-speech";
import { Audio } from "expo-av";
import { Platform } from "react-native";

export type TTSProvider = "expo" | "gemini";

export interface TTSSettings {
  provider: TTSProvider;
  language: string;
  rate: number;
  pitch: number;
  geminiApiKey?: string;
  geminiVoice?: string;
}

export interface TTSServiceInterface {
  speak(text: string, onDone?: () => void): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  isSpeaking(): boolean;
}

class ExpoTTSService implements TTSServiceInterface {
  private settings: TTSSettings;
  private _isSpeaking = false;

  constructor(settings: TTSSettings) {
    this.settings = settings;
  }

  async speak(text: string, onDone?: () => void): Promise<void> {
    await Speech.stop();
    this._isSpeaking = true;
    
    Speech.speak(text, {
      language: this.settings.language,
      rate: this.settings.rate,
      pitch: this.settings.pitch,
      onDone: () => {
        this._isSpeaking = false;
        onDone?.();
      },
      onError: () => {
        this._isSpeaking = false;
      },
    });
  }

  async stop(): Promise<void> {
    await Speech.stop();
    this._isSpeaking = false;
  }

  async pause(): Promise<void> {
    await Speech.pause();
  }

  async resume(): Promise<void> {
    await Speech.resume();
  }

  isSpeaking(): boolean {
    return this._isSpeaking;
  }

  updateSettings(settings: TTSSettings) {
    this.settings = settings;
  }
}

class GeminiTTSService implements TTSServiceInterface {
  private settings: TTSSettings;
  private sound: Audio.Sound | null = null;
  private _isSpeaking = false;
  private _isPaused = false;

  constructor(settings: TTSSettings) {
    this.settings = settings;
    this.initAudio();
  }

  private async initAudio() {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
      });
    } catch (error) {
      console.error("[GeminiTTS] Error setting audio mode:", error);
    }
  }

  async speak(text: string, onDone?: () => void): Promise<void> {
    await this.stop();

    if (!this.settings.geminiApiKey) {
      console.error("[GeminiTTS] API key not configured");
      onDone?.();
      return;
    }

    try {
      this._isSpeaking = true;
      
      console.log("[GeminiTTS] Making request to Gemini API...");
      
      // Fazer requisição para Gemini TTS API
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.settings.geminiApiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text }]
          }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: this.settings.geminiVoice || "Zephyr",
                }
              }
            }
          }
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[GeminiTTS] API Error Response:", errorText);
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log("[GeminiTTS] Response received");
      
      // Extrair áudio da resposta
      const audioData = this.extractAudioFromResponse(data);
      if (!audioData) {
        throw new Error("No audio data in response");
      }

      // Salvar temporariamente e reproduzir
      await this.playAudioData(audioData, onDone);

    } catch (error) {
      console.error("[GeminiTTS] Error:", error);
      this._isSpeaking = false;
      onDone?.();
    }
  }

  private extractAudioFromResponse(data: any): string | null {
    try {
      // Navegar pela estrutura de resposta do Gemini
      const candidates = data.candidates;
      if (!candidates || candidates.length === 0) return null;

      const parts = candidates[0].content?.parts;
      if (!parts || parts.length === 0) return null;

      for (const part of parts) {
        if (part.inlineData?.data) {
          return part.inlineData.data; // Base64
        }
      }
      return null;
    } catch (error) {
      console.error("[GeminiTTS] Error extracting audio:", error);
      return null;
    }
  }

  private async playAudioData(base64Audio: string, onDone?: () => void): Promise<void> {
    try {
      // Criar data URI diretamente do base64
      const dataUri = `data:audio/wav;base64,${base64Audio}`;

      // Criar e carregar som
      const { sound } = await Audio.Sound.createAsync(
        { uri: dataUri },
        { shouldPlay: true },
        this.onPlaybackStatusUpdate(onDone)
      );

      this.sound = sound;

    } catch (error) {
      console.error("[GeminiTTS] Error playing audio:", error);
      this._isSpeaking = false;
      onDone?.();
    }
  }

  private onPlaybackStatusUpdate(onDone?: () => void) {
    return (status: any) => {
      if (status.didJustFinish) {
        this._isSpeaking = false;
        this._isPaused = false;
        onDone?.();
      }
    };
  }

  async stop(): Promise<void> {
    if (this.sound) {
      try {
        await this.sound.stopAsync();
        await this.sound.unloadAsync();
        this.sound = null;
      } catch (error) {
        console.error("[GeminiTTS] Error stopping:", error);
      }
    }
    this._isSpeaking = false;
    this._isPaused = false;
  }

  async pause(): Promise<void> {
    if (this.sound && this._isSpeaking) {
      try {
        await this.sound.pauseAsync();
        this._isPaused = true;
      } catch (error) {
        console.error("[GeminiTTS] Error pausing:", error);
      }
    }
  }

  async resume(): Promise<void> {
    if (this.sound && this._isPaused) {
      try {
        await this.sound.playAsync();
        this._isPaused = false;
      } catch (error) {
        console.error("[GeminiTTS] Error resuming:", error);
      }
    }
  }

  isSpeaking(): boolean {
    return this._isSpeaking;
  }

  updateSettings(settings: TTSSettings) {
    this.settings = settings;
  }
}

// Factory para criar o serviço correto
export class TTSServiceFactory {
  private static currentService: TTSServiceInterface | null = null;
  private static currentSettings: TTSSettings | null = null;

  static getService(settings: TTSSettings): TTSServiceInterface {
    // Se o provider mudou, criar novo serviço
    if (!this.currentService || 
        !this.currentSettings || 
        this.currentSettings.provider !== settings.provider) {
      
      if (this.currentService) {
        this.currentService.stop();
      }

      this.currentService = settings.provider === "gemini"
        ? new GeminiTTSService(settings)
        : new ExpoTTSService(settings);
      
      this.currentSettings = settings;
    } else {
      // Apenas atualizar configurações
      if (this.currentService instanceof ExpoTTSService || 
          this.currentService instanceof GeminiTTSService) {
        this.currentService.updateSettings(settings);
      }
      this.currentSettings = settings;
    }

    return this.currentService;
  }
}