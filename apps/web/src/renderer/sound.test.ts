import { describe, expect, it } from "vitest";
import {
  SoundFx,
  SOUND_MAX_VOICES,
  SOUND_REF_DISTANCE,
  soundGainForDistance,
  stereoPan,
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
});
