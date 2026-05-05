// Minimal Refero MCP client: speaks JSON-RPC over Streamable HTTP.
// We initialize a session lazily, cache its id in memory, and call tools.
// If a session is rejected we re-initialize once and retry.

const REFERO_URL =
  process.env.REFERO_MCP_URL ?? "https://api.refero.design/v1/mcp";
const REFERO_TOKEN = process.env.REFERO_TOKEN ?? "";

export const HAS_REFERO = !!REFERO_TOKEN;

let sessionId = null;
let nextId = 1;

async function rpc(method, params, { useSession = true } = {}) {
  const body = {
    jsonrpc: "2.0",
    id: nextId++,
    method,
    params,
  };
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${REFERO_TOKEN}`,
  };
  if (useSession && sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  const res = await fetch(REFERO_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  // Server may return a session id on initialize.
  const newSession = res.headers.get("mcp-session-id");
  if (newSession) sessionId = newSession;

  // Streamable HTTP can return SSE for streaming responses, or plain JSON for
  // single replies. Refero's tool calls are short-lived, so JSON is the common
  // shape. We accept either.
  const ct = res.headers.get("content-type") || "";
  let payload;
  if (ct.includes("text/event-stream")) {
    payload = await readSse(res);
  } else {
    const text = await res.text();
    payload = text ? JSON.parse(text) : null;
  }

  if (!res.ok) {
    const err = new Error(
      `refero ${method} failed (${res.status}): ${
        payload?.error?.message ?? JSON.stringify(payload).slice(0, 200)
      }`,
    );
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  if (payload?.error) {
    const err = new Error(
      `refero ${method} rpc error: ${payload.error.message}`,
    );
    err.payload = payload.error;
    throw err;
  }
  return payload?.result;
}

// Parse Server-Sent Events from a fetch Response, returning the JSON-RPC
// envelope from the first `data:` line.
async function readSse(res) {
  const text = await res.text();
  for (const line of text.split("\n")) {
    if (line.startsWith("data:")) {
      const json = line.slice(5).trim();
      if (json && json !== "[DONE]") {
        try {
          return JSON.parse(json);
        } catch {
          /* keep scanning */
        }
      }
    }
  }
  return null;
}

async function initialize() {
  sessionId = null;
  await rpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "design-intelligence-portal", version: "0.2.0" },
    },
    { useSession: false },
  );
  // Some servers expect notifications/initialized as a follow-up.
  try {
    await rpc("notifications/initialized", {});
  } catch {
    /* optional */
  }
}

async function callTool(name, args) {
  if (!sessionId) {
    try {
      await initialize();
    } catch (err) {
      // Some MCP deployments accept stateless calls and reject `initialize`.
      // If init fails, fall through and try the tool call directly.
      console.warn("[refero] initialize failed, trying stateless:", err.message);
    }
  }
  try {
    return await rpc("tools/call", { name, arguments: args });
  } catch (err) {
    // If the session expired or isn't recognised, try once more after re-init.
    if (err.status === 400 || err.status === 401 || err.status === 404) {
      sessionId = null;
      try {
        await initialize();
        return await rpc("tools/call", { name, arguments: args });
      } catch {
        throw err;
      }
    }
    throw err;
  }
}

// Refero tools return a content array; we extract the first JSON-typed block.
function extractToolPayload(result) {
  if (!result) return null;
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block?.type === "text" && block.text) {
        try {
          return JSON.parse(block.text);
        } catch {
          // Not JSON; return the raw text under a known key.
          return { _text: block.text };
        }
      }
      if (block?.type === "json" && block.json) return block.json;
    }
  }
  return result;
}

export async function searchScreens(query, limit = 12) {
  const result = await callTool("search_screens", { query, limit });
  return extractToolPayload(result);
}

export async function getScreen(id) {
  const result = await callTool("get_screen", { id });
  return extractToolPayload(result);
}

// Introspection — returns whatever Refero advertises for `tools/list`.
// Used by /api/refero/probe to discover real tool names + argument schemas.
export async function listTools() {
  if (!sessionId) {
    try {
      await initialize();
    } catch {
      /* try stateless */
    }
  }
  return await rpc("tools/list", {});
}
