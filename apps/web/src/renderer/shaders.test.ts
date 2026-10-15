import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  skyFragment,
  skyVertex,
  terrainFragment,
  terrainVertex,
  waterFragment,
  waterVertex,
} from "./shaders";

const here = dirname(fileURLToPath(import.meta.url));
const canvasSource = readFileSync(join(here, "TerrainCanvas.tsx"), "utf8");

describe("shader sources", () => {
  it("exports non-empty GLSL for terrain, water and sky", () => {
    for (const src of [terrainVertex, waterVertex, skyVertex]) {
      expect(typeof src).toBe("string");
      expect(src.trim().length).toBeGreaterThan(0);
      expect(src).toContain("void main()");
      expect(src).toContain("gl_Position");
    }
    for (const src of [terrainFragment, waterFragment, skyFragment]) {
      expect(typeof src).toBe("string");
      expect(src.trim().length).toBeGreaterThan(0);
      expect(src).toContain("void main()");
      expect(src).toContain("gl_FragColor");
    }
  });

  it("declares the uniforms TerrainCanvas wires up", () => {
    expect(terrainFragment).toContain("mapTex");
    expect(terrainFragment).toContain("heightTex");
    expect(terrainFragment).toContain("seaLevel");
    expect(terrainFragment).toContain("exaggeration");
    expect(waterFragment).toContain("heightTex");
    expect(waterFragment).toContain("seaLevel");
    expect(waterVertex).toContain("time");
    expect(skyFragment).toContain("sunDir");
  });

  it("is consumed by TerrainCanvas for all three materials", () => {
    for (const name of [
      "terrainVertex",
      "terrainFragment",
      "waterVertex",
      "waterFragment",
      "skyVertex",
      "skyFragment",
    ]) {
      expect(canvasSource).toContain(name);
    }
  });
});
