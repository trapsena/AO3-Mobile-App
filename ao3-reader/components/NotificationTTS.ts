// NotificationTTS — the text-to-speech controller in the phone's notification
// shade (play/pause + previous/next paragraph), which also keeps the reading
// going while the app is in the background. Everything for it is in this file.
//
// How: expo-audio can attach notification / lock-screen controls to an audio
// *player*, but the TTS isn't one (expo-speech hands text to Android's speech
// engine, and the Gemini path plays a throwaway clip per paragraph). So while
// the speech controls are open, a silent looping track is registered for those
// controls instead. expo-audio runs its foreground service and media
// notification for it — and the foreground service is what keeps this app's JS,
// which chains one paragraph into the next, running with the screen off. The
// notification's buttons act on the silent track, and what happens to it is
// mirrored back onto the TTS:
//   play / pause button          -> resume / pause the reading
//   "back 10 s" / "forward 10 s" -> previous / next paragraph
//
// Needs a native build (development build or release APK): expo-audio's
// service and permissions come from its config plugin (the "expo-audio" entry
// in app.json), which Expo Go can't apply to itself, so it's skipped there.

import { useEffect, useMemo, useRef } from "react";
import { Platform } from "react-native";
import { isRunningInExpoGo } from "expo";
import { Asset } from "expo-asset";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import type { AudioLockScreenOptions, AudioMetadata, AudioPlayer, AudioStatus } from "expo-audio";

const TAG = "[NotificationTTS]";
const DEFAULT_TITLE = "AO3 Reader";
const STATUS_UPDATE_INTERVAL_MS = 500;
const LOCK_SCREEN_OPTIONS: AudioLockScreenOptions = {
  showSeekBackward: true,
  showSeekForward: true,
  // Turns scrubbing off (a drag would read as a pile of button presses) while
  // leaving the two seek buttons alone. Android's media card still draws the
  // silent track's own bar and time; expo-audio gives no way to hide those.
  isLiveStream: true,
};

// ---------------------------------------------------------------------------
// Silent keep-alive track
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 8000;
const BYTES_PER_SAMPLE = 2; // 16-bit PCM: the WAV flavour every decoder handles
const WAV_HEADER_BYTES = 44;
const LEADING_SAMPLE_BYTES = 4;

// Long enough that the playhead can drift a good while before it has to be
// pulled back (see SeekButtonDetector), short enough to keep the generated
// data: URI around a megabyte.
export const KEEP_ALIVE_TRACK_SECONDS = 60;

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// `bytes.length` must be a multiple of 3, so no "=" padding is ever needed.
const bytesToBase64 = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64_ALPHABET[(triple >> 18) & 63];
    out += BASE64_ALPHABET[(triple >> 12) & 63];
    out += BASE64_ALPHABET[(triple >> 6) & 63];
    out += BASE64_ALPHABET[triple & 63];
  }
  return out;
};

const writeAscii = (target: Uint8Array, offset: number, text: string) => {
  for (let i = 0; i < text.length; i++) target[offset + i] = text.charCodeAt(i);
};

// A data: URI for a mono 16-bit PCM WAV that is pure silence. The samples are
// never materialised: silence is all zero bytes, and base64 turns every three
// zero bytes into "AAAA", so the body is one repeated string. The 44-byte
// header plus the first 4 sample bytes is 48 bytes, a whole number of base64
// groups, which is why the sample data is 4 bytes plus an even number of 3-byte
// groups (even, so it stays a whole number of 16-bit samples).
export const buildSilentWavDataUri = (seconds: number = KEEP_ALIVE_TRACK_SECONDS): string => {
  const evenGroupPairs = Math.max(1, Math.round((seconds * SAMPLE_RATE * BYTES_PER_SAMPLE) / 6));
  const groups = evenGroupPairs * 2;
  const dataSize = LEADING_SAMPLE_BYTES + groups * 3;

  const prefix = new Uint8Array(WAV_HEADER_BYTES + LEADING_SAMPLE_BYTES);
  const view = new DataView(prefix.buffer);
  writeAscii(prefix, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(prefix, 8, "WAVE");
  writeAscii(prefix, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true); // bits per sample
  writeAscii(prefix, 36, "data");
  view.setUint32(40, dataSize, true);

  return `data:audio/wav;base64,${bytesToBase64(prefix)}${"AAAA".repeat(groups)}`;
};

// ---------------------------------------------------------------------------
// Reading the notification's skip buttons
// ---------------------------------------------------------------------------

// expo-audio's notification has play/pause plus optional "back 10 s" /
// "forward 10 s" buttons. It has no previous/next, and presses go straight to
// the native player with no JS callback — the only trace is the playhead
// jumping. The two seek buttons are borrowed as previous/next paragraph by
// watching for that jump.
export const SEEK_STEP_SECONDS = 10;

// A normal status tick advances the playhead ~0.5 s, so a jump this big can
// only be a button press...
const MIN_SEEK_JUMP = 4;
// ...unless it is huge: that is the loop wrapping around, or our own
// recentering below, neither of which is a press.
const MAX_SEEK_JUMP = 25;

// A seek that runs into the start or end of the track gets clamped and moves
// the playhead by less than a full step, which would be missed. So the
// playhead is kept inside [RECENTER_BELOW, RECENTER_ABOVE] — at least a step
// clear of both ends — by seeking back to RECENTER_TO whenever it leaves.
const RECENTER_BELOW = 8;
const RECENTER_ABOVE = KEEP_ALIVE_TRACK_SECONDS - SEEK_STEP_SECONDS - 5;
const RECENTER_TO = 15;

// After asking for a recenter, status ticks that still carry the old position
// are skipped until one lands near the target.
const LANDING_TOLERANCE = 2;
const MAX_LANDING_TICKS = 12;

export interface SeekDetectorResult {
  // Paragraphs to move by: negative = back, positive = forward, 0 = no press.
  steps: number;
  // Position (seconds) the caller should seek the player to, or null.
  recenterTo: number | null;
}

const NO_CHANGE: SeekDetectorResult = { steps: 0, recenterTo: null };

export class SeekButtonDetector {
  private last: number | null = null;
  private landingAt: number | null = null;
  private landingTicks = 0;

  reset() {
    this.last = null;
    this.landingAt = null;
    this.landingTicks = 0;
  }

  // Feed every status update's playhead position (seconds), in order.
  push(position: number): SeekDetectorResult {
    if (!Number.isFinite(position)) return NO_CHANGE;

    if (this.landingAt !== null) {
      this.landingTicks += 1;
      if (Math.abs(position - this.landingAt) <= LANDING_TOLERANCE || this.landingTicks >= MAX_LANDING_TICKS) {
        this.landingAt = null;
      }
      this.last = position;
      return NO_CHANGE;
    }

    let steps = 0;
    if (this.last !== null) {
      const delta = position - this.last;
      const size = Math.abs(delta);
      if (size >= MIN_SEEK_JUMP && size <= MAX_SEEK_JUMP) {
        steps = Math.sign(delta) * Math.max(1, Math.round(size / SEEK_STEP_SECONDS));
      }
    }
    this.last = position;

    let recenterTo: number | null = null;
    if (position < RECENTER_BELOW || position > RECENTER_ABOVE) {
      recenterTo = RECENTER_TO;
      this.landingAt = RECENTER_TO;
      this.landingTicks = 0;
    }
    return { steps, recenterTo };
  }
}

// ---------------------------------------------------------------------------
// The notification session
// ---------------------------------------------------------------------------

export interface NotificationTTSInfo {
  // Bold first line of the notification — the fic.
  title: string;
  // Second line — the chapter.
  subtitle: string;
  // Where in the chapter the reading is, shown after the chapter on that line.
  progress: string;
}

export interface NotificationTTSControls {
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
// trying anyway only logs errors and makes the silent track take audio focus
// (pausing other apps' music) for nothing.
const supported = () => Platform.OS !== "web" && !isRunningInExpoGo();

// The picture beside the title (assets/notification-art.png, the white play
// circle from the in-app controls). Purely decoration, so it is fetched after
// the notification is already up and can never hold it back or break it. In a
// release build a bundled image can resolve to a file:///android_res/ path
// that Android can't read as a normal file, so only real file/http URLs count.
const loadArtworkUrl = async (): Promise<string | undefined> => {
  try {
    const asset = Asset.fromModule(require("../assets/notification-art.png"));
    await asset.downloadAsync();
    const url = asset.localUri ?? undefined;
    if (url && /^(file|https?):\/\//.test(url) && !url.includes("/android_res/")) return url;
    console.log(TAG, "no usable artwork URL, skipping:", url);
  } catch (error) {
    console.log(TAG, "artwork unavailable:", error);
  }
  return undefined;
};

export class NotificationTTSSession {
  private player: StatusPlayer | null = null;
  private subscription: StatusSubscription | null = null;
  private controls: NotificationTTSControls | null = null;
  private info: NotificationTTSInfo = { title: "", subtitle: "", progress: "" };
  private readonly detector = new SeekButtonDetector();

  // What the TTS wants right now, and the state the player last reported.
  // Comparing the two is how a press in the notification (the player changes
  // by itself) is told apart from the echo of our own play() / pause().
  private wantPlaying = false;
  private observedPlaying = false;
  private artworkUrl: string | undefined;

  // Opening is async (the audio mode has to be applied first); stop() bumps
  // `generation` so an open still in flight can tell it was cancelled.
  private opening = false;
  private generation = 0;

  // Called when the speech controls appear. A failed open is not remembered:
  // the next play (setPlaying) and the next time the controls open both try
  // again.
  start(info: NotificationTTSInfo, controls: NotificationTTSControls) {
    this.info = info;
    this.controls = controls;
    this.ensureOpen();
  }

  setPlaying(playing: boolean) {
    this.wantPlaying = playing;
    const player = this.player;
    if (!player) {
      if (playing) this.ensureOpen(); // second chance if the first open failed
      return;
    }
    try {
      if (playing) player.play();
      else player.pause();
    } catch (error) {
      console.warn(TAG, "could not sync the notification state:", error);
    }
  }

  updateInfo(info: NotificationTTSInfo) {
    this.info = info;
    const player = this.player;
    if (!player) return;
    try {
      player.updateLockScreenMetadata(this.metadata());
    } catch (error) {
      console.warn(TAG, "could not update the notification text:", error);
    }
  }

  stop() {
    this.generation += 1;
    this.opening = false;
    this.wantPlaying = false;
    this.controls = null;
    this.release();
  }

  private ensureOpen() {
    if (!supported() || this.player || this.opening || !this.controls) return;
    this.opening = true;
    this.generation += 1;
    void this.open(this.generation);
  }

  private async open(generation: number) {
    let opened = false;
    try {
      console.log(TAG, "opening the notification controller");
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
      opened = true;
      console.log(TAG, "notification controller is up");
    } catch (error) {
      console.warn(TAG, "could not open the notification controller:", error);
      this.release();
    } finally {
      if (generation === this.generation) this.opening = false;
    }
    if (opened) void this.addArtwork(generation);
  }

  private async addArtwork(generation: number) {
    const url = await loadArtworkUrl();
    const player = this.player;
    if (!url || !player || generation !== this.generation) return;
    this.artworkUrl = url;
    try {
      player.updateLockScreenMetadata(this.metadata());
    } catch (error) {
      console.warn(TAG, "could not set the notification artwork:", error);
      this.artworkUrl = undefined;
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
    const { title, subtitle, progress } = this.info;
    // A one-shot's "chapter" is the fic's own title, so don't print it twice.
    const chapter = subtitle && subtitle !== title ? subtitle : "";
    return {
      title: title || DEFAULT_TITLE,
      // The second line carries the position too ("Chapter 3 · 2/110", like
      // the counter in the in-app controls): Android's media card has no room
      // for a third line.
      artist: [chapter, progress].filter(Boolean).join(" · ") || undefined,
      artworkUrl: this.artworkUrl,
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
      console.warn(TAG, "error closing the notification controller:", error);
    }
  }
}

const notificationTTS = new NotificationTTSSession();

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseNotificationTTSOptions extends NotificationTTSInfo {
  // Whether the TTS is reading aloud right now.
  speaking: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSkip: (steps: number) => void;
}

// Shows the notification controller for as long as the calling component is
// mounted (the open speech controls): it appears the moment they do, showing
// paused until the reading plays.
export const useNotificationTTS = ({
  speaking,
  title,
  subtitle,
  progress,
  onPlay,
  onPause,
  onSkip,
}: UseNotificationTTSOptions) => {
  // Notification presses arrive outside React, long after the render that
  // registered them, so they go through a ref to always reach the latest
  // handlers instead of a stale paragraph index.
  const handlers = useRef({ onPlay, onPause, onSkip });
  handlers.current = { onPlay, onPause, onSkip };

  const controls = useMemo<NotificationTTSControls>(
    () => ({
      play: () => handlers.current.onPlay(),
      pause: () => handlers.current.onPause(),
      skip: (steps) => handlers.current.onSkip(steps),
    }),
    []
  );

  const info = useMemo(() => ({ title, subtitle, progress }), [title, subtitle, progress]);

  useEffect(() => {
    notificationTTS.start(info, controls);
    return () => notificationTTS.stop();
    // Mount / unmount only: `info` changes every paragraph and is pushed by
    // the effect below instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    notificationTTS.updateInfo(info);
  }, [info]);

  useEffect(() => {
    notificationTTS.setPlaying(speaking);
  }, [speaking]);
};
