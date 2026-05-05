// Shared request handlers for both standalone Node (server.js) and
// Vercel serverless functions (api/*.js). Handlers take the same
// (req, res) shape: Node http IncomingMessage / ServerResponse.

import Anthropic from "@anthropic-ai/sdk";
import { timingSafeEqual } from "node:crypto";
import { getAgent } from "../agents.js";
import {
  searchScreens,
  searchFlows,
  listTools,
  HAS_REFERO,
} from "./refero.js";

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
class PayloadTooLargeError extends Error {
  constructor(size, limit) {
    super(`payload too large: ${size} > ${limit}`);
    this.code = "PAYLOAD_TOO_LARGE";
  }
}

async function readJson(req, limit = 32 * 1024 * 1024) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const buf = await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on("data", (c) => {
      if (aborted) return;
      size += c.length;
      if (size > limit) {
        aborted = true;
        // Drain remaining bytes so the response can still be written cleanly.
        req.on("data", () => {});
        req.on("end", () =>
          reject(new PayloadTooLargeError(size, limit)),
        );
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
  if (buf.length === 0) return {};
  return JSON.parse(buf.toString("utf8"));
}

// Refero's MCP response shapes vary across tools and revisions; pluck the most
// likely list of screen summaries out of whatever came back.
function collectScreenSummaries(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  for (const key of ["screens", "results", "items", "data", "hits"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

// Map a Refero screen record (parsed from search_screens markdown) onto the
// frontend shape. Falls back through field aliases for resilience.
function normalizeReference(r) {
  if (!r || typeof r !== "object") return {};
  const id = r.screen_id ?? r.id ?? r.uuid ?? null;
  const imageUrl =
    r.thumbnail_url ?? r.preview_url ?? r.image_url ?? r.image ??
    r.screenshot_url ?? null;
  const sourceUrl =
    r.refero_url ?? r.permalink ?? r.source_url ?? r.url ??
    (id ? `https://refero.design/pages/${id}` : null);
  const productRaw =
    r.product ?? r.app ?? r.brand ?? r.company ?? r.source ?? r.domain ?? null;
  const product =
    typeof productRaw === "object"
      ? productRaw?.name ?? productRaw?.title ?? ""
      : productRaw ?? "";
  const category = r.page_types ?? r.category ?? r.screen_type ?? r.type ?? "";
  const title = product || category || "Untitled";
  // Descriptions can be very long (>1000 chars). Trim aggressively for cards.
  const desc = (r.description ?? r.summary ?? "").trim();
  const shortDesc = desc.length > 240 ? desc.slice(0, 237) + "…" : desc;
  return {
    id,
    title,
    product,
    category,
    description: shortDesc,
    imageUrl,
    sourceUrl,
    pageUrl: r.page_url ?? null,
  };
}

function buildUserContent(orderedImages, userText) {
  if (!orderedImages || orderedImages.length === 0) {
    return [{ type: "text", text: userText }];
  }
  const blocks = [];
  for (const img of orderedImages) {
    if (img.label) {
      blocks.push({ type: "text", text: `# ${img.label}` });
    }
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType,
        data: img.data,
      },
    });
  }
  blocks.push({ type: "text", text: userText });
  return blocks;
}

// One-shot diagnostic: lists Refero MCP tools and their argument schemas so
// we can see exactly what the server expects without writing a guess loop.
export async function handleReferoProbe(req, res) {
  if (!requireAuth(req, res)) return;
  if (!HAS_REFERO) {
    return sendJson(res, 503, { error: "REFERO_TOKEN not configured" });
  }
  try {
    const tools = await listTools();
    sendJson(res, 200, { ok: true, tools });
  } catch (err) {
    sendJson(res, 502, { ok: false, error: err.message, payload: err.payload });
  }
}

// Diagnostic: run a real search and return the raw payload + the first item's
// keys, so we can see Refero's response shape and pin the right field names.
// Usage: GET /api/refero/search?q=pricing+page&platform=web
export async function handleReferoSearch(req, res) {
  if (!requireAuth(req, res)) return;
  if (!HAS_REFERO) {
    return sendJson(res, 503, { error: "REFERO_TOKEN not configured" });
  }
  const u = new URL(req.url, "http://x");
  const q = (u.searchParams.get("q") || "pricing page").trim();
  const platform = u.searchParams.get("platform") === "ios" ? "ios" : "web";
  try {
    const payload = await searchScreens(q, { platform });
    const candidates = collectScreenSummaries(payload);
    sendJson(res, 200, {
      ok: true,
      query: q,
      platform,
      totalCandidates: candidates.length,
      firstItemKeys: candidates[0] ? Object.keys(candidates[0]) : [],
      firstItem: candidates[0] ?? null,
      rawPayload: payload,
    });
  } catch (err) {
    sendJson(res, 502, { ok: false, error: err.message, payload: err.payload });
  }
}

// Proxy a remote image so the frontend can use it from clipboard / download
// flows that require a same-origin or CORS-permissive source. We only allow
// http(s) URLs and stream the bytes through unchanged.
export async function handleImageProxy(req, res) {
  if (!requireAuth(req, res)) return;
  let url;
  try {
    const u = new URL(req.url, "http://x");
    url = u.searchParams.get("url");
  } catch {
    return sendJson(res, 400, { error: "invalid url" });
  }
  if (!url || !/^https?:\/\//i.test(url)) {
    return sendJson(res, 400, { error: "url query param required (http/https)" });
  }
  try {
    const upstream = await fetch(url, {
      headers: { "User-Agent": "design-intelligence-portal/0.2" },
    });
    if (!upstream.ok) {
      return sendJson(res, 502, {
        error: `upstream ${upstream.status}`,
      });
    }
    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    if (!/^image\//.test(ct)) {
      return sendJson(res, 415, { error: "upstream is not an image" });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(200, {
      "Content-Type": ct,
      "Content-Length": buf.length,
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(buf);
  } catch (err) {
    sendJson(res, 502, { error: `proxy failed: ${err.message}` });
  }
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
    if (err?.code === "PAYLOAD_TOO_LARGE") {
      return sendJson(res, 413, {
        error:
          "Image payload too large. Try smaller screenshots (under ~10 MB each).",
      });
    }
    return sendJson(res, 400, { error: "invalid request body" });
  }

  const { agentId, image, images, context, componentName } = payload;
  if (!agentId) {
    return sendJson(res, 400, { error: "agentId is required" });
  }

  const agent = getAgent(agentId);
  if (!agent) {
    return sendJson(res, 404, { error: `unknown agent: ${agentId}` });
  }

  const inputs = agent.inputs ?? (agent.imageSlots ? [] : ["image"]);
  const wantsImage = inputs.includes("image");
  const wantsText = inputs.includes("text");
  const slots = agent.imageSlots ?? null;
  // When `inputsRequireOneOf` is set, both inputs are individually optional but
  // at least one must be present. Otherwise inputs are strictly required.
  const requireOneOf = agent.inputsRequireOneOf ?? null;

  // Resolve image inputs into an ordered list of {data, mediaType, label}
  const orderedImages = [];
  if (slots) {
    for (const slot of slots) {
      const img = images?.[slot.key];
      if (!img?.data || !img?.mediaType) {
        return sendJson(res, 400, {
          error: `images.${slot.key}.{data,mediaType} is required for this agent`,
        });
      }
      if (!/^image\/(png|jpe?g|webp|gif)$/.test(img.mediaType)) {
        return sendJson(res, 400, {
          error: `unsupported image type for ${slot.key}`,
        });
      }
      orderedImages.push({ ...img, label: slot.label });
    }
  } else if (image?.data && image?.mediaType) {
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(image.mediaType)) {
      return sendJson(res, 400, { error: "unsupported image type" });
    }
    orderedImages.push({ ...image, label: null });
  } else if (wantsImage && !requireOneOf) {
    return sendJson(res, 400, {
      error: "image.{data,mediaType} is required for this agent",
    });
  }

  const cleanComponent =
    typeof componentName === "string" ? componentName.trim().slice(0, 200) : "";
  if (wantsText && !wantsImage && !slots && !cleanComponent && !requireOneOf) {
    return sendJson(res, 400, {
      error: "componentName is required for this agent",
    });
  }
  if (requireOneOf && requireOneOf.length > 0) {
    const haveImage = orderedImages.length > 0;
    const haveText = !!cleanComponent;
    if (!haveImage && !haveText) {
      return sendJson(res, 400, {
        error: "Provide an image, a prompt, or both for this agent.",
      });
    }
  }

  const userContext =
    typeof context === "string" ? context.trim().slice(0, 4000) : "";
  const parts = [agent.userInstruction];
  if (cleanComponent) {
    parts.push(`# Component\n${cleanComponent}`);
  }
  if (userContext) {
    parts.push(`# Additional context from the designer\n${userContext}`);
  }
  const userText = parts.join("\n\n");

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
          content: buildUserContent(orderedImages, userText),
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

    // Special pipeline for tool-driven reference search: take the model's
    // query and hand it off to Refero, then return shaped reference cards.
    if (agent.kind === "references") {
      if (!HAS_REFERO) {
        return sendJson(res, 503, {
          error:
            "REFERO_TOKEN not configured on server. Add it to your env and redeploy.",
        });
      }
      try {
        const query = String(parsed.query ?? "").trim();
        if (!query) {
          return sendJson(res, 502, {
            error: "model did not produce a search query",
          });
        }
        const platform = parsed.platform === "ios" ? "ios" : "web";
        const queryType = parsed.queryType === "flows" ? "flows" : "screens";
        const searchPayload =
          queryType === "flows"
            ? await searchFlows(query, { platform })
            : await searchScreens(query, { platform });
        const candidates = collectScreenSummaries(searchPayload).slice(0, 12);
        const references = candidates.map(normalizeReference);
        if (references.length === 0 && candidates.length > 0) {
          console.warn(
            "[refero] search returned %d candidates but normalizeReference produced 0; first item keys: %j",
            candidates.length,
            Object.keys(candidates[0] ?? {}),
          );
        }
        if (
          references.length > 0 &&
          references.every((r) => !r.imageUrl) &&
          candidates.length > 0
        ) {
          console.warn(
            "[refero] no imageUrl detected; first item keys: %j",
            Object.keys(candidates[0] ?? {}),
          );
        }
        return sendJson(res, 200, {
          agent: { id: agent.id, name: agent.name },
          result: {
            query,
            queryType,
            platform,
            references,
          },
          usage: {
            input: response.usage?.input_tokens,
            output: response.usage?.output_tokens,
            cacheRead: response.usage?.cache_read_input_tokens,
            cacheWrite: response.usage?.cache_creation_input_tokens,
          },
          stopReason: response.stop_reason,
        });
      } catch (err) {
        console.error("[refero] error:", err);
        return sendJson(res, 502, {
          error: `Refero call failed: ${err.message ?? "unknown"}`,
        });
      }
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
  } catch (err) {
    if (err?.code === "PAYLOAD_TOO_LARGE") {
      return sendJson(res, 413, {
        error:
          "Image payload too large. Try smaller screenshots (under ~10 MB each).",
      });
    }
    return sendJson(res, 400, { error: "invalid request body" });
  }

  const {
    agentId,
    image,
    images,
    initialResult,
    messages,
    componentName,
    context,
  } = payload;
  if (!agentId || !Array.isArray(messages) || messages.length === 0) {
    return sendJson(res, 400, { error: "agentId and messages[] required" });
  }
  const agent = getAgent(agentId);
  if (!agent) {
    return sendJson(res, 404, { error: `unknown agent: ${agentId}` });
  }

  const conversation = [];

  // Resolve image seed for chat context — slots first, single image second.
  const slots = agent.imageSlots ?? null;
  const seedImages = [];
  if (slots && images) {
    for (const slot of slots) {
      const img = images[slot.key];
      if (img?.data && img?.mediaType) {
        if (!/^image\/(png|jpe?g|webp|gif)$/.test(img.mediaType)) {
          return sendJson(res, 400, {
            error: `unsupported image type for ${slot.key}`,
          });
        }
        seedImages.push({ ...img, label: slot.label });
      }
    }
  } else if (image?.data && image?.mediaType) {
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(image.mediaType)) {
      return sendJson(res, 400, { error: "unsupported image type" });
    }
    seedImages.push({ ...image, label: null });
  }

  if (seedImages.length > 0) {
    conversation.push({
      role: "user",
      content: buildUserContent(seedImages, agent.userInstruction),
    });
    if (initialResult) {
      conversation.push({
        role: "assistant",
        content: [
          { type: "text", text: JSON.stringify(initialResult, null, 2) },
        ],
      });
    }
  } else if (typeof componentName === "string" && componentName.trim()) {
    const cleanComponent = componentName.trim().slice(0, 200);
    const cleanContext =
      typeof context === "string" ? context.trim().slice(0, 4000) : "";
    const parts = [agent.userInstruction, `# Component\n${cleanComponent}`];
    if (cleanContext) {
      parts.push(`# Additional context from the designer\n${cleanContext}`);
    }
    conversation.push({ role: "user", content: parts.join("\n\n") });
    if (initialResult) {
      conversation.push({
        role: "assistant",
        content: JSON.stringify(initialResult, null, 2),
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
