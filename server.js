// Standalone Node HTTP server for local dev. Vercel deploys reuse the
// shared handlers in lib/handlers.js via api/*.js serverless functions.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env BEFORE importing handlers.js — handlers.js instantiates the
// Anthropic client and reads env vars at module-evaluation time.
const envPath = join(__dirname, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

const {
  HAS_API_KEY,
  AUTH_REQUIRED,
  MODEL,
  requireAuth,
  handleAnalyze,
  handleChat,
  handleImageProxy,
  handleReferoProbe,
} = await import("./lib/handlers.js");

const PORT = Number(process.env.PORT ?? 4000);

if (!HAS_API_KEY) {
  console.warn(
    "\n  ⚠ ANTHROPIC_API_KEY not set — UI will load, but /api/analyze and /api/chat will return 503.\n" +
      "    To enable: echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env && restart.\n",
  );
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

const WEB_DIST = join(__dirname, "web", "dist");
const ASSETS_ROOT = join(__dirname, "assets");
const HAS_WEB_BUILD = existsSync(join(WEB_DIST, "index.html"));
const STATIC_ROOTS = [
  HAS_WEB_BUILD ? WEB_DIST : null,
  ASSETS_ROOT,
  __dirname,
].filter(Boolean);

async function tryServe(filePath, root, res) {
  if (!filePath.startsWith(root)) return false;
  try {
    const s = await stat(filePath);
    if (!s.isFile()) return false;
    const buf = await readFile(filePath);
    const type =
      MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": buf.length,
      "Cache-Control": "no-cache",
    });
    res.end(buf);
    return true;
  } catch {
    return false;
  }
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const safe = normalize(urlPath === "/" ? "/index.html" : urlPath).replace(
    /^(\.\.[\\/])+/,
    "",
  );

  if (safe.startsWith("/assets/") || safe.startsWith("\\assets\\")) {
    const rel = safe.replace(/^[\\/]assets[\\/]/, "");
    if (await tryServe(join(ASSETS_ROOT, rel), ASSETS_ROOT, res)) return;
  }

  for (const root of STATIC_ROOTS) {
    if (await tryServe(join(root, safe), root, res)) return;
  }

  if (HAS_WEB_BUILD && !extname(safe)) {
    if (await tryServe(join(WEB_DIST, "index.html"), WEB_DIST, res)) return;
  }

  res.writeHead(404).end("not found");
}

const server = createServer(async (req, res) => {
  if (!requireAuth(req, res)) return;
  const url = new URL(req.url, "http://x");
  if (req.method === "POST" && url.pathname === "/api/analyze") {
    return handleAnalyze(req, res);
  }
  if (req.method === "POST" && url.pathname === "/api/chat") {
    return handleChat(req, res);
  }
  if (req.method === "GET" && url.pathname === "/api/proxy-image") {
    return handleImageProxy(req, res);
  }
  if (req.method === "GET" && url.pathname === "/api/refero/probe") {
    return handleReferoProbe(req, res);
  }
  if (req.method === "GET") {
    return serveStatic(req, res);
  }
  res.writeHead(405).end("method not allowed");
});

server.listen(PORT, () => {
  const authMsg = AUTH_REQUIRED
    ? "Basic auth ON"
    : "Basic auth OFF (set BASIC_AUTH_USER / BASIC_AUTH_PASS to enable)";
  console.log(
    `Design Intelligence → http://localhost:${PORT}  (model: ${MODEL}, ${authMsg})`,
  );
});
