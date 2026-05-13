// Bundles the plugin's sandbox script and UI page into ./dist for Figma to
// load. Two outputs:
//   - dist/code.js  → bundled sandbox entry (no DOM, no React)
//   - dist/ui.html  → single self-contained HTML with the React UI inlined
//
// Run `node build.js` once, or `node build.js --watch` during iteration.

import { build, context } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "src");
const DIST = join(__dirname, "dist");
const WATCH = process.argv.includes("--watch");

await mkdir(DIST, { recursive: true });

const codeBuild = {
  entryPoints: [join(SRC, "code.ts")],
  outfile: join(DIST, "code.js"),
  bundle: true,
  target: "es2020",
  format: "iife",
  platform: "browser",
  // Figma's plugin sandbox has no DOM, no fetch globals on `code.ts` —
  // only the figma.* API. We keep code.js dependency-free on purpose.
  legalComments: "none",
  logLevel: "info",
};

const uiBuild = {
  entryPoints: [join(SRC, "ui/main.tsx")],
  outfile: join(DIST, "ui.js"),
  bundle: true,
  target: "es2020",
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  jsxImportSource: "preact",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  loader: { ".css": "text" },
  logLevel: "info",
};

async function rebuildHtml() {
  const html = await readFile(join(SRC, "ui/index.html"), "utf8");
  const js = await readFile(join(DIST, "ui.js"), "utf8");
  const inlined = html.replace(
    "<!-- BUNDLE -->",
    `<script>${js.replace(/<\/script>/g, "<\\/script>")}</script>`,
  );
  await writeFile(join(DIST, "ui.html"), inlined);
  console.log("✓ ui.html written");
}

if (WATCH) {
  const codeCtx = await context(codeBuild);
  const uiCtx = await context({
    ...uiBuild,
    plugins: [
      {
        name: "ui-html-rebuild",
        setup(b) {
          b.onEnd((res) => {
            if (res.errors.length === 0) rebuildHtml().catch(console.error);
          });
        },
      },
    ],
  });
  await Promise.all([codeCtx.watch(), uiCtx.watch()]);
  console.log("watching figma-plugin/src for changes…");
} else {
  await build(codeBuild);
  await build(uiBuild);
  await rebuildHtml();
  console.log("✓ figma-plugin built");
}
