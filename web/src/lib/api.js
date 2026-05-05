// Thin client for the existing Node server endpoints.

export async function runAgent({ agentId, image, context, componentName }) {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, image, context, componentName }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error ?? `request failed (${res.status})`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

export async function chatWithAgent({
  agentId,
  image,
  initialResult,
  messages,
  componentName,
  context,
}) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId,
      image,
      initialResult,
      messages,
      componentName,
      context,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error ?? `request failed (${res.status})`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

export function fileToImagePayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma < 0) return reject(new Error("invalid data URL"));
      const meta = result.slice(0, comma);
      const data = result.slice(comma + 1);
      const mediaType = (meta.match(/data:(.*?);base64/) ?? [, ""])[1];
      if (!mediaType) return reject(new Error("no media type"));
      resolve({ data, mediaType, dataUrl: result });
    };
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
