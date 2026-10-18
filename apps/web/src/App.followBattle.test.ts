import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Follow-battle camera wiring at the source level (the canvas needs WebGL;
// the tracker + glide math are covered headless in followBattle.test.ts,
// the impact hook in combatFx.test.ts).

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(here, "App.tsx"), "utf8");
const canvasSource = readFileSync(join(here, "renderer", "TerrainCanvas.tsx"), "utf8");

describe("follow-battle toggle", () => {
  it("defaults followBattle to false in the View options state", () => {
    expect(appSource).toMatch(/followBattle:\s*false/);
  });

  it("keeps a working Follow battle toggle wired to the view options", () => {
    expect(appSource).toContain('label="Follow battle"');
    expect(appSource).toContain("options.followBattle");
    expect(appSource).toContain("patch({ followBattle:");
  });
});

describe("follow-battle tick wiring", () => {
  it("feeds every impact into the combat-event ring", () => {
    expect(canvasSource).toContain("const followTracker = new CombatEventTracker();");
    expect(canvasSource).toContain("combat.onCombatEvent = (x, z) => {");
    expect(canvasSource).toContain("followTracker.record(x, z);");
  });

  it("ages the ring on battle dt every tick, mode on or off", () => {
    // Toggling on mid-battle must immediately have live context.
    expect(canvasSource).toContain("followTracker.tick(dt);");
  });

  it("glides only while the toggle is on and no manual input holds the camera", () => {
    expect(canvasSource).toContain(
      "if (opt.followBattle && !followSuppressed(t, followLastManual, followUserDriving)) {",
    );
    expect(canvasSource).toContain("const centroid = followTracker.centroid();");
  });

  it("rests on a quiet field instead of drifting to a stale point", () => {
    expect(canvasSource).toContain("if (centroid) {");
  });

  it("moves camera + target rigidly through the existing pan path and clamps", () => {
    // Yaw/pitch/zoom survive; the mode-off path below is untouched.
    expect(canvasSource).toContain("followBattleStep(");
    expect(canvasSource).toContain("applyPan(camera.position, controls.target, step);");
  });
});

describe("follow-battle manual-input hold", () => {
  it("brackets orbit/drag/zoom gestures with start/end listeners", () => {
    expect(canvasSource).toContain('controls.addEventListener("start", onFollowStart);');
    expect(canvasSource).toContain('controls.addEventListener("end", onFollowEnd);');
    expect(canvasSource).toContain('controls.removeEventListener("start", onFollowStart);');
    expect(canvasSource).toContain('controls.removeEventListener("end", onFollowEnd);');
  });

  it("stamps keyboard pans and minimap jumps as manual input", () => {
    // followLastManual is written in three places: keyboard pan, minimap
    // jump, and gesture end. All three must survive future edits.
    const writes = canvasSource.match(/followLastManual = (t|followBattleT);/g) ?? [];
    expect(writes).toHaveLength(3);
  });
});
