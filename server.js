import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";
import { timingSafeEqual } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getAgent } from "./agents.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env next to this file (avoids Node --env-file quirks with spaced paths)
const envPath = join(__dirname, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Overwrite if missing OR empty — shell may export empty ANTHROPIC_API_KEY
    if (!process.env[key]) process.env[key] = val;
  }
}
const PORT = Number(process.env.PORT ?? 4000);
const MODEL = process.env.MODEL ?? "claude-opus-4-7";

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;
if (!HAS_API_KEY) {
  console.warn(
    "\n  ⚠ ANTHROPIC_API_KEY not set — UI will load, but /api/analyze and /api/chat will return 503.\n" +
      "    To enable: echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env && restart.\n",
  );
}

const client = HAS_API_KEY ? new Anthropic() : null;

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

// Optional shared-secret HTTP Basic Auth. If BASIC_AUTH_USER and BASIC_AUTH_PASS
// are both set, every request must present matching Basic credentials. If
// either is unset (typical for local dev), auth is disabled.
const AUTH_USER = process.env.BASIC_AUTH_USER || "";
const AUTH_PASS = process.env.BASIC_AUTH_PASS || "";
const AUTH_REQUIRED = AUTH_USER.length > 0 && AUTH_PASS.length > 0;

function safeEqualStr(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function checkBasicAuth(req) {
  if (!AUTH_REQUIRED) return true;
  const header = req.headers["authorization"] || "";
  if (!header.startsWith("Basic ")) return false;
  let decoded;
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return false;
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  // Compare both fields independently with timing-safe equality so the
  // response time doesn't reveal which half mismatched.
  const userOk = safeEqualStr(user, AUTH_USER);
  const passOk = safeEqualStr(pass, AUTH_PASS);
  return userOk && passOk;
}

function requireAuth(req, res) {
  if (checkBasicAuth(req)) return true;
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="Design Intelligence", charset="UTF-8"',
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end("Authentication required");
  return false;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

async function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Serve built SPA from web/dist; fall back to legacy index.html if the build
// hasn't been produced yet (e.g. during local dev when the Vite dev server
// owns the frontend on a different port).
const WEB_DIST = join(__dirname, "web", "dist");
const LEGACY_ROOT = __dirname;
const HAS_WEB_BUILD = existsSync(join(WEB_DIST, "index.html"));
const STATIC_ROOTS = [
  HAS_WEB_BUILD ? WEB_DIST : null,
  join(__dirname, "assets"), // /assets/logo-icon.svg etc., shared with the SPA
  LEGACY_ROOT,
].filter(Boolean);
const ASSETS_ROOT = join(__dirname, "assets");

async function tryServe(filePath, root, res) {
  if (!filePath.startsWith(root)) return false;
  try {
    const s = await stat(filePath);
    if (!s.isFile()) return false;
    const buf = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
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

  // /assets/* always resolves against the shared assets dir first.
  if (safe.startsWith("/assets/") || safe.startsWith("\\assets\\")) {
    const rel = safe.replace(/^[\\/]assets[\\/]/, "");
    if (await tryServe(join(ASSETS_ROOT, rel), ASSETS_ROOT, res)) return;
  }

  for (const root of STATIC_ROOTS) {
    if (await tryServe(join(root, safe), root, res)) return;
  }

  // SPA fallback: any unknown GET (no file extension) returns index.html so
  // client-side routes like /w/:id work on direct navigation/refresh.
  if (HAS_WEB_BUILD && !extname(safe)) {
    if (await tryServe(join(WEB_DIST, "index.html"), WEB_DIST, res)) return;
  }

  res.writeHead(404).end("not found");
}

async function handleAnalyze(req, res) {
  if (!client) {
    return sendJson(res, 503, {
      error: "ANTHROPIC_API_KEY not configured on server.",
    });
  }
  let payload;
  try {
    const body = await readBody(req);
    payload = JSON.parse(body.toString("utf8"));
  } catch (err) {
    return sendJson(res, 400, { error: "invalid request body" });
  }

  const { agentId, image, context } = payload;
  if (!agentId || !image?.data || !image?.mediaType) {
    return sendJson(res, 400, {
      error: "agentId and image.{data,mediaType} are required",
    });
  }
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(image.mediaType)) {
    return sendJson(res, 400, { error: "unsupported image type" });
  }

  const agent = getAgent(agentId);
  if (!agent) {
    return sendJson(res, 404, { error: `unknown agent: ${agentId}` });
  }

  const userContext =
    typeof context === "string" ? context.trim().slice(0, 4000) : "";
  const userText = userContext
    ? `${agent.userInstruction}\n\n# Additional context from the designer\n${userContext}`
    : agent.userInstruction;

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: agent.schema },
      },
      system: [
        {
          type: "text",
          text: agent.systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType,
                data: image.data,
              },
            },
            { type: "text", text: userText },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock) {
      return sendJson(res, 502, { error: "no text block in model response" });
    }

    let parsed;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      return sendJson(res, 502, {
        error: "model returned non-JSON output",
        raw: textBlock.text.slice(0, 2000),
      });
    }

    sendJson(res, 200, {
      agent: { id: agent.id, name: agent.name },
      result: parsed,
      usage: {
        input: response.usage?.input_tokens,
        output: response.usage?.output_tokens,
        cacheRead: response.usage?.cache_read_input_tokens,
        cacheWrite: response.usage?.cache_creation_input_tokens,
      },
      stopReason: response.stop_reason,
    });
  } catch (err) {
    console.error("[analyze] error:", err);
    const status =
      err instanceof Anthropic.APIError ? err.status ?? 500 : 500;
    let message = err?.error?.error?.message ?? err?.message ?? "internal error";
    if (err instanceof Anthropic.AuthenticationError) {
      message = "Invalid ANTHROPIC_API_KEY. Update .env and restart the server.";
    } else if (err instanceof Anthropic.RateLimitError) {
      message = "Rate limited by Anthropic. Wait a moment and try again.";
    } else if (err instanceof Anthropic.NotFoundError) {
      message = `Model '${MODEL}' not available on this API key. Set MODEL in .env (e.g. claude-sonnet-4-6).`;
    }
    sendJson(res, status, {
      error: message,
      type: err?.constructor?.name,
      requestId: err?.requestID,
    });
  }
}

async function handleChat(req, res) {
  if (!client) {
    return sendJson(res, 503, {
      error: "ANTHROPIC_API_KEY not configured on server.",
    });
  }
  let payload;
  try {
    const body = await readBody(req);
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return sendJson(res, 400, { error: "invalid request body" });
  }

  const { agentId, image, initialResult, messages } = payload;
  if (!agentId || !Array.isArray(messages) || messages.length === 0) {
    return sendJson(res, 400, { error: "agentId and messages[] required" });
  }
  const agent = getAgent(agentId);
  if (!agent) {
    return sendJson(res, 404, { error: `unknown agent: ${agentId}` });
  }

  const conversation = [];

  if (image?.data && image?.mediaType) {
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(image.mediaType)) {
      return sendJson(res, 400, { error: "unsupported image type" });
    }
    conversation.push({
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: image.mediaType,
            data: image.data,
          },
        },
        { type: "text", text: agent.userInstruction },
      ],
    });
    if (initialResult) {
      conversation.push({
        role: "assistant",
        content: [
          { type: "text", text: JSON.stringify(initialResult, null, 2) },
        ],
      });
    }
  }

  for (const m of messages) {
    if (
      m &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim()
    ) {
      conversation.push({ role: m.role, content: m.content });
    }
  }

  if (conversation.length === 0 || conversation[conversation.length - 1].role !== "user") {
    return sendJson(res, 400, { error: "conversation must end with a user message" });
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [
        {
          type: "text",
          text:
            agent.systemPrompt +
            "\n\n# Follow-up mode\n\nWhen the user asks follow-up questions after the initial structured analysis, respond in clear plain prose (markdown headings, bullets, and inline code OK — no JSON, no schema). Stay grounded in the screenshot you previously analyzed and the structured analysis you produced. Be concise: a short, direct answer is more useful than a re-recap.",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: conversation,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock) {
      return sendJson(res, 502, { error: "no text block in model response" });
    }

    sendJson(res, 200, {
      reply: textBlock.text,
      usage: {
        input: response.usage?.input_tokens,
        output: response.usage?.output_tokens,
        cacheRead: response.usage?.cache_read_input_tokens,
        cacheWrite: response.usage?.cache_creation_input_tokens,
      },
      stopReason: response.stop_reason,
    });
  } catch (err) {
    console.error("[chat] error:", err);
    const status =
      err instanceof Anthropic.APIError ? err.status ?? 500 : 500;
    let message = err?.error?.error?.message ?? err?.message ?? "internal error";
    if (err instanceof Anthropic.AuthenticationError) {
      message = "Invalid ANTHROPIC_API_KEY. Update .env and restart the server.";
    } else if (err instanceof Anthropic.RateLimitError) {
      message = "Rate limited by Anthropic. Wait a moment and try again.";
    }
    sendJson(res, status, {
      error: message,
      type: err?.constructor?.name,
      requestId: err?.requestID,
    });
  }
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
  if (req.method === "GET") {
    return serveStatic(req, res);
  }
  res.writeHead(405).end("method not allowed");
});

server.listen(PORT, () => {
  const authMsg = AUTH_REQUIRED ? "Basic auth ON" : "Basic auth OFF (set BASIC_AUTH_USER / BASIC_AUTH_PASS to enable)";
  console.log(`Design Intelligence → http://localhost:${PORT}  (model: ${MODEL}, ${authMsg})`);
});
