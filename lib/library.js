// Library accessors. Every function takes a `library_code` and uses it in
// the WHERE clause unconditionally — that's how per-user scoping is
// enforced. A missing or empty code throws before the query runs.

import { customAlphabet } from "nanoid";
import { HAS_DB, query } from "./db.js";

export { HAS_DB };

// nanoid-12 over an unambiguous alphabet. Short enough to fit in a URL,
// long enough to make collisions vanishingly unlikely at our scale.
const newId = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  12,
);

function assertCode(code) {
  if (typeof code !== "string" || !code.trim()) {
    const err = new Error("library_code is required");
    err.code = "MISSING_LIBRARY_CODE";
    throw err;
  }
}

// Public listing. JSX is intentionally omitted from each section so the
// list payload stays light — clients fetch the full record only when the
// user picks a card.
export async function listSaves(libraryCode) {
  assertCode(libraryCode);
  const { rows } = await query(
    `SELECT id, agent_id, component_name, description, sections_json, created_at
       FROM library_saves
      WHERE library_code = $1
      ORDER BY created_at DESC
      LIMIT 200`,
    [libraryCode],
  );
  return rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    componentName: r.component_name,
    description: r.description,
    createdAt: r.created_at,
    // Strip jsx from each section; keep label + html so the gallery can
    // render thumbnails without a follow-up fetch.
    sections: (r.sections_json ?? []).map((s) => ({
      label: s.label,
      html: s.html,
    })),
  }));
}

export async function getSave(libraryCode, id) {
  assertCode(libraryCode);
  if (!id) return null;
  const { rows } = await query(
    `SELECT id, agent_id, component_name, description, sections_json, created_at
       FROM library_saves
      WHERE library_code = $1 AND id = $2`,
    [libraryCode, id],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    agentId: r.agent_id,
    componentName: r.component_name,
    description: r.description,
    createdAt: r.created_at,
    sections: r.sections_json ?? [],
  };
}

export async function createSave(libraryCode, payload) {
  assertCode(libraryCode);
  const id = newId();
  const agentId = String(payload?.agentId || "jsx-generator").slice(0, 64);
  const componentName = String(payload?.componentName || "Component")
    .trim()
    .slice(0, 200);
  const description = payload?.description
    ? String(payload.description).trim().slice(0, 2000)
    : null;
  const sections = Array.isArray(payload?.sections)
    ? payload.sections
        .filter((s) => s && typeof s.jsx === "string" && s.jsx.trim())
        .map((s) => ({
          label: String(s.label || "Default").trim(),
          jsx: s.jsx,
          html: typeof s.html === "string" ? s.html : "",
        }))
    : [];

  if (sections.length === 0) {
    const err = new Error("at least one section with jsx is required");
    err.code = "EMPTY_SECTIONS";
    throw err;
  }

  await query(
    `INSERT INTO library_saves(id, library_code, agent_id, component_name, description, sections_json)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, libraryCode, agentId, componentName, description, JSON.stringify(sections)],
  );
  return { id, agentId, componentName, description, sections, createdAt: new Date().toISOString() };
}

export async function deleteSave(libraryCode, id) {
  assertCode(libraryCode);
  if (!id) return false;
  const { rowCount } = await query(
    `DELETE FROM library_saves WHERE library_code = $1 AND id = $2`,
    [libraryCode, id],
  );
  return rowCount > 0;
}
