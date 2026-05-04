import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Files under `public/` are copied verbatim into the build root.
  // Logo SVGs live at `web/public/assets/*` so they end up at
  // `dist/assets/*` and are reachable as `/assets/logo-icon.svg`.
  publicDir: resolve(__dirname, "public"),
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
  },
});
