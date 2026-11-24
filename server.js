// Tiny zero-framework server: serves public/ and proxies analysis to Claude
// so the API key never reaches the browser.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { analyzeCall, MODEL } from "./src/analyze.js";
import { synthesize, initTtsCache } from "./src/tts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const PORT = Number(process.env.PORT) || 5190;
const HAS_CREDENTIALS = Boolean(
  process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE,
);
const AI_DISABLED = process.env.GUARDIAN_AI === "off" || !HAS_CREDENTIALS;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readJson(req, limit = 64_000) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > limit) throw new Error("body too large");
  }
  return JSON.parse(data || "{}");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/status") {
    return send(res, 200, { ai: !AI_DISABLED, model: AI_DISABLED ? null : MODEL });
  }

  if (req.method === "POST" && url.pathname === "/api/tts") {
    try {
      const { text, voice } = await readJson(req, 4_000);
      const audio = await synthesize(text, voice);
      res.writeHead(200, { "content-type": "audio/mpeg", "cache-control": "no-store" });
      return res.end(audio);
    } catch (err) {
      console.error("[tts]", err.message);
      return send(res, 502, { error: err.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/analyze") {
    if (AI_DISABLED) return send(res, 503, { error: "AI layer off: set ANTHROPIC_API_KEY to enable Claude" });
    try {
      const { transcript } = await readJson(req);
      if (!Array.isArray(transcript) || transcript.length === 0) {
        return send(res, 400, { error: "transcript must be a non-empty array" });
      }
      const started = Date.now();
      const result = await analyzeCall(transcript.slice(-60));
      return send(res, 200, { ...result, latency_ms: Date.now() - started });
    } catch (err) {
      let status = 502;
      if (err instanceof Anthropic.AuthenticationError) status = 401;
      else if (err instanceof Anthropic.RateLimitError) status = 429;
      else if (err instanceof SyntaxError) status = 400;
      else if (/credentials|api key|apiKey/i.test(String(err.message))) status = 401;
      console.error("[analyze]", status, err.message);
      return send(res, status, { error: err.message });
    }
  }

  if (req.method === "GET") {
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: "forbidden" });
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      return res.end(body);
    } catch {
      return send(res, 404, { error: "not found" });
    }
  }

  send(res, 405, { error: "method not allowed" });
});

await initTtsCache(path.join(here, ".tts-cache"));

server.listen(PORT, () => {
  console.log(`Call Guardian on http://localhost:${PORT}`);
  console.log(AI_DISABLED ? "AI layer: off, rules only (set ANTHROPIC_API_KEY to enable Claude)" : `AI layer: ${MODEL}`);
});
