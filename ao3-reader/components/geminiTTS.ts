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
      
      console.log("[GeminiTTS] Making request to Google Cloud TTS API...");
      
      // Usar Google Cloud Text-to-Speech API (mais estável)
      const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.settings.geminiApiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: this.settings.language || "pt-BR",
            name: this.getGoogleVoiceName(),
          },
          audioConfig: {
            audioEncoding: "MP3",
            speakingRate: this.settings.rate || 1.0,
            pitch: this.settings.pitch || 1.0,
          }
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[GeminiTTS] API Error Response:", errorText);
        throw new Error(`Google TTS API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log("[GeminiTTS] Response received");
      
      // O áudio vem em data.audioContent como base64
      const audioData = data.audioContent;
      if (!audioData) {
        throw new Error("No audio data in response");
      }

      // Reproduzir o áudio
      await this.playAudioData(audioData, onDone);

    } catch (error) {
      console.error("[GeminiTTS] Error:", error);
      this._isSpeaking = false;
      onDone?.();
    }
  }

  private getGoogleVoiceName(): string {
    // Mapear as vozes do Gemini para vozes do Google Cloud TTS
    const voiceMap: Record<string, string> = {
      "Zephyr": "pt-BR-Neural2-A",
      "Puck": "pt-BR-Neural2-B",
      "Charon": "pt-BR-Neural2-C",
      "Kore": "pt-BR-Wavenet-A",
      "Fenrir": "pt-BR-Wavenet-B",
      "Aoede": "pt-BR-Wavenet-C",
    };
    
    const geminiVoice = this.settings.geminiVoice || "Puck";
    return voiceMap[geminiVoice] || "pt-BR-Neural2-A";
  }

  private extractAudioFromSSE(sseText: string): string | null {
    try {
      // O SSE vem no formato:
      // data: {"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"...","data":"..."}}]}}]}
      
      const lines = sseText.split('\n');
      let allAudioData = '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.substring(6); // Remove "data: "
          if (jsonStr.trim() === '[DONE]') continue;
          
          try {
            const data = JSON.parse(jsonStr);
            const candidates = data.candidates;
            
            if (!candidates || candidates.length === 0) continue;
            
            const parts = candidates[0].content?.parts;
            if (!parts || parts.length === 0) continue;
            
            for (const part of parts) {
              if (part.inlineData?.data) {
                allAudioData += part.inlineData.data;
              }
            }
          } catch (e) {
            // Ignorar linhas inválidas
          }
        }
      }
      
      return allAudioData || null;
    } catch (error) {
      console.error("[GeminiTTS] Error extracting audio from SSE:", error);
      return null;
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
      // Google Cloud TTS retorna MP3
      const dataUri = `data:audio/mp3;base64,${base64Audio}`;

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