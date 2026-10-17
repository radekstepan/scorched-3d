import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { UNIT_KINDS } from "@scorched-3d/core";
import { buildStudySubject, disposeStudySubject } from "./subject";

describe("study subject", () => {
  it.each(UNIT_KINDS)("builds %s with model, comparison, effects and a fitted measure grid", (kind) => {
    const subject = buildStudySubject(kind);
    expect(subject.kind).toBe(kind);
    expect(subject.root.children).toContain(subject.body);
    expect(subject.root.children).toContain(subject.legacy);
    expect(subject.root.children).toContain(subject.animation.effects);
    expect(subject.root.children).toContain(subject.grid);
    expect(subject.size).toBeGreaterThan(0);
    expect(subject.grid.position.y).toBeCloseTo(-0.1);
    // Every hull mesh casts shadows like the mounted studio body did.
    const meshes: THREE.Mesh[] = [];
    subject.body.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) expect(mesh.castShadow).toBe(true);
    // Inspection models track the same bodies the loop will update.
    expect(subject.animation.ring.visible).toBe(false);
    disposeStudySubject(subject);
  });

  it("releases every owned allocation and empties the root on dispose", () => {
    const subject = buildStudySubject("stump");
    const mesh = subject.body.getObjectByProperty("type", "Mesh") as THREE.Mesh;
    const geoDispose = vi.spyOn(mesh.geometry, "dispose");
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const matDispose = vi.spyOn(materials[0]!, "dispose");
    const gridDispose = vi.spyOn(subject.grid.geometry, "dispose");
    disposeStudySubject(subject);
    expect(geoDispose).toHaveBeenCalled();
    expect(matDispose).toHaveBeenCalled();
    expect(gridDispose).toHaveBeenCalled();
    expect(subject.root.children).toHaveLength(0);
  });
});
