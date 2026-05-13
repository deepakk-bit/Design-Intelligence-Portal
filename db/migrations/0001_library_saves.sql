-- Library Saves: per-device-uuid scoped collection of generator outputs.
-- One row = one full output card (component + every state section).
-- The library_code column is the user's identity; every read filters by it.

CREATE TABLE IF NOT EXISTS library_saves (
  id              TEXT PRIMARY KEY,
  library_code    TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  component_name  TEXT NOT NULL,
  description     TEXT,
  sections_json   JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS library_saves_by_code
  ON library_saves(library_code, created_at DESC);
