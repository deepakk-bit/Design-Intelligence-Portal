// Shared request handlers for both standalone Node (server.js) and
// Vercel serverless functions (api/*.js). Handlers take the same
// (req, res) shape: Node http IncomingMessage / ServerResponse.

import Anthropic from "@anthropic-ai/sdk";
import { timingSafeEqual } from "node:crypto";
import { getAgent } from "../agents.js";

export const MODEL = process.env.MODEL ?? "claude-opus-4-7";
export const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;
export const client = HAS_API_KEY ? new Anthropic() : null;

const AUTH_USER = process.env.BASIC_AUTH_USER || "";
const AUTH_PASS = process.env.BASIC_AUTH_PASS || "";
export const AUTH_REQUIRED = AUTH_USER.length > 0 && AUTH_PASS.length > 0;

function safeEqualStr(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function checkBasicAuth(req) {
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
  return safeEqualStr(user, AUTH_USER) && safeEqualStr(pass, AUTH_PASS);
}

export function requireAuth(req, res) {
  if (checkBasicAuth(req)) return true;
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="Design Intelligence", charset="UTF-8"',
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end("Authentication required");
  return false;
}

export function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

// Read JSON body. Vercel may pre-parse to req.body for some content types,
// so honour that if present; otherwise stream-read up to `limit` bytes.
async function readJson(req, limit = 12 * 1024 * 1024) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const buf = await new Promise((resolve, reject) => {
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
  if (buf.length === 0) return {};
  return JSON.parse(buf.toString("utf8"));
}

export async function handleAnalyze(req, res) {
  if (!requireAuth(req, res)) return;
  if (!client) {
    return sendJson(res, 503, {
      error: "ANTHROPIC_API_KEY not configured on server.",
    });
  }
  let payload;
  try {
    payload = await readJson(req);
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
      err instanceof Anthropic.APIError ? (err.status ?? 500) : 500;
    let message =
      err?.error?.error?.message ?? err?.message ?? "internal error";
    if (err instanceof Anthropic.AuthenticationError) {
      message = "Invalid ANTHROPIC_API_KEY. Update env and redeploy.";
    } else if (err instanceof Anthropic.RateLimitError) {
      message = "Rate limited by Anthropic. Wait a moment and try again.";
    } else if (err instanceof Anthropic.NotFoundError) {
      message = `Model '${MODEL}' not available on this API key. Set MODEL env var (e.g. claude-sonnet-4-6).`;
    }
    sendJson(res, status, {
      error: message,
      type: err?.constructor?.name,
      requestId: err?.requestID,
    });
  }
}

export async function handleChat(req, res) {
  if (!requireAuth(req, res)) return;
  if (!client) {
    return sendJson(res, 503, {
      error: "ANTHROPIC_API_KEY not configured on server.",
    });
  }
  let payload;
  try {
    payload = await readJson(req);
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

  if (
    conversation.length === 0 ||
    conversation[conversation.length - 1].role !== "user"
  ) {
    return sendJson(res, 400, {
      error: "conversation must end with a user message",
    });
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
      err instanceof Anthropic.APIError ? (err.status ?? 500) : 500;
    let message =
      err?.error?.error?.message ?? err?.message ?? "internal error";
    if (err instanceof Anthropic.AuthenticationError) {
      message = "Invalid ANTHROPIC_API_KEY. Update env and redeploy.";
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
