// Vercel serverless function for /api/chat.

import { handleChat } from "../lib/handlers.js";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).end("method not allowed");
    return;
  }
  return handleChat(req, res);
}
