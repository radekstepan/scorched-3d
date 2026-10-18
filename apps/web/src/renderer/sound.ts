import type { AttackMode, UnitKind } from "@scorched-3d/core";

/**
 * Battle sound: WebAudio-synthesized combat effects, no binary assets.
 *
 * Every shot, blast, death, HQ release, and player order plays a small
 * synthesized cue (pitched oscillators + filtered noise through a shared
 * master compressor), attenuated by camera distance so zooming in makes the
 * battle louder, and panned by the camera-relative bearing of the event.
 *
 * Nanolathe inspiration (`internal/audio/doc.go`, `positional.go`): sound is
 * presentation-only — it reads committed combat events and never touches the
 * simulation — with positional attenuation and viewport-relative pan. The
 * synth itself is local (nanolathe ships PCM samples; this demo synthesizes
 * so the bundle stays sample-free).
 *
 * Headless-safe: the `AudioContext` is created lazily on `unlock()` (called
 * from real input gestures) behind a `window.AudioContext` guard, so node
 * tests construct and drive `SoundFx` without any audio device. Every
 * admitted cue is recorded in `played` either way, so attenuation,
 * throttling, and voice-capping are unit-testable without sound hardware.
 * Sounds never affect the sim: combat fires the hooks, the canvas maps them
 * to distance/pan, and nothing reads back.
 */

/** Event families, each with its own throttle window (see `THROTTLE_MS`). */
export type SoundEventType = "shot" | "explosion" | "death" | "spawn" | "ack";

/** One admitted cue: what sounded (or would have, headless), at what level. */
export interface SoundPlayed {
  type: SoundEventType;
  /** Final voice gain 0..1 after volume × distance × family peak. */
  gain: number;
  /** Stereo placement -1 (left) .. +1 (right). */
  pan: number;
  /** Clock ms when admitted (the injected `now`, for tests). */
  at: number;
}

/**
 * Distance where a cue plays at half its peak: inverse falloff
 * `REF / (REF + d)` reads full up close, halves at 600u (a close duel is
 * still punchy), and fades toward a distant rumble across the map — so
 * zooming the camera in on the fighting makes it louder. Pure for tests.
 */
export const SOUND_REF_DISTANCE = 600;

/** Positional gain 0..1 for a camera→event distance (clamped, pure). */
export function soundGainForDistance(distance: number): number {
  if (!(distance > 0)) return 1;
  if (!Number.isFinite(distance)) return 0;
  return SOUND_REF_DISTANCE / (SOUND_REF_DISTANCE + distance);
}

/**
 * Stereo pan -1..+1 for an event from the camera frame on the ground plane:
 * the event offset projected onto the camera-right axis (forward is
 * camera→target), normalized, widened 1.2×, clamped. An event dead ahead
 * (or exactly under the camera) centers; degenerate frames center too.
 * Pure for tests (no three.js).
 */
export function stereoPan(
  camX: number,
  camZ: number,
  tgtX: number,
  tgtZ: number,
  evX: number,
  evZ: number,
): number {
  const fx = tgtX - camX;
  const fz = tgtZ - camZ;
  const fl = Math.hypot(fx, fz);
  if (!(fl > 0)) return 0;
  // Camera-right on the XZ plane: (-fz, fx), checked against a camera
  // looking down -Z (forward (0,-1) → right (+1,0)).
  const rx = -fz / fl;
  const rz = fx / fl;
  const ox = evX - camX;
  const oz = evZ - camZ;
  const ol = Math.hypot(ox, oz);
  if (!(ol > 0)) return 0;
  const p = ((ox * rx + oz * rz) / ol) * 1.2;
  return Math.max(-1, Math.min(1, p));
}

/** Per-family peak gain (before volume × distance). Deaths hit hardest. */
const FAMILY_PEAK: Record<SoundEventType, number> = {
  shot: 0.6,
  explosion: 0.8,
  death: 1.0,
  spawn: 0.35,
  ack: 0.22,
};

/**
 * Per-family throttle: a second cue of the same family inside the window is
 * dropped, so a full-volley tick cracks instead of stacking into a clip.
 * Families throttle independently — a shot never mutes a death.
 */
const THROTTLE_MS: Record<SoundEventType, number> = {
  shot: 45,
  explosion: 90,
  death: 120,
  spawn: 200,
  ack: 120,
};

/** Concurrent voice ceiling: past this, new cues are dropped, never stolen. */
export const SOUND_MAX_VOICES = 16;

/** Below this final gain a cue is inaudible and dropped before voicing. */
export const SOUND_MIN_GAIN = 0.012;

/** Admitted-cue log cap (oldest evicted; tests read the tail). */
const PLAYED_CAP = 64;

/** Shot voice peak per weapon family (bolts crack, shells thump). */
function shotPeak(kind: UnitKind, attack: AttackMode): number {
  if (attack === "grenade") return 0.5;
  if (kind === "hammer") return 0.9;
  if (kind === "peewee") return 0.38;
  return 0.6;
}

/** Explosion voice peak: epic death bursts peak, peewee pops stay small. */
function explosionPeak(kind: UnitKind, attack: AttackMode, epic: boolean): number {
  if (epic) return 1.0;
  if (kind === "peewee" && attack === "round") return 0.35;
  return 0.7;
}

function audioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class SoundFx {
  private now: () => number;
  private muted = false;
  private volume = 0.8;
  private lastPlayed: Record<SoundEventType, number> = {
    shot: Number.NEGATIVE_INFINITY,
    explosion: Number.NEGATIVE_INFINITY,
    death: Number.NEGATIVE_INFINITY,
    spawn: Number.NEGATIVE_INFINITY,
    ack: Number.NEGATIVE_INFINITY,
  };
  /** Live voice expiry stamps (clock ms); pruned on every admission. */
  private voices: number[] = [];
  /** Admitted cues, oldest-first, capped (recorded headless too). */
  readonly played: SoundPlayed[] = [];
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private disposed = false;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  /** Master volume 0..1 (clamped; non-finite input keeps the old level). */
  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyMaster();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get level(): number {
    return this.volume;
  }

  /** Live voice count (after pruning expired slots), for tests/HUD. */
  voiceCount(): number {
    this.pruneVoices();
    return this.voices.length;
  }

  /**
   * Create/resume the audio device. Called from real input gestures (the
   * autoplay policy keeps the context suspended until one); safe to call
   * every gesture, and a no-op where no AudioContext exists (headless).
   */
  unlock(): void {
    if (this.disposed) return;
    if (this.ctx) {
      if (this.ctx.state === "suspended") {
        try {
          void this.ctx.resume().catch(() => undefined);
        } catch {
          /* a resume that throws stays silent — visuals carry on */
        }
      }
      return;
    }
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      master.connect(comp);
      comp.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  /** True once an audio device exists (false headless / pre-gesture). */
  get hasDevice(): boolean {
    return this.ctx !== null;
  }

  playShot(kind: UnitKind, attack: AttackMode, distance: number, pan: number): void {
    const peak = shotPeak(kind, attack);
    // Shells thump longer than bolts crack (voice slot mirrors the staging).
    const dur = attack === "grenade" ? 0.16 : kind === "hammer" ? 0.3 : 0.11;
    if (!this.admit("shot", peak, distance, pan, dur)) return;
    if (!this.ctx) return;
    if (attack === "grenade") {
      this.blip(280, 130, 0.14, "sine", peak, pan);
    } else if (kind === "hammer") {
      this.blip(120, 38, 0.28, "sine", peak, pan);
      this.noise(0.22, "lowpass", 1400, 180, peak * 0.8, pan);
    } else if (kind === "peewee") {
      this.blip(1400, 500, 0.06, "square", peak, pan);
    } else {
      this.blip(700, 160, 0.09, "square", peak, pan);
      this.noise(0.04, "highpass", 2500, 2500, peak * 0.5, pan);
    }
  }

  playExplosion(
    kind: UnitKind,
    attack: AttackMode,
    epic: boolean,
    distance: number,
    pan: number,
  ): void {
    const peak = explosionPeak(kind, attack, epic);
    const dur = epic ? 1.2 : 0.6;
    if (!this.admit("explosion", peak, distance, pan, dur)) return;
    if (!this.ctx) return;
    this.noise(epic ? 1.1 : 0.55, "lowpass", 2600, 90, peak, pan);
    this.blip(95, 30, epic ? 0.9 : 0.5, "sine", peak * 0.9, pan);
    if (epic) this.blip(70, 26, 0.9, "sine", peak * 0.7, pan, 0.12);
  }

  /** Unit-death cue: the epic blast plus a tearing-metal fall. */
  playDeath(distance: number, pan: number): void {
    const peak = FAMILY_PEAK.death;
    if (!this.admit("death", peak, distance, pan, 1.3)) return;
    if (!this.ctx) return;
    this.noise(1.1, "lowpass", 2400, 80, peak * 0.9, pan);
    this.blip(90, 28, 1.0, "sine", peak * 0.9, pan);
    this.blip(320, 55, 0.45, "sawtooth", peak * 0.35, pan);
  }

  /** HQ release clank: a soft double-thunk at the factory door. */
  playSpawn(distance: number, pan: number): void {
    const peak = FAMILY_PEAK.spawn;
    if (!this.admit("spawn", peak, distance, pan, 0.25)) return;
    if (!this.ctx) return;
    this.blip(170, 85, 0.12, "square", peak, pan);
    this.blip(120, 70, 0.1, "square", peak * 0.8, pan, 0.09);
  }

  /** UI acknowledge for player move/attack orders (no distance — it's HUD). */
  playAck(): void {
    if (!this.admit("ack", FAMILY_PEAK.ack, 0, 0, 0.07)) return;
    if (!this.ctx) return;
    this.blip(980, 990, 0.055, "triangle", FAMILY_PEAK.ack, 0);
  }

  dispose(): void {
    this.disposed = true;
    this.voices = [];
    if (this.ctx) {
      try {
        void this.ctx.close().catch(() => undefined);
      } catch {
        /* closing never throws past here */
      }
      this.ctx = null;
      this.master = null;
      this.noiseBuf = null;
    }
  }

  /**
   * Shared admission gate: mute, throttle, voice cap, and audibility each
   * drop the cue silently; admitted cues take a voice slot and join the
   * `played` log. `peak` is the family peak before volume × distance.
   */
  private admit(
    type: SoundEventType,
    peak: number,
    distance: number,
    pan: number,
    voiceSeconds: number,
  ): boolean {
    if (this.disposed || this.muted) return false;
    const at = this.now();
    if (at - this.lastPlayed[type] < THROTTLE_MS[type]) return false;
    this.pruneVoices();
    if (this.voices.length >= SOUND_MAX_VOICES) return false;
    const gain = peak * this.volume * soundGainForDistance(distance);
    if (!(gain >= SOUND_MIN_GAIN)) return false;
    this.lastPlayed[type] = at;
    this.voices.push(at + voiceSeconds * 1000);
    this.played.push({ type, gain, pan: Math.max(-1, Math.min(1, pan)), at });
    if (this.played.length > PLAYED_CAP) this.played.shift();
    return true;
  }

  private pruneVoices(): void {
    const at = this.now();
    if (this.voices.length === 0) return;
    this.voices = this.voices.filter((until) => until > at);
  }

  private applyMaster(): void {
    if (this.ctx && this.master) {
      try {
        this.master.gain.value = this.muted ? 0 : this.volume;
      } catch {
        /* a dead device stays silent — visuals carry on */
      }
    }
  }

  /** Pitched envelope: `freqA → freqB` exponential over `dur` seconds. */
  private blip(
    freqA: number,
    freqB: number,
    dur: number,
    wave: OscillatorType,
    peak: number,
    pan: number,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.frequency.setValueAtTime(Math.max(20, freqA), t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqB), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      this.attachPan(g, pan);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      osc.onended = () => {
        try {
          osc.disconnect();
          g.disconnect();
        } catch {
          /* already gone */
        }
      };
    } catch {
      /* a failed voice never breaks the frame */
    }
  }

  /** Filtered-noise burst: `fA → fB` sweep over `dur` seconds. */
  private noise(
    dur: number,
    filter: BiquadFilterType,
    fA: number,
    fB: number,
    peak: number,
    pan: number,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx);
      src.loop = true;
      const flt = ctx.createBiquadFilter();
      flt.type = filter;
      const t = ctx.currentTime + delay;
      flt.frequency.setValueAtTime(Math.max(30, fA), t);
      flt.frequency.exponentialRampToValueAtTime(Math.max(30, fB), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(flt);
      flt.connect(g);
      this.attachPan(g, pan);
      src.start(t);
      src.stop(t + dur + 0.02);
      src.onended = () => {
        try {
          src.disconnect();
          flt.disconnect();
          g.disconnect();
        } catch {
          /* already gone */
        }
      };
    } catch {
      /* a failed voice never breaks the frame */
    }
  }

  private attachPan(node: AudioNode, pan: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    if (typeof ctx.createStereoPanner === "function") {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p);
      p.connect(master);
    } else {
      node.connect(master);
    }
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      const len = Math.max(1, Math.floor(ctx.sampleRate));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      // Deterministic pseudo-noise (a mulberry-style hash per sample): the
      // bake is identical every load, so the burst timbre never depends on
      // Math.random at runtime.
      let s = 0x9e3779b9;
      for (let i = 0; i < len; i++) {
        s = (s + 0x6d2b79f5) | 0;
        let z = Math.imul(s ^ (s >>> 15), s | 1);
        z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
        data[i] = (((z ^ (z >>> 14)) >>> 0) % 2000) / 1000 - 1;
      }
      this.noiseBuf = buf;
    }
    return this.noiseBuf;
  }
}
