// Vercel serverless function for /api/analyze.
// Reuses the shared handler so behavior matches local dev exactly.

import { handleAnalyze } from "../lib/handlers.js";

export const config = {
  // Vision analyses with thinking + high effort can take 20–60s.
  // Hobby tier caps at 10s — upgrade to Pro for the full window.
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).end("method not allowed");
    return;
  }
  return handleAnalyze(req, res);
}
