// Vercel serverless function for /api/library/saves (collection).
// GET → list; POST → create. Each handler enforces auth, DB presence,
// and the X-Library-Code header before touching Postgres.

import {
  handleLibraryList,
  handleLibraryCreate,
  handleLibraryOptions,
} from "../../lib/handlers.js";

export const config = {
  maxDuration: 15,
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return handleLibraryOptions(req, res);
  if (req.method === "GET") return handleLibraryList(req, res);
  if (req.method === "POST") return handleLibraryCreate(req, res);
  res.setHeader("Allow", "GET, POST, OPTIONS");
  res.status(405).end("method not allowed");
}
