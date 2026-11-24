import { test } from "node:test";
import assert from "node:assert/strict";
import { detectTactics, scoreTactics, verdictFor } from "../public/rules.js";
import { SCENARIOS } from "../public/scenarios.js";
import { formatTranscript } from "../src/analyze.js";

const ids = (text) => detectTactics(text).map((h) => h.id).sort();

/** Run a scripted call through the rules exactly like the browser does. */
function replay(lines) {
  const seen = new Set();
  for (const l of lines) {
    if (l.speaker !== "caller") continue;
    for (const h of detectTactics(l.text)) seen.add(h.id);
  }
  const score = scoreTactics([...seen]);
  return { seen, score, verdict: verdictFor(score) };
}

test("catches a one-time-code request", () => {
  assert.deepEqual(ids("I just texted you a six digit verification code. Read me the code."), ["credential_request"]);
});

test("catches gift card and crypto payment asks", () => {
  assert.ok(ids("Go buy Google Play cards").includes("unusual_payment"));
  assert.ok(ids("You can pay the fine in bitcoin").includes("unusual_payment"));
});

test("ordinary lines stay clean", () => {
  for (const line of [
    "Your prescription refill is ready for pickup.",
    "The copay is ten dollars, pay at the counter.",
    "Hi, it's Sam, are we still on for lunch?",
    "Your package will arrive tomorrow between 9 and 5.",
  ]) {
    assert.deepEqual(ids(line), [], line);
  }
});

test("a lone bank mention is not enough to alarm", () => {
  const score = scoreTactics(["impersonation"]);
  assert.equal(verdictFor(score), "safe");
});

test("code request + pressure crosses the likely-scam line", () => {
  assert.equal(verdictFor(scoreTactics(["credential_request", "urgency_threat"])), "likely_scam");
});

test("demo: bank fraud call ends as likely scam", () => {
  const r = replay(SCENARIOS.bank.lines);
  assert.equal(r.verdict, "likely_scam");
  for (const id of ["credential_request", "urgency_threat", "impersonation", "secrecy", "unusual_payment"]) {
    assert.ok(r.seen.has(id), `missing ${id}`);
  }
});

test("demo: grandchild call ends as likely scam", () => {
  const r = replay(SCENARIOS.grandchild.lines);
  assert.equal(r.verdict, "likely_scam");
  assert.ok(r.seen.has("emotional_hook"));
  assert.ok(r.seen.has("unusual_payment"));
});

test("demo: real pharmacy call stays safe with zero hits", () => {
  const r = replay(SCENARIOS.pharmacy.lines);
  assert.equal(r.seen.size, 0);
  assert.equal(r.verdict, "safe");
});

test("transcript formatting labels speakers for Claude", () => {
  assert.equal(
    formatTranscript([{ speaker: "caller", text: "hi" }, { speaker: "you", text: "hello" }]),
    "caller: hi\nyou: hello",
  );
});
