// Claude layer: reads the whole transcript so far and judges intent.
// The rules in public/rules.js catch known phrases; Claude catches the rest
// (paraphrases, slow-build social engineering, and legit calls that merely
// mention a bank, which the rules alone would over-flag).

import Anthropic from "@anthropic-ai/sdk";
import { TACTIC_IDS } from "../public/rules.js";

export const MODEL = process.env.GUARDIAN_MODEL || "claude-opus-5-5";

const SYSTEM = `You are Call Guardian, a scam-detection agent that listens to a live phone call on behalf of the person who answered it (labelled "you"). The other party is labelled "caller".

After each new line you get the full transcript so far. Judge whether the CALLER is attempting fraud.

Score risk_score from 0 to 100:
- 0-34 safe: ordinary call, even if it mentions a bank, pharmacy or delivery.
- 35-69 caution: one or two warning signs, intent not yet clear.
- 70-100 likely_scam: the caller asks for codes, passwords, gift cards, crypto, wires, remote access, or secrecy, especially combined with pressure or impersonation.

Rules:
- Judge intent, not keywords. A pharmacy confirming a refill is safe. "Your account is locked, read me the code we texted" is a scam.
- tactics: only tactics the CALLER actually used, each with a short verbatim quote as evidence. Use "other" for a scam tactic outside the list.
- whisper: at most 12 words, spoken privately into the user's ear mid-call. Calm, direct, no jargon. Empty string if the call is safe.
- safe_reply: at most 20 words the user can say out loud to the caller right now, or what to do next.`;

const SCHEMA = {
  type: "object",
  properties: {
    risk_score: { type: "integer" },
    verdict: { type: "string", enum: ["safe", "caution", "likely_scam"] },
    tactics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: [...TACTIC_IDS, "other"] },
          evidence: { type: "string" },
        },
        required: ["id", "evidence"],
        additionalProperties: false,
      },
    },
    whisper: { type: "string" },
    safe_reply: { type: "string" },
  },
  required: ["risk_score", "verdict", "tactics", "whisper", "safe_reply"],
  additionalProperties: false,
};

let client;
function getClient() {
  // Resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile.
  client ??= new Anthropic();
  return client;
}

export function formatTranscript(lines) {
  return lines
    .map((l) => `${l.speaker === "you" ? "you" : "caller"}: ${String(l.text).slice(0, 500)}`)
    .join("\n");
}

/** @param {{speaker: string, text: string}[]} lines */
export async function analyzeCall(lines) {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    // Low effort: this runs after every utterance and has to come back fast.
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    // If a safety classifier declines (a scam script can look like a scam request),
    // the API re-runs the call on a fallback model instead of failing.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Transcript so far:\n${formatTranscript(lines)}` }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Model declined (${response.stop_details?.category ?? "unknown"})`);
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error(`No text in response (stop_reason: ${response.stop_reason})`);
  const result = JSON.parse(text);
  result.risk_score = Math.max(0, Math.min(100, Math.round(result.risk_score)));
  return result;
}
