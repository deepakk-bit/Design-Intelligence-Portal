// Thin client for the existing Node server endpoints.

export async function runAgent({
  agentId,
  image,
  images,
  context,
  componentName,
  extras,
}) {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId,
      image,
      images,
      context,
      componentName,
      extras,
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

export async function chatWithAgent({
  agentId,
  image,
  images,
  initialResult,
  messages,
  componentName,
  context,
  extras,
  signal,
}) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId,
      image,
      images,
      initialResult,
      messages,
      componentName,
      context,
      extras,
    }),
    signal,
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

// Read a file as a data URL.
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

// Downscale a data URL to fit within `maxDim` on the longest side, JPEG-encoding
// at the given quality. Returns the new data URL plus media type. Skips work if
// the image is already smaller than the target.
async function downscaleDataUrl(dataUrl, { maxDim = 2000, quality = 0.85 } = {}) {
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("decode failed"));
    el.src = dataUrl;
  });
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  if (longest <= maxDim) {
    // Even small images: re-encode huge PNGs as JPEG to drop bytes.
    if (dataUrl.startsWith("data:image/png") && dataUrl.length > 1_500_000) {
      // fall through to canvas re-encode
    } else {
      const mediaType =
        (dataUrl.match(/^data:(.*?);base64,/) ?? [, "image/png"])[1];
      return { dataUrl, mediaType };
    }
  }
  const scale = Math.min(1, maxDim / longest);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL("image/jpeg", quality);
  return { dataUrl: out, mediaType: "image/jpeg" };
}

export async function fileToImagePayload(file) {
  const original = await readAsDataUrl(file);
  const { dataUrl, mediaType } = await downscaleDataUrl(original);
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("invalid data URL");
  const data = dataUrl.slice(comma + 1);
  return { data, mediaType, dataUrl };
}

// --- Library API ----------------------------------------------------------

import { getLibraryCode } from "./identity.js";

export class ApiError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

// Generic fetch wrapper for the library endpoints. Injects the
// X-Library-Code header so the server can scope reads to the caller.
async function libraryFetch(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("X-Library-Code", getLibraryCode());
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...init, headers });
  const isJson = (res.headers.get("content-type") || "").includes(
    "application/json",
  );
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const msg =
      (body && (body.error || body.message)) ||
      `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg, body);
  }
  return body;
}

export async function listLibrarySaves() {
  const body = await libraryFetch("/api/library/saves");
  return body?.saves ?? [];
}

export async function getLibrarySave(id) {
  const body = await libraryFetch(`/api/library/saves/${encodeURIComponent(id)}`);
  return body?.save ?? null;
}

export async function createLibrarySave(payload) {
  const body = await libraryFetch("/api/library/saves", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return body?.save ?? null;
}

export async function deleteLibrarySave(id) {
  await libraryFetch(`/api/library/saves/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
