import type { AttackMode, UnitKind } from "@scorched-3d/core";
import confirmationUrl from "./sfx/confirmation_001.ogg";
import doorCloseUrl from "./sfx/doorClose_001.ogg";
import crunchBlastUrl from "./sfx/explosionCrunch_000.ogg";
import crunchDeathUrl from "./sfx/explosionCrunch_001.ogg";
import crunchEpicUrl from "./sfx/explosionCrunch_003.ogg";
import metalTearUrl from "./sfx/impactMetal_000.ogg";
import metalThudUrl from "./sfx/impactMetal_002.ogg";
import laserLargeUrl from "./sfx/laserLarge_000.ogg";
import laserSmallPeeweeUrl from "./sfx/laserSmall_000.ogg";
import laserSmallBoltUrl from "./sfx/laserSmall_002.ogg";
import subBoomUrl from "./sfx/lowFrequency_explosion_000.ogg";
import subPopUrl from "./sfx/lowFrequency_explosion_001.ogg";
import selectUrl from "./sfx/select_001.ogg";

/**
 * Sample alias registry: every battle/HUD cue voices one (or two layered)
 * Kenney samples instead of synthesized oscillators.
 *
 * Both packs are Creative Commons Zero (CC0) — see the LICENSE files next
 * to the samples in `./sfx/`. Only the curated subset the mix needs is
 * vendored (13 of ~180 files, ~290 KB): Vite inlines them as data URLs into
 * the single-file bundle, so vendoring whole packs would bloat every page
 * load for samples the game never voices. The full packs live in the
 * author's `~/Downloads` (`kenney_interface-sounds.zip`,
 * `kenney_sci-fi-sounds.zip`); re-curate from there if the mix grows.
 *
 * Nanolathe inspiration (`internal/audio/registry.go`, `sample.go`): stable
 * string aliases decouple authored references from file paths, and decoded
 * PCM is cached for the session (here in `SoundFx`) instead of re-decoded
 * per cue. Layering mirrors nanolathe's multi-sample cues: one admission,
 * several voices.
 *
 * Pure data + pure resolvers: importing this module never touches audio
 * hardware (the URLs are inert strings until `SoundFx` fetches them), so
 * the whole mapping is unit-testable headless.
 */

/** Stable alias for one vendored sample (authored name, not a file path). */
export type SampleAlias =
  | "laserSmallPeewee"
  | "laserSmallBolt"
  | "laserLargeShell"
  | "metalThud"
  | "metalTear"
  | "crunchBlast"
  | "crunchDeath"
  | "crunchEpic"
  | "subBoom"
  | "subPop"
  | "doorClank"
  | "confirm"
  | "selectTick";

/** Alias → bundled sample URL (Vite asset import, inlined into the bundle). */
export const SAMPLE_URLS: Record<SampleAlias, string> = {
  laserSmallPeewee: laserSmallPeeweeUrl,
  laserSmallBolt: laserSmallBoltUrl,
  laserLargeShell: laserLargeUrl,
  metalThud: metalThudUrl,
  metalTear: metalTearUrl,
  crunchBlast: crunchBlastUrl,
  crunchDeath: crunchDeathUrl,
  crunchEpic: crunchEpicUrl,
  subBoom: subBoomUrl,
  subPop: subPopUrl,
  doorClank: doorCloseUrl,
  confirm: confirmationUrl,
  selectTick: selectUrl,
};

/** One voiced layer: which sample, at what trim of the admitted peak, when. */
export interface SampleLayer {
  alias: SampleAlias;
  /** 0..1 multiplier on the cue peak (layers sit under the lead). */
  trim: number;
  /** Seconds after the cue admission to start this layer. */
  delay: number;
}

/**
 * Shot layers: peewee zaps small, bolts crack medium, hammer shells boom
 * large, and grenade launches thump metal (a lobbed shell, not a bolt).
 * One layer each — the admitted peak already stages shell > bolt > peewee.
 */
export function shotLayers(kind: UnitKind, attack: AttackMode): SampleLayer[] {
  if (attack === "grenade") return [{ alias: "metalThud", trim: 1, delay: 0 }];
  if (kind === "hammer") return [{ alias: "laserLargeShell", trim: 1, delay: 0 }];
  if (kind === "peewee") return [{ alias: "laserSmallPeewee", trim: 1, delay: 0 }];
  return [{ alias: "laserSmallBolt", trim: 1, delay: 0 }];
}

/**
 * Explosion layers: ordinary blasts crunch, peewee pops stay a small low
 * thump, and epic structure detonations layer a sub boom under the big
 * crunch (slightly late, like the shockwave arriving after the flash).
 */
export function explosionLayers(
  kind: UnitKind,
  attack: AttackMode,
  epic: boolean,
): SampleLayer[] {
  if (epic) {
    return [
      { alias: "crunchEpic", trim: 1, delay: 0 },
      { alias: "subBoom", trim: 0.7, delay: 0.12 },
    ];
  }
  if (kind === "peewee" && attack === "round") return [{ alias: "subPop", trim: 1, delay: 0 }];
  return [{ alias: "crunchBlast", trim: 1, delay: 0 }];
}

/**
 * Death layers: the kill blast plus tearing metal — a wreck is a blast
 * with a hull ripping, not just a bigger pop.
 */
export function deathLayers(): SampleLayer[] {
  return [
    { alias: "crunchDeath", trim: 0.9, delay: 0 },
    { alias: "metalTear", trim: 0.35, delay: 0 },
  ];
}

/**
 * Spawn layers: the factory door clanks twice (release + settle), so a
 * fresh hull reads as machinery, not a UI blip.
 */
export function spawnLayers(): SampleLayer[] {
  return [
    { alias: "doorClank", trim: 1, delay: 0 },
    { alias: "doorClank", trim: 0.8, delay: 0.09 },
  ];
}

/** Order-acknowledge blip (HUD: no distance, centered). */
export const ACK_ALIAS: SampleAlias = "confirm";

/** Selection tick (HUD: no distance, centered). */
export const SELECT_ALIAS: SampleAlias = "selectTick";
