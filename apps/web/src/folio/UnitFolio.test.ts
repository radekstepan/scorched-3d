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
  it("cancels the studio loop and removes observer, controls, models and context on roster change or exit", () => {
    for (const action of ['cancelAnimationFrame(raf)', 'observer.disconnect()', 'controls.dispose()', 'disposeStudioObject(scene)', 'renderer.dispose()', 'renderer.forceContextLoss()', 'renderer.domElement.remove()']) expect(folio).toContain(action);
    expect(folio).toContain('}, [kind])');
    expect(folio).toContain('UNIT_KINDS.map');
    expect(folio).toContain('aria-pressed={kind === unit}');
  });
});
