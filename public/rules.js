// Instant, offline scam-tactic detector. Runs in the browser on every utterance
// (zero latency, works with no network) and in Node for the unit tests.
// The Claude layer (src/analyze.js) adds judgement on top; these rules are the floor.

export const TACTICS = {
  credential_request: {
    label: "Asks for a code, PIN or password",
    weight: 40,
    whisper: "Never share a code. Your bank will not ask for it.",
    patterns: [
      /\b(one[- ]time|verification|security|confirmation|6[- ]digit|six[- ]digit)\s+(code|pin|number)\b/i,
      /\b(read|tell|give)\s+(me|us)\s+(the|that|your)\s+(code|pin|password|number)\b/i,
      /\bcode\s+(we|i)\s+(just\s+)?(sent|texted)\b/i,
      /\b(your\s+)?(pin|password|passcode)\b/i,
      /\bsocial\s+security\s+number\b/i,
      /\b(full\s+)?card\s+number\b/i,
    ],
  },
  unusual_payment: {
    label: "Wants gift cards, crypto or a wire",
    weight: 40,
    whisper: "Gift cards and crypto are how scammers get paid.",
    patterns: [
      /\bgift\s*cards?\b/i,
      /\b(google\s+play|itunes|apple|steam|target|walmart)\s+cards?\b/i,
      /\b(bitcoin|crypto(currency)?|usdt|tether)\b/i,
      /\bwire\s+(transfer|the\s+money)\b/i,
      /\b(zelle|western\s+union|moneygram|cash\s*app|venmo)\b/i,
      /\bsafe\s+account\b/i,
    ],
  },
  urgency_threat: {
    label: "Pressure, threats or a deadline",
    weight: 20,
    whisper: "They are rushing you. You have time to hang up.",
    patterns: [
      /\b(arrest(ed)?|warrant|deport(ed|ation)?|lawsuit|legal\s+action|jail)\b/i,
      /\b(right\s+now|immediately|within\s+the\s+(hour|next\s+\d+\s+minutes)|before\s+it'?s\s+too\s+late)\b/i,
      /\b(suspended|frozen|locked|compromised)\b/i,
      /\bfinal\s+(notice|warning)\b/i,
    ],
  },
  impersonation: {
    label: "Claims to be a bank, agency or tech firm",
    weight: 15,
    whisper: "Anyone can claim to be your bank. Call the number on your card.",
    patterns: [
      /\bfraud\s+(department|team|prevention)\b/i,
      /\b(irs|internal\s+revenue|social\s+security\s+administration|medicare|hmrc)\b/i,
      /\b(police|sheriff|federal\s+agent|fbi)\b/i,
      /\b(microsoft|apple|amazon)\s+(support|security|technician)\b/i,
      /\bcalling\s+from\s+(your\s+)?(bank|chase|wells\s+fargo|bank\s+of\s+america|citi)\b/i,
    ],
  },
  secrecy: {
    label: "Tells you to keep it secret or stay on the line",
    weight: 25,
    whisper: "They want secrecy. Real banks and real family don't.",
    patterns: [
      /\b(don'?t|do\s+not)\s+(tell|mention|talk\s+to)\b/i,
      /\bkeep\s+(this|it)\s+(between\s+us|quiet|secret|confidential)\b/i,
      /\b(don'?t|do\s+not)\s+hang\s+up\b/i,
      /\bstay\s+on\s+the\s+line\b/i,
    ],
  },
  remote_access: {
    label: "Wants to control your device",
    weight: 30,
    whisper: "Do not install anything they ask for.",
    patterns: [
      /\b(anydesk|teamviewer|quick\s*support|ultraviewer)\b/i,
      /\bremote\s+(access|control|desktop)\b/i,
      /\b(download|install)\s+(an?|this|the)\s+app\b/i,
    ],
  },
  emotional_hook: {
    label: "Family emergency story",
    weight: 20,
    whisper: "Hang up and call your family member on their own number.",
    patterns: [
      /\b(grandma|grandpa|nana|granny)\b.*\b(it'?s\s+me|help)\b/i,
      /\b(i'?m|i\s+am)\s+in\s+(jail|trouble|the\s+hospital)\b/i,
      /\b(bail|car\s+accident|hit\s+a\s+car)\b/i,
    ],
  },
};

export const TACTIC_IDS = Object.keys(TACTICS);

/** Find tactics in one utterance. Returns [{ id, evidence }], one per tactic. */
export function detectTactics(text) {
  const hits = [];
  for (const [id, tactic] of Object.entries(TACTICS)) {
    for (const re of tactic.patterns) {
      const m = text.match(re);
      if (m) {
        hits.push({ id, evidence: m[0] });
        break;
      }
    }
  }
  return hits;
}

/**
 * Risk 0-100 from the set of distinct tactics seen so far in the call.
 * Payment + credential tactics are the decisive ones; any pair of them with
 * pressure or impersonation pushes the call over the "likely scam" line.
 */
export function scoreTactics(ids) {
  const set = new Set(ids);
  let score = 0;
  for (const id of set) score += TACTICS[id]?.weight ?? 10;
  const decisive = set.has("credential_request") || set.has("unusual_payment") || set.has("remote_access");
  const pressure = set.has("urgency_threat") || set.has("secrecy") || set.has("impersonation");
  if (decisive && pressure) score += 15;
  return Math.min(100, score);
}

export function verdictFor(score) {
  if (score >= 70) return "likely_scam";
  if (score >= 35) return "caution";
  return "safe";
}

/** Short, speakable advice for a guardian command ("Guardian, what do I say?"). */
export function fallbackSafeReply(ids) {
  const set = new Set(ids);
  if (set.has("credential_request")) return "Say: I don't share codes over the phone. I'll call my bank myself. Then hang up.";
  if (set.has("unusual_payment")) return "Say: I don't pay with gift cards or crypto. Goodbye. Then hang up.";
  if (set.has("remote_access")) return "Say: I won't install anything. Goodbye.";
  if (set.has("emotional_hook")) return "Ask a question only your real family member would know. Then call them back on their own number.";
  if (set.size) return "Say: I'll call you back on the official number. Then hang up and dial it yourself.";
  return "Nothing suspicious yet. If they ask for money or a code, I'll tell you.";
}
