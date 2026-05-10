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
import { getShadcnPreset } from "./shadcn-presets.js";
import { fetchShadcnMatrix } from "./shadcn-fetch.js";
import { fetchTailgridsComponent } from "./tailgrids-fetch.js";

export const MODEL = process.env.MODEL ?? "claude-opus-4-7";
export const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;
export const client = HAS_API_KEY ? new Anthropic() : null;

// Tier → model resolution. Agents declare `defaultModel: "sonnet"` (etc.)
// rather than hard-coding exact model versions. Each tier is mapped to a
// concrete model id via env var, falling back to the global `MODEL` env
// if the per-tier var isn't set. That way the app keeps working on a
// single-model key while still letting you point each tier at the
// best-available version for your account when you set them.
//
//   MODEL_OPUS   — Opus tier model id   (e.g. "claude-opus-4-5")
//   MODEL_SONNET — Sonnet tier model id (e.g. "claude-sonnet-4-5")
//   MODEL_HAIKU  — Haiku tier model id  (e.g. "claude-haiku-4-5")
export function resolveModel(idOrTier) {
  if (idOrTier === "opus") return process.env.MODEL_OPUS || MODEL;
  if (idOrTier === "sonnet") return process.env.MODEL_SONNET || MODEL;
  if (idOrTier === "haiku") return process.env.MODEL_HAIKU || MODEL;
  return idOrTier || MODEL;
}

// Model-feature gating. Some Anthropic features (adaptive thinking,
// structured output via json_schema) are only on the newer model
// generations. We opt in when we detect a 4.7+ id, and fall back
// gracefully on older models so the app still runs on whatever the
// user's API key has access to.
function supportsAdaptiveThinking(model) {
  // Adaptive thinking ships with Claude 4.7 and forward.
  return /claude-(?:opus|sonnet|haiku)-4-(?:7|8|9|[1-9]\d)/i.test(
    model || "",
  );
}

function supportsJsonSchema(model) {
  // Structured output (json_schema format) is available on the 4.x
  // generation. Treat 4.5 and up as supported; older 3.x falls through
  // to prompt-based JSON output.
  return /claude-(?:opus|sonnet|haiku)-4-(?:5|6|7|8|9|[1-9]\d)/i.test(
    model || "",
  );
}

// Lenient parse for cases where the model wraps its JSON in markdown
// code fences (more likely without the json_schema constraint).
function parseModelJson(text) {
  let s = String(text || "").trim();
  if (s.startsWith("```")) {
    s = s
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "");
  }
  return JSON.parse(s);
}

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
  // Use the thumbnail for the small card preview (fast), but expose the full
  // preview URL separately so Copy / Download give the user the higher-res
  // asset they actually want to paste or save.
  const imageUrl =
    r.thumbnail_url ?? r.preview_url ?? r.image_url ?? r.image ??
    r.screenshot_url ?? null;
  const fullImageUrl =
    r.preview_url ?? r.image_url ?? r.screenshot_url ?? imageUrl ?? null;
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
    fullImageUrl,
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

  const { agentId, image, images, context, componentName, extras } = payload;
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
  // at least one must be present. `inputsRequireAll` requires every listed
  // input. Otherwise inputs follow the legacy strict-required behavior.
  const requireOneOf = agent.inputsRequireOneOf ?? null;
  const requireAll = agent.inputsRequireAll ?? null;

  // Resolve image inputs into an ordered list of {data, mediaType, label}
  const orderedImages = [];
  if (slots) {
    for (const slot of slots) {
      const img = images?.[slot.key];
      if (!img?.data || !img?.mediaType) {
        if (slot.optional) continue;
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
  const userContext =
    typeof context === "string" ? context.trim().slice(0, 4000) : "";
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
  if (requireAll && requireAll.length > 0) {
    const haveImage = orderedImages.length > 0;
    const haveText = !!cleanComponent;
    if (requireAll.includes("image") && !haveImage) {
      return sendJson(res, 400, {
        error: "An image is required for this agent.",
      });
    }
    if (requireAll.includes("text") && !haveText) {
      return sendJson(res, 400, {
        error: "A URL or text input is required for this agent.",
      });
    }
  }

  // Per-agent extras (e.g. "library" dropdown, "primary colour" picker
  // for States & Variants). We validate against the agent's declared
  // `extras` shape and stuff the sanitized values into the user prompt
  // as a labeled block. Unknown keys are dropped silently — the schema
  // field is the source of truth.
  const cleanedExtras = {};
  if (Array.isArray(agent.extras)) {
    const inputs = extras && typeof extras === "object" ? extras : {};
    for (const def of agent.extras) {
      const raw = inputs[def.key];
      if (def.type === "select") {
        const allowed = def.options.map((o) => o.value);
        cleanedExtras[def.key] =
          typeof raw === "string" && allowed.includes(raw) ? raw : def.default;
      } else if (def.type === "color") {
        // Accept #rgb / #rrggbb (case-insensitive). Anything else falls
        // back to the default — keeps the prompt deterministic.
        const v = typeof raw === "string" ? raw.trim() : "";
        cleanedExtras[def.key] = /^#([\da-f]{3}|[\da-f]{6})$/i.test(v)
          ? v
          : def.default;
      } else if (def.type === "number") {
        const n = Number(raw);
        if (Number.isFinite(n)) {
          const min = def.min ?? Number.NEGATIVE_INFINITY;
          const max = def.max ?? Number.POSITIVE_INFINITY;
          cleanedExtras[def.key] = Math.max(min, Math.min(max, n));
        } else {
          cleanedExtras[def.key] = def.default;
        }
      } else if (typeof raw === "string") {
        cleanedExtras[def.key] = raw.trim().slice(0, 200);
      } else if (raw == null && def.default != null) {
        cleanedExtras[def.key] = def.default;
      }
    }
  }

  // Deterministic, model-free pipeline for the TailGrids component
  // generator. Resolve the picked component id against our library,
  // convert HTML → JSX, and return immediately — no Anthropic call,
  // no tokens spent. The canvas plumbing (analyze endpoint, status
  // transitions, output node spawn) is identical to any other agent.
  if (agent.kind === "tailgrids") {
    const picked = cleanedExtras.componentId;
    const comp = fetchTailgridsComponent(picked);
    if (!comp) {
      return sendJson(res, 400, {
        error: `Unknown TailGrids component: ${picked}`,
      });
    }
    return sendJson(res, 200, {
      agent: { id: agent.id, name: agent.name },
      result: {
        tailgrids: {
          id: comp.id,
          name: comp.name,
          category: comp.category,
          html: comp.html,
          jsx: comp.jsx,
        },
      },
      // No model was called — usage is zero-shaped so the workspace
      // accumulator stays accurate.
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      model: null,
      stopReason: "deterministic",
    });
  }

  const parts = [agent.userInstruction];
  if (cleanComponent) {
    parts.push(`# Component\n${cleanComponent}`);
  }
  if (Array.isArray(agent.extras) && agent.extras.length > 0) {
    const lines = [];
    for (const def of agent.extras) {
      // `transient: true` extras are runtime config (e.g. model tier),
      // not prompt input. Skip them when assembling the user message.
      if (def.transient) continue;
      const v = cleanedExtras[def.key];
      if (v == null) continue;
      const suffix = def.suffix ? def.suffix : "";
      lines.push(`- ${def.label}: ${v}${suffix}`);
    }
    if (lines.length > 0) parts.push(`# Options\n${lines.join("\n")}`);
  }

  // Resolve which model this call should use:
  //   1. transient `modelTier` from the user's per-node selection
  //   2. agent.defaultModel (a tier identifier like "sonnet" / "opus")
  //   3. global MODEL env var
  // The select-type validation already constrained `cleanedExtras.modelTier`
  // to one of the agent's declared options, so it's safe to use.
  const callModel = resolveModel(
    cleanedExtras.modelTier || agent.defaultModel,
  );
  if (userContext) {
    parts.push(`# Additional context from the designer\n${userContext}`);
  }
  const userText = parts.join("\n\n");

  try {
    const useAdaptiveThinking = supportsAdaptiveThinking(callModel);
    const useJsonSchema = supportsJsonSchema(callModel);
    const response = await client.messages.create({
      model: callModel,
      max_tokens: 16000,
      ...(useAdaptiveThinking ? { thinking: { type: "adaptive" } } : {}),
      ...(useJsonSchema
        ? {
            output_config: {
              effort: "high",
              format: { type: "json_schema", schema: agent.schema },
            },
          }
        : {}),
      system: [
        {
          type: "text",
          text:
            agent.systemPrompt +
            (useJsonSchema
              ? ""
              : "\n\nIMPORTANT: Respond with the JSON object only. No prose, no markdown code fences, no commentary before or after."),
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
      parsed = parseModelJson(textBlock.text);
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
        // Reference Finder is about reference IMAGES, so always search screens.
        // The model's queryType hint is preserved in the response for context
        // but doesn't gate the call. (Flows would need a different output card
        // with multi-screen previews, which we don't render yet.)
        const queryType = "screens";
        const searchPayload = await searchScreens(query, { platform });
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
          model: callModel,
          stopReason: response.stop_reason,
        });
      } catch (err) {
        console.error("[refero] error:", err);
        return sendJson(res, 502, {
          error: `Refero call failed: ${err.message ?? "unknown"}`,
        });
      }
    }

    // States & Variants Generator: replace the model's invented matrix
    // with real shadcn data. Try the live registry first (canonical,
    // tracks shadcn's current source), fall back to the hardcoded
    // preset table on network failure or parse miss, fall through to
    // the model's invention if neither matches.
    if (agent.id === "states-variants" && cleanComponent) {
      let shadcnMatrix = null;
      try {
        shadcnMatrix = await fetchShadcnMatrix(cleanComponent);
      } catch (err) {
        console.warn(
          "[shadcn] live fetch failed, falling back to preset:",
          err?.message,
        );
      }
      const preset = shadcnMatrix || getShadcnPreset(cleanComponent);
      if (preset) {
        parsed.matrix = preset;
        parsed.library = "shadcn";
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
      model: callModel,
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
      message = `Model '${callModel}' not available on this API key. Pick a different Quality option or set MODEL env var.`;
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
    extras,
  } = payload;
  if (!agentId || !Array.isArray(messages) || messages.length === 0) {
    return sendJson(res, 400, { error: "agentId and messages[] required" });
  }
  const agent = getAgent(agentId);
  if (!agent) {
    return sendJson(res, 404, { error: `unknown agent: ${agentId}` });
  }

  // Resolve the model the same way analyze does, so chat follow-ups stay
  // on the same tier the user picked when they ran the agent.
  let chatTier = agent.defaultModel;
  if (Array.isArray(agent.extras) && extras && typeof extras === "object") {
    for (const def of agent.extras) {
      if (def.key !== "modelTier") continue;
      const raw = extras[def.key];
      if (def.type === "select") {
        const allowed = def.options.map((o) => o.value);
        if (typeof raw === "string" && allowed.includes(raw)) chatTier = raw;
      }
    }
  }
  const chatModel = resolveModel(chatTier);

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

  // Iteration-mode system prompt: ask follow-up questions OR request changes.
  // Changes go through the `update_analysis` tool whose input_schema is the
  // agent's own structured schema, so any tool call is guaranteed to round-trip
  // into the same renderer that produced the original output.
  const iterationSystem =
    agent.systemPrompt +
    `\n\n# Follow-up & iteration mode\n\nThe user has already received the initial structured analysis above. They may now ask follow-up questions, request changes, or both.\n\n- For QUESTIONS or EXPLANATIONS: reply in clear plain prose (markdown headings, bullets, inline code OK — no JSON, no schema). Stay grounded in the screenshot(s) you previously analyzed and the structured analysis you produced. Be concise — a short, direct answer is more useful than a re-recap.\n\n- For requested CHANGES to the analysis (add/remove/edit issues, change severities, reword the summary or verdict, restructure recommendations, rename the component, etc.): call the \`update_analysis\` tool with the FULL revised analysis. Pass the COMPLETE object — partial updates are not supported. Preserve fields the user did not ask to change. After the tool call, you may add a short 1-sentence note explaining what changed; otherwise stay silent.\n\nIf the user's intent is ambiguous, ask a clarifying question instead of guessing. Never call the tool just to confirm — only when an actual change is being made.`;

  const tools = agent.schema
    ? [
        {
          name: "update_analysis",
          description:
            "Replace the entire structured analysis with a refined version. Call whenever the user asks for any change to the analysis. Pass the COMPLETE updated object (every required field). Do NOT call this for purely informational questions.",
          input_schema: agent.schema,
        },
      ]
    : undefined;

  try {
    const response = await client.messages.create({
      model: chatModel,
      // Roomy enough to fit a refined structured analysis (e.g. a long QA
      // Review with many issues) plus a short prose note.
      max_tokens: 8000,
      system: [
        {
          type: "text",
          text: iterationSystem,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: conversation,
      ...(tools ? { tools } : {}),
    });

    let replyText = null;
    let updatedResult = null;
    for (const block of response.content) {
      if (block.type === "text" && block.text?.trim()) {
        replyText = (replyText ? replyText + "\n\n" : "") + block.text;
      } else if (block.type === "tool_use" && block.name === "update_analysis") {
        updatedResult = block.input;
      }
    }

    if (replyText == null && updatedResult == null) {
      return sendJson(res, 502, { error: "empty model response" });
    }

    sendJson(res, 200, {
      reply: replyText,
      updatedResult,
      usage: {
        input: response.usage?.input_tokens,
        output: response.usage?.output_tokens,
        cacheRead: response.usage?.cache_read_input_tokens,
        cacheWrite: response.usage?.cache_creation_input_tokens,
      },
      model: chatModel,
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
