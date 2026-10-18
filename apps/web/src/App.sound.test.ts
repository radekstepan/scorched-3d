import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("battle sound HUD + wiring", () => {
  it("exposes a Sound panel (Mute toggle + Volume slider, on at 0.8)", () => {
    const app = readFileSync(join(here, "App.tsx"), "utf8");
    expect(app).toContain("<Label>Sound</Label>");
    expect(app).toContain('label="Mute"');
    expect(app).toContain('label="Volume"');
    expect(app).toContain("options.muted");
    expect(app).toContain("options.volume");
    expect(app).toContain("muted: false");
    expect(app).toContain("volume: 0.8");
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
    expect(canvas).toContain("sound.dispose()");
  });
});
