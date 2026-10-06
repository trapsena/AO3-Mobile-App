// Pure logic behind backgroundSpeech.ts. Nothing in here imports React Native
// or expo, so it can be exercised from plain Node.

// ---------------------------------------------------------------------------
// Silent keep-alive track
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 8000;
const BYTES_PER_SAMPLE = 2; // 16-bit PCM: the WAV flavour every decoder handles
const WAV_HEADER_BYTES = 44;
const LEADING_SAMPLE_BYTES = 4;

// Long enough that the position can drift for a good while before it has to be
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

/**
 * A data: URI for a mono 16-bit PCM WAV that is pure silence.
 *
 * The samples are never materialised: PCM silence is all zero bytes, and
 * base64 turns every three zero bytes into "AAAA", so the body is one repeated
 * string. The 44-byte header plus the first 4 sample bytes is 48 bytes, a
 * whole number of base64 groups, which is why the sample data is 4 bytes plus
 * an even number of 3-byte groups (even, so it stays a whole number of 16-bit
 * samples).
 */
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
// Notification skip buttons
// ---------------------------------------------------------------------------

// expo-audio's notification has play/pause plus optional "back 10 s" /
// "forward 10 s" buttons (AudioControlsService.SEEK_INTERVAL_MS). It has no
// previous/next, and presses go straight to the native player with no JS
// callback — the only trace is the playhead jumping. We borrow the two seek
// buttons as previous/next paragraph by watching for that jump.
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
