// HTTP helpers the plugin UI uses to talk to the web app's library
// endpoints. The pairing UI sets `apiBase` (e.g. http://localhost:4000
// or the Vercel host) and `libraryCode` (the same UUID the web app
// shows in its pairing modal). Every request sends X-Library-Code so
// the server can scope reads.

export type Section = {
  label: string;
  jsx?: string;
  html?: string;
};

export type Save = {
  id: string;
  agentId: string;
  componentName: string;
  description?: string;
  createdAt: string;
  sections: Section[];
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  base: string,
  path: string,
  code: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers || {});
  headers.set("X-Library-Code", code);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(joinUrl(base, path), { ...init, headers });
  const isJson = (res.headers.get("content-type") || "").includes(
    "application/json",
  );
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const msg =
      (body && (body.error || body.message)) ||
      `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, "")}${path}`;
}

export async function listSaves(base: string, code: string): Promise<Save[]> {
  const body = await request<{ saves: Save[] }>(base, "/api/library/saves", code);
  return body.saves ?? [];
}

export async function getSave(
  base: string,
  code: string,
  id: string,
): Promise<Save | null> {
  const body = await request<{ save: Save }>(
    base,
    `/api/library/saves/${encodeURIComponent(id)}`,
    code,
  );
  return body.save ?? null;
}
