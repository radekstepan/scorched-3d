import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = source("../App.tsx"), terrain = source("../renderer/TerrainCanvas.tsx"), folio = source("./UnitFolio.tsx");

describe("folio / battlefield integration contracts", () => {
  it("keeps the existing battlefield mounted, inert and suspended independently of user pause", () => {
    expect(app).toContain('suspended={view === "folio" || battlePaused}');
    expect(app).toContain('aria-label="Battlefield" inert={view === "folio"}');
    expect(app).toContain('view === "folio" && <UnitFolio />');
    expect(app).toContain('onClick={() => setView("battlefield")}');
    expect(app).not.toContain('setBattlePaused(false)');
  });
  it("gates simulation before all frame work and clears pending input synchronously", () => {
    expect(terrain.indexOf('if (!frame) return;')).toBeLessThan(terrain.indexOf('movement.update('));
    expect(terrain).toContain('if (suspended) clearInputRef.current?.()');
    expect(terrain).toContain('pressed.clear();\n      down = null;\n      boxing = false;');
    for (const name of ['onKeyDown', 'onPointerDown', 'onPointerMove']) {
      expect(terrain).toMatch(new RegExp(`const ${name} = [^\\n]+\\n      if \\(suspendedRef.current\\) return;`));
    }
    expect(terrain).toContain('controls.enabled = !suspendedRef.current;');
  });
  it("connects independent preview controls without rebuilding the paused battlefield", () => {
    for (const name of ["Terrain", "Motion", "Shooting", "Selection ring"]) expect(folio).toContain(`>${name} <span>`);
    expect(folio).toContain('sub.animation.update(dt, current.motion && live, current.shooting && live, current.selection && !current.inspection.wreck)');
    expect(folio).toContain('field.visible = preview.current.terrain');
    expect(folio).toContain('sub.grid.visible = !preview.current.terrain');
    // The toggle still re-applies the backdrop (background + fog); unit lighting itself is terrain-independent.
    expect(folio).toContain('applyStudyLighting(scene, sun, hemi, rim, current.terrain, current.inspection.night)');
    expect(folio).toContain('sun.shadow.dispose()');
  });
  it("exposes all reference workshop settings with explicit unsupported states", () => {
    for (const label of ["Night lighting", "Livery", "Turret traverse", "Barrel elevation", "Battle damage", "Destroyed / wreck pose", "Original model comparison", "Restore study defaults", "Turntable", "Wireframe"]) expect(folio).toContain(label);
    expect(folio).toContain('disabled={kind !== "stump"}');
    expect(folio).toContain('disabled={kind === "commander" || (kind === "stump" && inspection.legacy)}');
    expect(folio).toContain('const live = !current.inspection.wreck && !comparing');
    expect(folio).toContain('study === "rts" ? "Gameplay"');
  });
  it("swaps only the study subject on roster change and tears everything down on exit", () => {
    // Mount effect builds the studio once; the roster effect only swaps subjects.
    expect(folio).toContain('}, []);');
    expect(folio).toContain('actions.current?.swap(kind, view); }, [kind]);');
    // Swap retires the previous subject before mounting the new one.
    expect(folio).toContain('scene.remove(subject.root)');
    expect(folio).toContain('disposeStudySubject(subject)');
    expect(folio).toContain('subject = buildStudySubject(next)');
    // One renderer and one terrain build per visit — never per roster click.
    expect(folio.indexOf('new THREE.WebGLRenderer')).toBe(folio.lastIndexOf('new THREE.WebGLRenderer'));
    expect(folio.indexOf('buildPreviewTerrain()')).toBe(folio.lastIndexOf('buildPreviewTerrain()'));
    for (const action of ['cancelAnimationFrame(raf)', 'observer.disconnect()', 'controls.dispose()', 'disposeStudioObject(scene)', 'renderer.dispose()', 'renderer.forceContextLoss()', 'renderer.domElement.remove()']) expect(folio).toContain(action);
    expect(folio).toContain('UNIT_KINDS.map');
    expect(folio).toContain('aria-pressed={kind === unit}');
  });
});
