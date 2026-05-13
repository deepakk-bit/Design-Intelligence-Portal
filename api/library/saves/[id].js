// Vercel serverless function for /api/library/saves/:id.
// GET → fetch a single save (with JSX); DELETE → remove it.

import {
  handleLibraryGet,
  handleLibraryDelete,
  handleLibraryOptions,
} from "../../../lib/handlers.js";

export const config = {
  maxDuration: 15,
};

export default async function handler(req, res) {
  const id = req.query?.id;
  if (req.method === "OPTIONS") return handleLibraryOptions(req, res);
  if (req.method === "GET") return handleLibraryGet(req, res, { id });
  if (req.method === "DELETE") return handleLibraryDelete(req, res, { id });
  res.setHeader("Allow", "GET, DELETE, OPTIONS");
  res.status(405).end("method not allowed");
}
