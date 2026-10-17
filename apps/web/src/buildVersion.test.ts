import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { build, createServer } from "vite";
import { appVersionPlugin, getBuildVersion } from "../appVersion";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function fixture(version = "1.2.3") {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "scorched-build-version-")));
  dirs.push(root);
  const write = (name: string, content: unknown) => {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, typeof content === "string" ? content : JSON.stringify(content));
  };
  write("package.json", { name: "fixture", private: true, workspaces: ["apps/*", "packages/*"] });
  for (const [dir, name] of [["apps/web", "@scorched-3d/web"], ["packages/core", "@scorched-3d/core"]]) {
    write(`${dir}/package.json`, { name, version, private: true });
  }
  write(".changeset/config.json", {
    fixed: [["@scorched-3d/web", "@scorched-3d/core"]],
    privatePackages: { version: true, tag: false },
  });
  const changeset = (name: string, bump: string) => write(`.changeset/${name}.md`, `---\n"@scorched-3d/web": ${bump}\n---\n\nTest change.\n`);
  return { root, write, changeset };
}

describe("current build version from Changesets", () => {
  it("uses the released workspace version when nothing is pending", async () => {
    const { root } = fixture();
    expect(await getBuildVersion(root)).toBe("1.2.3");
  });

  it.each([["patch", "1.2.4"], ["minor", "1.3.0"], ["major", "2.0.0"]])(
    "uses the pending %s release and Changesets fixed-group propagation", async (bump, expected) => {
      const { root, changeset } = fixture();
      // Only web is named in this changeset: the fixed group must also bump core.
      changeset("pending", bump);
      expect(await getBuildVersion(root)).toBe(expected);
    },
  );

  it("takes the strongest pending bump and updates when changesets change", async () => {
    const { root, changeset } = fixture();
    changeset("patch", "patch");
    expect(await getBuildVersion(root)).toBe("1.2.4");
    changeset("minor", "minor");
    expect(await getBuildVersion(root)).toBe("1.3.0");
    rmSync(path.join(root, ".changeset/minor.md"));
    expect(await getBuildVersion(root)).toBe("1.2.4");
  });

  it("rejects workspace drift before displaying an ambiguous version", async () => {
    const { root, write } = fixture();
    write("packages/core/package.json", { name: "@scorched-3d/core", version: "9.0.0", private: true });
    await expect(getBuildVersion(root)).rejects.toThrow("workspace versions drifted");
  });

  it("watches added/removed changesets and package versions for dev refresh", async () => {
    const { root } = fixture();
    const server = await createServer({
      root, configFile: false, logLevel: "silent", server: { middlewareMode: true },
      plugins: [await appVersionPlugin(root)],
    });
    const restart = vi.spyOn(server, "restart").mockResolvedValue();
    try {
      server.watcher.emit("all", "change", path.join(root, "unrelated.md"));
      expect(restart).not.toHaveBeenCalled();
      for (const [event, file] of [
        ["add", ".changeset/new.md"], ["unlink", ".changeset/new.md"],
        ["change", ".changeset/config.json"], ["change", "apps/web/package.json"],
        ["change", "packages/core/package.json"],
      ]) server.watcher.emit("all", event!, path.join(root, file!));
      expect(restart).toHaveBeenCalledTimes(5);
    } finally { restart.mockRestore(); await server.close(); }
  });

  it("embeds the planned version into the production artifact", async () => {
    const { root, write, changeset } = fixture();
    changeset("pending", "minor");
    write("index.html", '<script type="module" src="/version.js"></script>');
    write("version.js", 'document.body.textContent = "v" + __APP_BUILD_VERSION__;');
    const output = await build({
      root, configFile: false, logLevel: "silent", plugins: [await appVersionPlugin(root)],
      build: { write: false, minify: false },
    });
    const bundles = Array.isArray(output) ? output : [output];
    const code = bundles.flatMap((bundle) => "output" in bundle ? bundle.output : [])
      .filter((chunk) => chunk.type === "chunk").map((chunk) => chunk.code).join("\n");
    expect(code).toContain('"v1.3.0"');
    expect(code).not.toContain("__APP_BUILD_VERSION__");
  });

  it("injects the new version on a Vite dev restart after a changeset is added", async () => {
    const { root, write, changeset } = fixture();
    write("version.js", "export const version = __APP_BUILD_VERSION__;");
    // Config restart reloads the plugin and recomputes the plan, just as the
    // app's async vite.config.ts does. No core dist/source version participates.
    const start = async () => createServer({
      root, configFile: false, logLevel: "silent", server: { middlewareMode: true, fs: { allow: [root] } },
      plugins: [await appVersionPlugin(root)],
    });
    const first = await start();
    try {
      expect((await first.transformRequest("/version.js", { ssr: true }))?.code).toContain('"1.2.3"');
    } finally { await first.close(); }
    changeset("new", "minor");
    const next = await start();
    try {
      expect((await next.transformRequest("/version.js", { ssr: true }))?.code).toContain('"1.3.0"');
    } finally { await next.close(); }
  });
});
