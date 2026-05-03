import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";
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

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\n  ✗ ANTHROPIC_API_KEY is not set.\n" +
    "    Run:  echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env && npm run dev\n",
  );
  process.exit(1);
}

const client = new Anthropic();

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

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const relPath = urlPath === "/" ? "/index.html" : urlPath;
  const safe = normalize(relPath).replace(/^(\.\.[\\/])+/, "");
  const filePath = join(__dirname, safe);
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const s = await stat(filePath);
    if (!s.isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    const buf = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": buf.length,
      "Cache-Control": "no-cache",
    });
    res.end(buf);
  } catch {
    res.writeHead(404).end("not found");
  }
}

async function handleAnalyze(req, res) {
  let payload;
  try {
    const body = await readBody(req);
    payload = JSON.parse(body.toString("utf8"));
  } catch (err) {
    return sendJson(res, 400, { error: "invalid request body" });
  }

  const { agentId, image } = payload;
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
            { type: "text", text: agent.userInstruction },
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
  console.log(`Design Intelligence → http://localhost:${PORT}  (model: ${MODEL})`);
});
