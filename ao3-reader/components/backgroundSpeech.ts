// Puts a play/pause (+ skip) controller for the TTS reading in the phone's
// notification shade, and keeps the reading going while the app is in the
// background.
//
// How: expo-audio can attach lock-screen / notification controls to an audio
// *player*, but the TTS isn't one (expo-speech hands text to Android's speech
// engine, and the Gemini path plays a throwaway clip per paragraph). So while
// the person is listening we play a silent, looping track and register that
// player for lock-screen controls. expo-audio then runs its foreground
// service and media notification for it — and the foreground service is what
// keeps this app's JS, which chains one paragraph into the next, running with
// the screen off. The notification's buttons act on the silent track, and we
// mirror what happens to it back onto the TTS:
//   play / pause button          -> resume / pause the reading
//   "back 10 s" / "forward 10 s" -> previous / next paragraph
//
// This needs a native build (development build or release APK). expo-audio's
// foreground service and its permissions are added by its config plugin (the
// "expo-audio" entry in app.json), which Expo Go can't apply to itself, so the
// session is skipped there entirely (see supported() below): the reading
// behaves as it did before this existed.

import { useEffect, useMemo, useRef } from "react";
import { Platform } from "react-native";
import { isRunningInExpoGo } from "expo";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import type { AudioLockScreenOptions, AudioMetadata, AudioPlayer, AudioStatus } from "expo-audio";
import { buildSilentWavDataUri, SeekButtonDetector } from "./backgroundSpeechCore";

const DEFAULT_TITLE = "AO3 Reader";
const STATUS_UPDATE_INTERVAL_MS = 500;
const LOCK_SCREEN_OPTIONS: AudioLockScreenOptions = {
  showSeekBackward: true,
  showSeekForward: true,
  // The silent track's length and progress mean nothing to the person
  // listening, and a bar they could drag would read as a pile of button
  // presses. Flagging it as a live stream hides the duration and the scrub
  // bar (and disables scrubbing) while leaving the two seek buttons alone.
  isLiveStream: true,
};

export interface BackgroundSpeechInfo {
  // Bold first line of the notification — the fic.
  title: string;
  // Second line — the chapter.
  subtitle: string;
  // Small text next to the app name — where in the chapter the reading is.
  progress: string;
}

export interface BackgroundSpeechControls {
  play: () => void;
  pause: () => void;
  // Negative = back, positive = forward, in paragraphs.
  skip: (steps: number) => void;
}

type StatusSubscription = { remove: () => void };
// expo-audio's AudioPlayer typings don't expose addListener here (geminiTTS.ts
// trips over the same thing), so spell out the one call that's needed.
type StatusPlayer = AudioPlayer & {
  addListener: (event: "playbackStatusUpdate", listener: (status: AudioStatus) => void) => StatusSubscription;
};

// Not on the web (nothing to show), and not in Expo Go: its manifest has no
// expo-audio playback service, so the notification can't appear there, and
// trying anyway only logs two errors and makes the silent track take audio
// focus (pausing other apps' music) for nothing.
const supported = () => Platform.OS !== "web" && !isRunningInExpoGo();

class BackgroundSpeechSession {
  private player: StatusPlayer | null = null;
  private subscription: StatusSubscription | null = null;
  private controls: BackgroundSpeechControls | null = null;
  private info: BackgroundSpeechInfo = { title: "", subtitle: "", progress: "" };
  private readonly detector = new SeekButtonDetector();

  // What the TTS wants right now, and the state the player last reported.
  // Comparing the two is how a press in the notification (the player changes
  // by itself) is told apart from the echo of our own play() / pause().
  private wantPlaying = false;
  private observedPlaying = false;

  // start() is async (the audio mode has to be applied first); stop() bumps
  // `generation` so a start() still in flight can tell it was cancelled.
  private opening = false;
  private generation = 0;
  // Set once the platform refused a session, so it isn't retried (and logged)
  // for every later paragraph.
  private unavailable = false;

  start(info: BackgroundSpeechInfo, controls: BackgroundSpeechControls) {
    this.info = info;
    this.controls = controls;
    if (!supported() || this.unavailable || this.player || this.opening) return;
    this.opening = true;
    this.generation += 1;
    void this.open(this.generation);
  }

  setPlaying(playing: boolean) {
    this.wantPlaying = playing;
    const player = this.player;
    if (!player) return;
    try {
      if (playing) player.play();
      else player.pause();
    } catch (error) {
      console.warn("[BackgroundSpeech] Could not sync the notification state:", error);
    }
  }

  updateInfo(info: BackgroundSpeechInfo) {
    this.info = info;
    const player = this.player;
    if (!player) return;
    try {
      player.updateLockScreenMetadata(this.metadata());
    } catch (error) {
      console.warn("[BackgroundSpeech] Could not update the notification text:", error);
    }
  }

  stop() {
    this.generation += 1;
    this.opening = false;
    this.wantPlaying = false;
    this.controls = null;
    this.release();
  }

  private async open(generation: number) {
    try {
      // Lock-screen controls only attach under "doNotMix", and background
      // playback has to be on for the session to outlive the screen.
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: "doNotMix",
      });
      if (generation !== this.generation) return; // stop() ran while the mode was being applied

      const player = createAudioPlayer(
        { uri: buildSilentWavDataUri() },
        { updateInterval: STATUS_UPDATE_INTERVAL_MS }
      ) as StatusPlayer;
      this.player = player;
      this.detector.reset();
      this.observedPlaying = false;
      player.loop = true;
      this.subscription = player.addListener("playbackStatusUpdate", this.handleStatus);
      player.setActiveForLockScreen(true, this.metadata(), LOCK_SCREEN_OPTIONS);
      if (this.wantPlaying) player.play();
    } catch (error) {
      console.warn("[BackgroundSpeech] Notification controller unavailable:", error);
      this.unavailable = true;
      this.release();
    } finally {
      if (generation === this.generation) this.opening = false;
    }
  }

  private readonly handleStatus = (status: AudioStatus) => {
    // The notification's seek buttons move the silent track's playhead, which
    // is the only trace of a press (see SeekButtonDetector).
    const { steps, recenterTo } = this.detector.push(status.currentTime);
    if (recenterTo !== null) this.seekTo(recenterTo);
    if (steps !== 0) this.controls?.skip(steps);

    const playing = status.playing;
    if (playing === this.observedPlaying) return;
    this.observedPlaying = playing;
    if (playing === this.wantPlaying) return; // our own play() / pause() coming back
    // Something else flipped the player: the notification's play/pause button,
    // or the system (a call, another app taking audio focus, headphones
    // unplugged). Either way the TTS should follow.
    this.wantPlaying = playing;
    if (playing) this.controls?.play();
    else this.controls?.pause();
  };

  private seekTo(seconds: number) {
    const player = this.player;
    if (!player) return;
    try {
      player.seekTo(seconds).catch(() => {});
    } catch {
      // A failed recenter only means the detector retries on a later update.
    }
  }

  private metadata(): AudioMetadata {
    return {
      title: this.info.title || DEFAULT_TITLE,
      artist: this.info.subtitle || undefined,
      albumTitle: this.info.progress || undefined,
    };
  }

  private release() {
    const player = this.player;
    const subscription = this.subscription;
    this.player = null;
    this.subscription = null;
    this.observedPlaying = false;
    try {
      subscription?.remove();
    } catch {
      // already gone
    }
    if (!player) return;
    try {
      player.pause();
      player.setActiveForLockScreen(false);
      player.remove();
    } catch (error) {
      console.warn("[BackgroundSpeech] Error closing the notification controller:", error);
    }
  }
}

const backgroundSpeech = new BackgroundSpeechSession();

interface UseBackgroundSpeechOptions extends BackgroundSpeechInfo {
  // Whether the TTS is reading aloud right now.
  speaking: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSkip: (steps: number) => void;
}

// Shows the notification controller for as long as the calling component is
// mounted (the open speech controls). The notification is first posted when
// reading starts rather than when the controls appear, so merely opening them
// doesn't spawn a notification and a foreground service.
export const useBackgroundSpeech = ({
  speaking,
  title,
  subtitle,
  progress,
  onPlay,
  onPause,
  onSkip,
}: UseBackgroundSpeechOptions) => {
  // Notification presses arrive outside React, long after the render that
  // registered them, so they go through a ref to always reach the latest
  // handlers instead of a stale paragraph index.
  const handlers = useRef({ onPlay, onPause, onSkip });
  handlers.current = { onPlay, onPause, onSkip };

  const controls = useMemo<BackgroundSpeechControls>(
    () => ({
      play: () => handlers.current.onPlay(),
      pause: () => handlers.current.onPause(),
      skip: (steps) => handlers.current.onSkip(steps),
    }),
    []
  );

  const info = useMemo(() => ({ title, subtitle, progress }), [title, subtitle, progress]);

  // Deliberately keyed on `speaking` alone: `info` changes every paragraph and
  // is pushed by the effect below.
  useEffect(() => {
    if (speaking) backgroundSpeech.start(info, controls);
    backgroundSpeech.setPlaying(speaking);
  }, [speaking]);

  useEffect(() => {
    backgroundSpeech.updateInfo(info);
  }, [info]);

  useEffect(() => () => backgroundSpeech.stop(), []);
};
