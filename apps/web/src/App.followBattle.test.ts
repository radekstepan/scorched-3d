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

  it("glides only while the toggle is on and no pan gesture holds the camera", () => {
    expect(canvasSource).toContain(
      "if (opt.followBattle && !followSuppressed(t, followLastManual, followHold.userPanning)) {",
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
  it("tracks pan gestures from raw pointer buttons, not controls start/end", () => {
    // start/end carry no gesture type and fire once per wheel tick, so a
    // zoom or rotate must never engage the hold — only right-drag and
    // multi-touch pan contacts feed the tracker.
    expect(canvasSource).toContain("const followHold = new FollowHoldTracker();");
    expect(canvasSource).toContain("followHold.pointerDown(ev.button, ev.pointerId, ev.pointerType);");
    expect(canvasSource).toContain("const panEnded = followHold.pointerUp(ev.pointerId);");
    expect(canvasSource).not.toContain('controls.addEventListener("start"');
    expect(canvasSource).not.toContain('controls.addEventListener("end"');
    expect(canvasSource).not.toContain("followUserDriving");
    expect(canvasSource).not.toContain("onFollowStart");
    expect(canvasSource).not.toContain("onFollowEnd");
  });

  it("releases cancelled gestures and resets the hold when input clears", () => {
    // A missed release would hold follow off forever: pointercancel feeds
    // the tracker like a pointerup, and the suspend path resets it.
    expect(canvasSource).toContain('window.addEventListener("pointercancel", onPointerCancel);');
    expect(canvasSource).toContain('window.removeEventListener("pointercancel", onPointerCancel);');
    expect(canvasSource).toContain("followHold.reset();");
  });

  it("stamps keyboard pans, pan-gesture ends, and minimap jumps as manual input", () => {
    // followLastManual is written in four places: keyboard pan, minimap
    // jump, pan-gesture release, and gesture cancel. All four must survive
    // future edits.
    const writes = canvasSource.match(/followLastManual = (t|followBattleT);/g) ?? [];
    expect(writes).toHaveLength(4);
  });

  it("never stamps a right-button click (a unit order, not a drag)", () => {
    // Ordering units mid-battle must not pause the glide: only releases
    // past the click/drag threshold stamp the resume delay.
    expect(canvasSource).toContain("wasDown?.button === 2 && releaseMoved < CLICK_DRAG_PX");
  });
});
