import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("battle sound HUD + wiring", () => {
  it("exposes a Sound panel (Mute toggle + Volume slider, seeded from stored prefs)", () => {
    const app = readFileSync(join(here, "App.tsx"), "utf8");
    expect(app).toContain("<Label>Sound</Label>");
    expect(app).toContain('label="Mute (M)"');
    expect(app).toContain('label="Volume"');
    expect(app).toContain("options.muted");
    expect(app).toContain("options.volume");
    expect(app).toContain("muted: sound.muted");
    expect(app).toContain("volume: sound.volume");
    // Factory mix (muted at 0.8) lives in the prefs loader — see sound.test.ts.
    const sound = readFileSync(join(here, "renderer", "sound.ts"), "utf8");
    expect(sound).toContain("muted: true, volume: 0.8");
  });

  it("canvas voices combat through the positional synth and syncs the panel", () => {
    const canvas = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");
    expect(canvas).toContain("new SoundFx()");
    expect(canvas).toContain("combat.onShotFired = ");
    expect(canvas).toContain("combat.onExplosion = ");
    expect(canvas).toContain("sound.setMuted(");
    expect(canvas).toContain("sound.setVolume(");
    expect(canvas).toContain("sound.unlock()");
    expect(canvas).toContain("sound.playDeath(");
    expect(canvas).toContain("sound.playSpawn(");
    expect(canvas).toContain("sound.playAck()");
    expect(canvas).toContain("sound.playSelect()");
    expect(canvas).toContain("sound.dispose()");
  });

  it("toggles mute from the keyboard: M reaches the panel through onToggleMute", () => {
    const app = readFileSync(join(here, "App.tsx"), "utf8");
    const canvas = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");
    expect(app).toContain('label="Mute (M)"');
    expect(app).toContain("onToggleMute=");
    expect(canvas).toContain("onToggleMute?: () => void");
    expect(canvas).toContain('ev.code === "KeyM"');
    expect(canvas).toContain("toggleMuteRef.current?.()");
  });

  it("persists the Sound panel: stored prefs seed state, edits save back", () => {
    const app = readFileSync(join(here, "App.tsx"), "utf8");
    expect(app).toContain("loadSoundPrefs(");
    expect(app).toContain("saveSoundPrefs(");
    expect(app).toContain("typeof localStorage");
  });
});
