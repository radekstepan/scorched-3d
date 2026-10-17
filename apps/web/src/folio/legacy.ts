import * as THREE from "three";

/** Original Stumpy comparison geometry from the sibling Unit Workshop. */
export function buildLegacyStumpy(): THREE.Group {
  const legacy = new THREE.Group();

  const material = new THREE.MeshLambertMaterial({ color: 0x5a6b46 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2c2c26 });
  const add = (
    parent: THREE.Group,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
  };
  add(legacy, 18, 8, 26, 0, 5, 0, material);
  add(legacy, 19, 2.5, 27, 0, 2, 0, dark);
  const turret = new THREE.Group();
  turret.name = "turret";
  legacy.add(turret);
  legacy.userData.turret = turret;
  add(turret, 12, 7, 14, 0, 12.5, -2, material);
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 2, 22, 8),
    dark,
  );
  barrel.rotation.x = Math.PI / 2 - 0.05;
  barrel.position.set(0, 13.05, 15);
  turret.add(barrel);
  for (const z of [-8, 0, 8])
    for (const x of [-9.4, 9.4]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(4, 4, 2, 10),
        dark,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 4, z);
      legacy.add(wheel);
    }
  return legacy;
}
