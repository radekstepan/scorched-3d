import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildHq, getHqDoor, poseHqWreck, setDoorLift } from './hq';

describe('armored HQ architecture', () => {
  it('carries the complete shutter and chimney detailing through animation', () => {
    const hq = buildHq(0), door = getHqDoor(hq)!;
    hq.updateMatrixWorld(true);
    const parts: THREE.Mesh[] = [];
    door.traverse(o => { if (o instanceof THREE.Mesh) parts.push(o); });
    const before = parts.map(o => o.getWorldPosition(new THREE.Vector3()));
    setDoorLift(hq, 32); hq.updateMatrixWorld(true);
    parts.forEach((o, i) => expect(o.getWorldPosition(new THREE.Vector3()).y - before[i]!.y).toBeCloseTo(32));
    const roof = hq.getObjectByName('hq-roof')!;
    const y = roof.position.y;
    poseHqWreck(hq);
    expect(roof.position.y).toBe(y - 6);
    for (const tower of hq.children.filter(o => o.name === 'hq-chimney')) {
      expect(tower.children.length).toBeGreaterThan(0);
      expect(tower.rotation.z).toBeCloseTo(.14);
    }
  });
  it('owns independent instance resources and stays within the geometry budget', () => {
    const a = buildHq(0), b = buildHq(0);
    const ma = a.getObjectByName('hq-shell') as THREE.Mesh;
    const mb = b.getObjectByName('hq-shell') as THREE.Mesh;
    expect(ma.geometry).not.toBe(mb.geometry);
    expect(ma.material).not.toBe(mb.material);
    let triangles = 0, draws = 0;
    a.traverse(o => { if (o instanceof THREE.Mesh) {
      triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; draws++;
    }});
    expect(triangles).toBeLessThan(4000);
    // 38 base draws + 3 for the team-flag mast (pole, cloth, finial).
    expect(draws).toBeLessThan(43);
    poseHqWreck(a);
    expect((mb.material as THREE.MeshLambertMaterial).color.getHex()).not.toBe(0x14100b);
  });
});
