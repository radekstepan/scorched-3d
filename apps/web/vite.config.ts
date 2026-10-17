import path from "path";
import { appVersionPlugin } from "./appVersion";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig(async () => ({
  // Relative base so the bundle also works when served from a subpath
  // (e.g. https://<owner>.github.io/<repo>/ on GitHub Pages).
  base: "./",
  plugins: [await appVersionPlugin(path.resolve(__dirname, "../..")), react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
}));
