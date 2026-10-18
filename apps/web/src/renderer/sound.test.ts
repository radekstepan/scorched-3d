import { describe, expect, it } from "vitest";
import {
  loadSoundPrefs,
  saveSoundPrefs,
  SoundFx,
  SOUND_DEFAULT_PREFS,
  SOUND_MAX_VOICES,
  SOUND_PREFS_KEY,
  SOUND_REF_DISTANCE,
  soundDullForDistance,
  soundGainForDistance,
  stereoPan,
  type SoundPrefsStorage,
} from "./sound";

/** Manual clock (ms) driving the synth's throttle + voice windows. */
function makeClock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("soundGainForDistance", () => {
  it("plays full up close and halves at the reference distance", () => {
    expect(soundGainForDistance(0)).toBe(1);
    expect(soundGainForDistance(-50)).toBe(1);
    expect(soundGainForDistance(SOUND_REF_DISTANCE)).toBeCloseTo(0.5, 12);
  });

  it("zooming in is louder: gain falls monotonically with distance", () => {
    const dists = [15, 100, 600, 1500, 3000, 5000];
    const gains = dists.map(soundGainForDistance);
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]).toBeLessThan(gains[i - 1]!);
    }
    // A close-up (~100u) is dramatically louder than the opening frame (~3000u).
    expect(soundGainForDistance(100)).toBeGreaterThan(soundGainForDistance(3000) * 3);
  });

  it("never blows up: positive for every finite distance, silent past infinity", () => {
    expect(soundGainForDistance(1e9)).toBeGreaterThan(0);
    expect(soundGainForDistance(Number.POSITIVE_INFINITY)).toBe(0);
    expect(soundGainForDistance(Number.NaN)).toBe(1);
  });
});

describe("stereoPan", () => {
  // Camera at the origin looking down -Z (target straight ahead).
  it("centers dead-ahead events and the camera point itself", () => {
    expect(stereoPan(0, 0, 0, -100, 0, -50)).toBeCloseTo(0, 12);
    expect(stereoPan(0, 0, 0, -100, 0, 0)).toBe(0);
  });

  it("pans right-side events right and left-side events left", () => {
    expect(stereoPan(0, 0, 0, -100, 50, -50)).toBeGreaterThan(0);
    expect(stereoPan(0, 0, 0, -100, -50, -50)).toBeLessThan(0);
    // Symmetric offsets pan symmetrically.
    expect(stereoPan(0, 0, 0, -100, 50, -50)).toBeCloseTo(
      -stereoPan(0, 0, 0, -100, -50, -50),
      12,
    );
  });

  it("clamps hard-side events and centers degenerate frames", () => {
    expect(stereoPan(0, 0, 0, -100, 500, 0)).toBe(1);
    expect(stereoPan(0, 0, 0, -100, -500, 0)).toBe(-1);
    expect(stereoPan(10, 10, 10, 10, 99, 99)).toBe(0);
  });
});

describe("SoundFx", () => {
  it("unlocks silently with no audio device (headless)", () => {
    const sound = new SoundFx();
    expect(() => sound.unlock()).not.toThrow();
    expect(sound.hasDevice).toBe(false);
    sound.dispose();
  });

  it("voices louder guns louder: shell > bolt > peewee at the same distance", () => {
    const clock = makeClock();
    const sound = new SoundFx(clock.now);
    sound.playShot("hammer", "round", 0, 0);
    clock.advance(50);
    sound.playShot("stump", "round", 0, 0);
    clock.advance(50);
    sound.playShot("peewee", "round", 0, 0);
    expect(sound.played.map((p) => p.type)).toEqual(["shot", "shot", "shot"]);
    const [shell, bolt, pea] = sound.played.map((p) => p.gain);
    expect(shell).toBeGreaterThan(bolt!);
    expect(bolt).toBeGreaterThan(pea!);
    // Default volume 0.8 scales the hammer peak (0.9) at point blank.
    expect(shell).toBeCloseTo(0.9 * 0.8, 12);
    sound.dispose();
  });

  it("attenuates with distance: the same shot fades as the camera pulls back", () => {
    const clock = makeClock();
    const sound = new SoundFx(clock.now);
    sound.playShot("stump", "round", 100, 0);
    clock.advance(50);
    sound.playShot("stump", "round", 3000, 0);
    const [near, far] = sound.played.map((p) => p.gain);
    expect(near).toBeGreaterThan(far! * 3);
    sound.dispose();
  });

  it("stages explosions bigger than shots, epics biggest, peewee pops smallest", () => {
    const clock = makeClock();
    const sound = new SoundFx(clock.now);
    sound.playShot("stump", "round", 0, 0);
    clock.advance(100);
    sound.playExplosion("stump", "round", false, 0, 0);
    clock.advance(100);
    sound.playExplosion("stump", "round", true, 0, 0);
    clock.advance(100);
    sound.playExplosion("peewee", "round", false, 0, 0);
    const [shot, blast, epic, pop] = sound.played.map((p) => p.gain);
    expect(blast).toBeGreaterThan(shot!);
    expect(epic).toBeGreaterThan(blast!);
    expect(pop).toBeLessThan(shot!);
    sound.dispose();
  });

  it("deaths hit full peak, spawns clank soft, acks center without distance", () => {
    const clock = makeClock();
    const sound = new SoundFx(clock.now);
    sound.playDeath(0, -0.7);
    clock.advance(130);
    sound.playSpawn(0, 0.7);
    clock.advance(210);
    sound.playAck();
    expect(sound.played[0]).toMatchObject({ type: "death", gain: 0.8, pan: -0.7 });
    expect(sound.played[1]).toMatchObject({ type: "spawn", pan: 0.7 });
    expect(sound.played[1]!.gain).toBeLessThan(sound.played[0]!.gain);
    expect(sound.played[2]).toMatchObject({ type: "ack", pan: 0 });
    sound.dispose();
  });

  it("clamps wild pan inputs into -1..1", () => {
    const clock = makeClock();
    const sound = new SoundFx(clock.now);
    sound.playShot("stump", "round", 0, 5);
    clock.advance(50);
    sound.playShot("stump", "round", 0, -9);
    expect(sound.played[0]!.pan).toBe(1);
    expect(sound.played[1]!.pan).toBe(-1);
    sound.dispose();
  });

  it("mute parks the synth, unmute resumes it", () => {
    const clock = makeClock();
    const sound = new SoundFx(clock.now);
    sound.setMuted(true);
    sound.playShot("hammer", "round", 0, 0);
    expect(sound.played).toHaveLength(0);
    expect(sound.isMuted).toBe(true);
    sound.setMuted(false);
    sound.playShot("hammer", "round", 0, 0);
    expect(sound.played).toHaveLength(1);
    sound.dispose();
  });

  it("volume scales every cue, clamps to 0..1, and ignores NaN", () => {
    const clock = makeClock();
    const sound = new SoundFx(clock.now);
    expect(sound.level).toBe(0.8);
    sound.setVolume(0.5);
    sound.playShot("stump", "round", 0, 0);
    expect(sound.played[0]!.gain).toBeCloseTo(0.6 * 0.5, 12);
    sound.setVolume(7);
    expect(sound.level).toBe(1);
    sound.setVolume(-2);
    expect(sound.level).toBe(0);
    clock.advance(50);
    sound.playShot("hammer", "round", 0, 0);
    expect(sound.played).toHaveLength(1);
    sound.setVolume(Number.NaN);
    expect(sound.level).toBe(0);
    sound.dispose();
  });

  it("drops inaudible far-field cues before voicing", () => {
    const clock = makeClock();
    const sound = new SoundFx(clock.now);
    sound.playShot("peewee", "round", 100000, 0);
    expect(sound.played).toHaveLength(0);
    expect(sound.voiceCount()).toBe(0);
    sound.dispose();
  });

  it("throttles repeats per family but lets families overlap", () => {
    const clock = makeClock();
    const sound = new SoundFx(clock.now);
    sound.playShot("stump", "round", 0, 0);
    sound.playShot("hammer", "round", 0, 0);
    expect(sound.played).toHaveLength(1);
    // A different family on the same tick is admitted — shots never mute deaths.
    sound.playDeath(0, 0);
    expect(sound.played).toHaveLength(2);
    clock.advance(45);
    sound.playShot("hammer", "round", 0, 0);
    expect(sound.played).toHaveLength(3);
    sound.dispose();
  });

  it("caps concurrent voices and re-admits once they expire", () => {
    const clock = makeClock();
    const sound = new SoundFx(clock.now);
    // Two long voices (epic blast + death) per 120 ms tick: past the 90/120
    // ms throttles, inside the ~1.2 s voice lives — 8 ticks fill the pool.
    for (let i = 0; i < 9; i++) {
      sound.playExplosion("hammer", "round", true, 0, 0);
      sound.playDeath(0, 0);
      clock.advance(120);
    }
    expect(sound.voiceCount()).toBe(SOUND_MAX_VOICES);
    expect(sound.played).toHaveLength(SOUND_MAX_VOICES);
    clock.advance(2000);
    expect(sound.voiceCount()).toBe(0);
    sound.playDeath(0, 0);
    expect(sound.played).toHaveLength(SOUND_MAX_VOICES + 1);
    sound.dispose();
  });

  it("caps the admitted-cue log, oldest evicted", () => {
    const clock = makeClock();
    const sound = new SoundFx(clock.now);
    for (let i = 0; i < 70; i++) {
      sound.playAck();
      clock.advance(130);
    }
    expect(sound.played).toHaveLength(64);
    expect(sound.played[0]!.at).toBe(6 * 130);
    sound.dispose();
  });

  it("dispose parks the synth: later cues are dropped", () => {
    const clock = makeClock();
    const sound = new SoundFx(clock.now);
    sound.playAck();
    sound.dispose();
    clock.advance(200);
    sound.playAck();
    expect(sound.played).toHaveLength(1);
    expect(() => sound.unlock()).not.toThrow();
  });

  it("humanizes pitch: every cue draws 0.94..1.06 from the injected stream", () => {
    const clock = makeClock();
    // A fixed draw pins the mapping exactly (0.5 → dead center 1.0).
    const sound = new SoundFx(clock.now, () => 0.5);
    sound.playShot("stump", "round", 0, 0);
    expect(sound.played[0]!.pitch).toBeCloseTo(1.0, 12);
    sound.dispose();
    // A cycling stream spreads real cues across the band, never outside it.
    const draws = [0, 0.25, 0.75, 0.9999];
    let i = 0;
    const varied = new SoundFx(clock.now, () => draws[i++ % draws.length]!);
    for (let n = 0; n < 8; n++) {
      varied.playShot("stump", "round", 0, 0);
      clock.advance(50);
    }
    const pitches = varied.played.map((p) => p.pitch);
    expect(pitches).toHaveLength(8);
    for (const p of pitches) {
      expect(p).toBeGreaterThanOrEqual(0.94);
      expect(p).toBeLessThanOrEqual(1.06);
    }
    expect(Math.min(...pitches)).toBeCloseTo(0.94, 12);
    expect(new Set(pitches).size).toBeGreaterThan(1);
    varied.dispose();
  });

  it("draws pitch only for admitted cues: drops cost no stream steps", () => {
    const clock = makeClock();
    const draws: number[] = [];
    let n = 0;
    const sound = new SoundFx(clock.now, () => {
      draws.push(n);
      return (n++ % 100) / 100;
    });
    sound.setMuted(true);
    sound.playShot("stump", "round", 0, 0);
    expect(draws).toHaveLength(0);
    sound.setMuted(false);
    sound.playShot("stump", "round", 0, 0);
    sound.playShot("hammer", "round", 0, 0); // throttled: same tick
    expect(draws).toHaveLength(1);
    sound.dispose();
  });

  it("ticks selections soft: own family, HUD-centered, throttled alone", () => {
    const clock = makeClock();
    const sound = new SoundFx(clock.now);
    sound.playSelect();
    expect(sound.played[0]).toMatchObject({ type: "select", pan: 0 });
    expect(sound.played[0]!.gain).toBeCloseTo(0.18 * 0.8, 12);
    // A repeat inside the window drops, but a shot on the same tick lands.
    sound.playSelect();
    sound.playShot("stump", "round", 0, 0);
    expect(sound.played.map((p) => p.type)).toEqual(["select", "shot"]);
    clock.advance(80);
    sound.playSelect();
    expect(sound.played).toHaveLength(3);
    sound.dispose();
  });
});

describe("soundDullForDistance", () => {
  it("stays bright up close and halves at twice the gain reference", () => {
    expect(soundDullForDistance(0)).toBe(0);
    expect(soundDullForDistance(-50)).toBe(0);
    expect(soundDullForDistance(SOUND_REF_DISTANCE * 2)).toBeCloseTo(0.5, 12);
  });

  it("muffles monotonically: far booms duller than near ones", () => {
    const dists = [100, 600, 1200, 3000, 10000];
    const dulls = dists.map(soundDullForDistance);
    for (let i = 1; i < dulls.length; i++) {
      expect(dulls[i]).toBeGreaterThan(dulls[i - 1]!);
    }
    expect(soundDullForDistance(Number.POSITIVE_INFINITY)).toBe(1);
    expect(soundDullForDistance(Number.NaN)).toBe(0);
  });

  it("records dull on blasts and deaths, never on dry families", () => {
    const clock = makeClock();
    const sound = new SoundFx(clock.now);
    sound.playExplosion("stump", "round", false, 0, 0);
    clock.advance(100);
    sound.playExplosion("stump", "round", false, 5000, 0);
    clock.advance(130);
    sound.playDeath(5000, 0);
    clock.advance(50);
    sound.playShot("stump", "round", 5000, 0);
    const [near, far, death, shot] = sound.played;
    expect(near!.dull).toBe(0);
    expect(far!.dull).toBeGreaterThan(0.5);
    expect(death!.dull).toBeCloseTo(far!.dull, 12);
    expect(shot!.dull).toBe(0);
    sound.dispose();
  });
});

describe("sound prefs", () => {
  /** In-memory localStorage stand-in (same get/set surface). */
  function makeStorage(initial?: Record<string, string>): SoundPrefsStorage & { data: Record<string, string> } {
    const data = { ...(initial ?? {}) };
    return {
      data,
      getItem: (key: string) => (key in data ? data[key]! : null),
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
    };
  }

  it("defaults to muted at 0.8 with no storage or no entry", () => {
    expect(SOUND_DEFAULT_PREFS).toEqual({ muted: true, volume: 0.8 });
    expect(loadSoundPrefs()).toEqual({ muted: true, volume: 0.8 });
    expect(loadSoundPrefs(null)).toEqual({ muted: true, volume: 0.8 });
    expect(loadSoundPrefs(makeStorage())).toEqual({ muted: true, volume: 0.8 });
  });

  it("round-trips mute + volume through storage", () => {
    const storage = makeStorage();
    saveSoundPrefs({ muted: true, volume: 0.35 }, storage);
    expect(storage.data[SOUND_PREFS_KEY]).toBe(JSON.stringify({ muted: true, volume: 0.35 }));
    expect(loadSoundPrefs(storage)).toEqual({ muted: true, volume: 0.35 });
  });

  it("respects an explicit unmute: stored muted:false still wins over the default", () => {
    const storage = makeStorage();
    saveSoundPrefs({ muted: false, volume: 0.6 }, storage);
    expect(loadSoundPrefs(storage)).toEqual({ muted: false, volume: 0.6 });
  });

  it("ignores legacy v1 entries: the old auto-saved unmuted default never unmutes", () => {
    // The v1 key auto-saved `muted:false` on every visit, so a v1-only
    // entry is a stale default, not a choice — the loader reads v2 only.
    expect(SOUND_PREFS_KEY).not.toBe("scorched-3d:sound");
    const storage = makeStorage({ "scorched-3d:sound": '{"muted":false,"volume":0.8}' });
    expect(loadSoundPrefs(storage)).toEqual({ muted: true, volume: 0.8 });
  });

  it("heals corrupt entries field-by-field instead of crashing the panel", () => {
    expect(loadSoundPrefs(makeStorage({ [SOUND_PREFS_KEY]: "not json{" }))).toEqual({
      muted: true,
      volume: 0.8,
    });
    expect(loadSoundPrefs(makeStorage({ [SOUND_PREFS_KEY]: "null" }))).toEqual({
      muted: true,
      volume: 0.8,
    });
    // A valid unmute survives next to a hand-edited garbage volume.
    expect(
      loadSoundPrefs(makeStorage({ [SOUND_PREFS_KEY]: '{"muted":false,"volume":"loud"}' })),
    ).toEqual({ muted: false, volume: 0.8 });
    // Out-of-range volumes clamp into 0..1.
    expect(loadSoundPrefs(makeStorage({ [SOUND_PREFS_KEY]: '{"volume":7}' }))).toEqual({
      muted: true,
      volume: 1,
    });
    expect(loadSoundPrefs(makeStorage({ [SOUND_PREFS_KEY]: '{"volume":-2}' }))).toEqual({
      muted: true,
      volume: 0,
    });
  });

  it("never throws on hostile storage (and never writes without one)", () => {
    const throwing: SoundPrefsStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(() => loadSoundPrefs(throwing)).not.toThrow();
    expect(loadSoundPrefs(throwing)).toEqual({ muted: true, volume: 0.8 });
    expect(() => saveSoundPrefs({ muted: true, volume: 0.5 }, throwing)).not.toThrow();
    expect(() => saveSoundPrefs({ muted: true, volume: 0.5 })).not.toThrow();
  });
});
