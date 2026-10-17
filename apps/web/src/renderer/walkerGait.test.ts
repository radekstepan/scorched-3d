import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LEG_STRIDE } from "@scorched-3d/core";
import { advanceLocomotion, buildUnitIconBody, getLegs } from "./units";

describe("forward walker footfall direction", () => {
  for (const kind of ["commander", "peewee"] as const) {
    for (const yaw of [0, Math.PI / 2, -2.3]) {
      it(`${kind} recovers its lifted feet forward and plants on the backward stroke at yaw ${yaw}`, () => {
        const body = buildUnitIconBody(kind);
        body.rotation.y = yaw;
        // Inspect steady travel, independent of the start/stop amplitude ramp.
        body.userData.amp = 1;
        const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const legs = getLegs(body);
        const soles = legs.map(leg => {
          leg.geometry.computeBoundingBox();
          const bounds = leg.geometry.boundingBox!;
          return new THREE.Vector3(0, bounds.min.y, (bounds.min.z + bounds.max.z) / 2);
        });
        const worldFeet = () => {
          body.updateMatrixWorld(true);
          return legs.map((leg, i) => leg.localToWorld(soles[i]!.clone()));
        };
        let previous = worldFeet();
        let previousLifts = [0, 0];
        const liftedSteps = [0, 0], plantedSteps = [0, 0];
        const distance = LEG_STRIDE[kind] / 120;
        for (let tick = 0; tick < 240; tick++) {
          body.position.addScaledVector(forward, distance);
          advanceLocomotion(body, kind, distance, 1 / 120);
          const feet = worldFeet();
          const lifts = legs.map(leg => leg.position.y - (leg.userData.baseY as number));
          feet.forEach((foot, i) => {
            // Subtract the hull translation: the airborne recovery must move
            // toward the nose relative to the hip, and the planted foot aft.
            const relativeTravel = foot.clone().sub(previous[i]!).dot(forward) - distance;
            if (lifts[i]! > 1 && previousLifts[i]! > 1) {
              expect(relativeTravel).toBeGreaterThan(0);
              liftedSteps[i]!++;
            } else if (lifts[i] === 0 && previousLifts[i] === 0 && Math.abs(relativeTravel) > 0.005) {
              expect(relativeTravel).toBeLessThan(0);
              plantedSteps[i]!++;
            }
          });
          previous = feet;
          previousLifts = lifts;
        }
        liftedSteps.forEach(count => expect(count).toBeGreaterThan(60));
        plantedSteps.forEach(count => expect(count).toBeGreaterThan(60));
      });
    }
  }
});
