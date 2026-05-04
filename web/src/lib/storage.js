// localStorage-backed workspace persistence.
// Each workspace = { id, name, thumbnail, createdAt, updatedAt, canvas }
// canvas = { nodes, edges, viewport }

import { nanoid } from "nanoid";

const KEY = "di.workspaces.v1";

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(workspaces) {
  localStorage.setItem(KEY, JSON.stringify(workspaces));
}

export function listWorkspaces() {
  return read().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getWorkspace(id) {
  return read().find((w) => w.id === id) ?? null;
}

export function createWorkspace(name = "Untitled workspace") {
  const now = Date.now();
  const ws = {
    id: nanoid(10),
    name,
    thumbnail: null,
    createdAt: now,
    updatedAt: now,
    canvas: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  };
  const all = read();
  all.push(ws);
  write(all);
  return ws;
}

export function updateWorkspace(id, patch) {
  const all = read();
  const i = all.findIndex((w) => w.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], ...patch, updatedAt: Date.now() };
  write(all);
  return all[i];
}

export function deleteWorkspace(id) {
  write(read().filter((w) => w.id !== id));
}

export function duplicateWorkspace(id) {
  const src = getWorkspace(id);
  if (!src) return null;
  const now = Date.now();
  const copy = {
    ...src,
    id: nanoid(10),
    name: `${src.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
  const all = read();
  all.push(copy);
  write(all);
  return copy;
}
