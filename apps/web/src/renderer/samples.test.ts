import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AttackMode, UnitKind } from "@scorched-3d/core";
import {
  ACK_ALIAS,
  SAMPLE_URLS,
  SELECT_ALIAS,
  deathLayers,
  explosionLayers,
  shotLayers,
  spawnLayers,
  type SampleAlias,
} from "./samples";

const here = dirname(fileURLToPath(import.meta.url));
const SFX_DIR = join(here, "sfx");

const KINDS: UnitKind[] = ["commander", "stump", "flash", "hammer", "peewee"];
const ATTACKS: AttackMode[] = ["round", "grenade"];

/**
 * The curated subset, pinned: alias → vendored file. If the mix grows,
 * add the sample here AND to the manifest — this table fails loudly on
 * drift so no cue ever points at a file that isn't vendored (or vice
 * versa: unreferenced binaries would bloat the single-file bundle).
 */
const ALIAS_FILES: Record<SampleAlias, string> = {
  laserSmallPeewee: "laserSmall_000.ogg",
  laserSmallBolt: "laserSmall_002.ogg",
  laserLargeShell: "laserLarge_000.ogg",
  metalThud: "impactMetal_002.ogg",
  metalTear: "impactMetal_000.ogg",
  crunchBlast: "explosionCrunch_000.ogg",
  crunchDeath: "explosionCrunch_001.ogg",
  crunchEpic: "explosionCrunch_003.ogg",
  subBoom: "lowFrequency_explosion_000.ogg",
  subPop: "lowFrequency_explosion_001.ogg",
  doorClank: "doorClose_001.ogg",
  confirm: "confirmation_001.ogg",
  selectTick: "select_001.ogg",
};

describe("sample manifest", () => {
  it("registers every alias with a bundled URL string", () => {
    const aliases = Object.keys(SAMPLE_URLS) as SampleAlias[];
    expect(aliases).toHaveLength(13);
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const alias of aliases) {
      expect(typeof SAMPLE_URLS[alias]).toBe("string");
      expect(SAMPLE_URLS[alias]!.length).toBeGreaterThan(0);
    }
  });

  it("vendors every registered sample on disk as a real Ogg file", () => {
    for (const [alias, file] of Object.entries(ALIAS_FILES)) {
      const path = join(SFX_DIR, file);
      expect(existsSync(path), `${alias} → ${file}`).toBe(true);
      const head = readFileSync(path).subarray(0, 4).toString("ascii");
      expect(head, `${file} magic`).toBe("OggS");
    }
  });

  it("vendors nothing unreferenced: no stale binaries bloat the bundle", () => {
    const onDisk = readdirSync(SFX_DIR).filter((f) => f.endsWith(".ogg")).sort();
    const referenced = Object.values(ALIAS_FILES).sort();
    expect(onDisk).toEqual(referenced);
  });

  it("ships both Kenney CC0 licenses next to the samples", () => {
    for (const [file, pack] of [
      ["LICENSE-kenney-interface-sounds.txt", "Interface Sounds"],
      ["LICENSE-kenney-sci-fi-sounds.txt", "Sci-Fi Sounds"],
    ] as const) {
      const path = join(SFX_DIR, file);
      expect(existsSync(path), file).toBe(true);
      const text = readFileSync(path, "utf8");
      expect(text).toContain(pack);
      expect(text).toContain("Kenney");
      expect(text).toContain("Creative Commons Zero, CC0");
    }
  });
});

describe("sample resolvers", () => {
  it("voices every weapon: hammer booms, peewee zaps, grenades thump", () => {
    for (const kind of KINDS) {
      for (const attack of ATTACKS) {
        const layers = shotLayers(kind, attack);
        expect(layers).toHaveLength(1);
        expect(layers[0]).toMatchObject({ trim: 1, delay: 0 });
        expect(layers[0]!.alias in SAMPLE_URLS).toBe(true);
      }
    }
    expect(shotLayers("hammer", "round")[0]!.alias).toBe("laserLargeShell");
    expect(shotLayers("peewee", "round")[0]!.alias).toBe("laserSmallPeewee");
    expect(shotLayers("stump", "round")[0]!.alias).toBe("laserSmallBolt");
    expect(shotLayers("flash", "round")[0]!.alias).toBe("laserSmallBolt");
    expect(shotLayers("commander", "round")[0]!.alias).toBe("laserSmallBolt");
    // A lobbed shell is no bolt: every grenade thumps metal.
    for (const kind of KINDS) {
      expect(shotLayers(kind, "grenade")[0]!.alias).toBe("metalThud");
    }
  });

  it("stages blasts: pops small, epics layer a late sub boom", () => {
    for (const kind of KINDS) {
      for (const attack of ATTACKS) {
        for (const epic of [false, true]) {
          for (const layer of explosionLayers(kind, attack, epic)) {
            expect(layer.alias in SAMPLE_URLS).toBe(true);
            expect(layer.trim).toBeGreaterThan(0);
            expect(layer.trim).toBeLessThanOrEqual(1);
            expect(layer.delay).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
    expect(explosionLayers("stump", "round", false).map((l) => l.alias)).toEqual(["crunchBlast"]);
    expect(explosionLayers("peewee", "round", false).map((l) => l.alias)).toEqual(["subPop"]);
    const epic = explosionLayers("hammer", "round", true);
    expect(epic.map((l) => l.alias)).toEqual(["crunchEpic", "subBoom"]);
    expect(epic[1]).toMatchObject({ trim: 0.7, delay: 0.12 });
  });

  it("tears wrecks and clanks the factory door twice", () => {
    expect(deathLayers().map((l) => l.alias)).toEqual(["crunchDeath", "metalTear"]);
    expect(deathLayers()).toMatchObject([{ trim: 0.9, delay: 0 }, { trim: 0.35, delay: 0 }]);
    // Release + settle: the same door twice, the echo softer and later.
    expect(spawnLayers().map((l) => l.alias)).toEqual(["doorClank", "doorClank"]);
    expect(spawnLayers()).toMatchObject([{ trim: 1, delay: 0 }, { trim: 0.8, delay: 0.09 }]);
  });

  it("registers the HUD aliases (ack + select)", () => {
    expect(ACK_ALIAS in SAMPLE_URLS).toBe(true);
    expect(SELECT_ALIAS in SAMPLE_URLS).toBe(true);
    expect(ACK_ALIAS).not.toBe(SELECT_ALIAS);
  });
});

describe("synth removal", () => {
  it("voices samples, not oscillators: no synth survives in sound.ts", () => {
    const sound = readFileSync(join(here, "sound.ts"), "utf8");
    expect(sound).not.toContain("createOscillator");
    expect(sound).not.toContain("OscillatorType");
    expect(sound).not.toContain("noiseBuffer");
    expect(sound).toContain('from "./samples"');
    expect(sound).toContain("voiceSample");
    expect(sound).toContain("decodeAudioData");
  });
});
