import { TACTICS, detectTactics, scoreTactics, verdictFor, fallbackSafeReply } from "./rules.js";
import { SCENARIOS } from "./scenarios.js";

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WAKE = /^\s*(hey\s+)?guardian\b/i;
const LEVELS = { safe: 0, caution: 1, likely_scam: 2 };
const VERDICT_TEXT = { safe: "Looks safe", caution: "Be careful", likely_scam: "Likely scam" };

const state = {
  running: false,
  callId: 0,
  mode: null, // "demo" | "live"
  transcript: [],
  tactics: new Map(), // id -> { evidence, source: "rules" | "claude" }
  whispered: new Set(),
  level: "safe",
  ai: null,
  aiStatus: "unknown", // "on" | "off" | "unknown"
  aiInflight: false,
  aiDirty: false,
  pendingWhisper: null,
  guardianSpeaking: false,
  recognition: null,
  startedAt: 0,
  timer: null,
};

/* ---------------- voices ---------------- */

let voices = [];
function loadVoices() {
  voices = (speechSynthesis.getVoices() || []).filter((v) => /^en/i.test(v.lang));
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}
function pickVoice(pref, avoid = []) {
  const ok = voices.filter((v) => !avoid.includes(v));
  return ok.find((v) => pref.test(v.name)) || ok[0] || null;
}
function voiceSet() {
  const guardian = pickVoice(/aria|jenny|zira|samantha|female|libby|sonia/i);
  const caller = pickVoice(/guy|david|mark|daniel|male|ryan|george/i, [guardian]);
  const you = pickVoice(/hazel|susan|karen|moira|tessa|emma|michelle/i, [guardian, caller]);
  return { guardian, caller, you };
}

// ?silent runs every call with no audio at all (for automated testing).
const SILENT = new URLSearchParams(location.search).has("silent");

// Neural voices come from the server (/api/tts, free Edge voices). Each line is
// fetched once and kept as a blob URL; demos prefetch every line up front.
const audioCache = new Map();
function fetchVoice(text, role) {
  const key = `${role}|${text}`;
  if (!audioCache.has(key)) {
    audioCache.set(
      key,
      fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voice: role }),
      })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.statusText))))
        .then((b) => URL.createObjectURL(b))
        .catch(() => (audioCache.delete(key), null)),
    );
  }
  return audioCache.get(key);
}

let currentAudio = null;
function stopAudio() {
  currentAudio?.pause();
  currentAudio = null;
  window.speechSynthesis?.cancel();
}

/** Speak as a role: "caller", "caller_young", "caller_f", "you", "you_older", "guardian". */
async function speak(text, role, { volume = 1 } = {}) {
  const words = text.split(/\s+/).length;
  if (SILENT) return sleep(150 + words * 40);
  const url = await fetchVoice(text, role);
  if (url) {
    return new Promise((resolve) => {
      const a = new Audio(url);
      a.volume = volume;
      currentAudio = a;
      const guard = setTimeout(done, 3000 + words * 600);
      function done() {
        clearTimeout(guard);
        if (currentAudio === a) currentAudio = null;
        resolve();
      }
      a.onended = done;
      a.onerror = done;
      a.play().catch(done);
    });
  }
  // Offline fallback: the OS voices.
  const v = voiceSet();
  const voice = role === "guardian" ? v.guardian : role.startsWith("you") ? v.you : v.caller;
  return speakBrowser(text, { voice, volume });
}

function speakBrowser(text, { voice = null, rate = 1, pitch = 1, volume = 1 } = {}) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return setTimeout(resolve, 400 + text.split(" ").length * 300);
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = rate;
    u.pitch = pitch;
    u.volume = volume;
    // Chrome occasionally never fires onend; never let the call stall.
    const guard = setTimeout(done, 2500 + text.split(" ").length * 550);
    function done() {
      clearTimeout(guard);
      resolve();
    }
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  });
}

/* ---------------- earcon + haptics ---------------- */

let audioCtx;
function chime(urgent) {
  if (SILENT) return;
  try {
    audioCtx ??= new AudioContext();
    const notes = urgent ? [880, 660, 880] : [660, 880];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      const t = audioCtx.currentTime + i * 0.13;
      o.frequency.value = f;
      o.type = "sine";
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.13);
    });
  } catch {
    /* audio blocked: visual alert still shows */
  }
  navigator.vibrate?.(urgent ? [120, 80, 120] : [80]);
}

/* ---------------- whisper channel ---------------- */

// One slot: a newer, more severe warning replaces an unspoken older one,
// so the user hears one short sentence, never a backlog.
function queueWhisper(text, severity, kind = "alert") {
  if (!text) return;
  if (state.pendingWhisper && state.pendingWhisper.severity > severity) return;
  state.pendingWhisper = { text, severity, kind };
  if (state.mode === "live") flushWhisper();
}

async function flushWhisper() {
  const w = state.pendingWhisper;
  if (!w || state.guardianSpeaking) return;
  state.pendingWhisper = null;
  logWhisper(w.text, w.kind);
  if (!$("#whisperToggle").checked) return;
  state.guardianSpeaking = true;
  chime(w.severity >= 2);
  await sleep(320);
  await speak(w.text, "guardian", { volume: 0.8 });
  state.guardianSpeaking = false;
  if (state.pendingWhisper) return flushWhisper();
}

/* ---------------- detection pipeline ---------------- */

function currentRisk() {
  const ids = [...state.tactics.keys()].filter((id) => id in TACTICS);
  const rules = scoreTactics(ids);
  if (!state.ai) return rules;
  // Claude judges intent and can lower a keyword false alarm, except when a
  // decisive tactic (code, payment, remote access) was heard: that floor stays.
  const decisive = ids.some((id) => ["credential_request", "unusual_payment", "remote_access"].includes(id));
  return Math.max(state.ai.risk_score, decisive ? rules : 0);
}

function onUtterance(speaker, text, el) {
  state.transcript.push({ speaker, text });

  if (speaker === "you" && WAKE.test(text)) {
    el?.classList.add("command");
    return answerCommand(text);
  }
  if (speaker !== "caller") return requestAnalysis();

  const before = state.level;
  const fresh = [];
  for (const hit of detectTactics(text)) {
    if (!state.tactics.has(hit.id)) {
      state.tactics.set(hit.id, { evidence: hit.evidence, source: "rules" });
      fresh.push(hit.id);
    }
  }
  highlight(el, text);
  updateRisk();

  // Speak only once risk reaches "caution": a caller saying "bank" alone
  // should not make the guardian talk over a normal call.
  const unsaid = fresh.filter((id) => !state.whispered.has(id)).sort((a, b) => TACTICS[b].weight - TACTICS[a].weight);
  if (unsaid.length && state.level !== "safe") {
    const id = unsaid[0];
    unsaid.forEach((t) => state.whispered.add(t));
    const prefix = state.level === "likely_scam" && before !== "likely_scam" ? "Likely scam. " : "";
    queueWhisper(prefix + TACTICS[id].whisper, LEVELS[state.level]);
  }
  requestAnalysis();
}

function answerCommand(text) {
  const ids = [...state.tactics.keys()];
  let reply;
  if (/\b(real|scam|legit|safe)\b/i.test(text)) {
    const v = state.level;
    reply =
      v === "likely_scam"
        ? `This looks like a scam. ${state.ai?.safe_reply || fallbackSafeReply(ids)}`
        : v === "caution"
          ? `Not sure yet. Warning signs: ${ids.map((id) => TACTICS[id]?.label.toLowerCase()).filter(Boolean).join(", ")}.`
          : "Nothing suspicious so far.";
  } else {
    reply = state.ai?.safe_reply || fallbackSafeReply(ids);
  }
  queueWhisper(reply, 3, "answer");
}

async function requestAnalysis() {
  if (state.aiStatus === "off") return;
  if (state.aiInflight) {
    state.aiDirty = true;
    return;
  }
  state.aiInflight = true;
  state.aiDirty = false;
  setAiPill("thinking");
  const snapshot = state.transcript.slice();
  const call = state.callId;
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: snapshot }),
    });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
    if (call === state.callId) applyAi(data);
    state.aiStatus = "on";
    setAiPill("on", data.latency_ms);
  } catch (err) {
    console.warn("Claude analysis unavailable, rules only:", err.message);
    // Auth/config problems: stop trying for this session. Transient: try next line.
    if ([401, 503].includes(err.status)) state.aiStatus = "off";
    setAiPill(state.aiStatus === "off" ? "off" : "error", null, err.message);
  } finally {
    state.aiInflight = false;
    if (state.aiDirty && state.running) requestAnalysis();
  }
}

function applyAi(ai) {
  const before = state.level;
  state.ai = ai;
  for (const t of ai.tactics || []) {
    if (!state.tactics.has(t.id)) state.tactics.set(t.id, { evidence: t.evidence, source: "claude" });
  }
  updateRisk();
  // Claude escalated beyond what the rules saw: let it speak.
  if (LEVELS[state.level] > LEVELS[before] && ai.whisper) {
    const prefix = state.level === "likely_scam" ? "Likely scam. " : "";
    queueWhisper(prefix + ai.whisper.replace(/^likely scam\.\s*/i, ""), LEVELS[state.level]);
  }
  if (ai.safe_reply) $("#safeReply").textContent = ai.safe_reply;
}

/* ---------------- UI ---------------- */

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function renderLine(speaker, text) {
  $("#emptyTranscript")?.remove();
  const li = document.createElement("li");
  li.className = `line ${speaker} speaking`;
  li.innerHTML = `<span class="who">${speaker === "you" ? "You" : "Caller"}</span><p>${esc(text)}</p>`;
  $("#transcript").append(li);
  li.scrollIntoView({ block: "end", behavior: "smooth" });
  return li;
}

function highlight(li, text) {
  if (!li) return;
  let html = esc(text);
  for (const hit of detectTactics(text)) {
    html = html.replace(esc(hit.evidence), `<mark title="${esc(TACTICS[hit.id].label)}">${esc(hit.evidence)}</mark>`);
  }
  li.querySelector("p").innerHTML = html;
}

function updateRisk() {
  const risk = currentRisk();
  state.level = verdictFor(risk);
  const panel = $("#riskPanel");
  panel.dataset.level = state.level;
  $("#riskScore").textContent = risk;
  $("#riskBar").style.width = `${risk}%`;
  $("#verdict").textContent = VERDICT_TEXT[state.level];
  document.body.dataset.level = state.level;

  const list = $("#tactics");
  list.innerHTML = "";
  if (state.tactics.size === 0) {
    list.innerHTML = `<li class="muted">No warning signs yet.</li>`;
  }
  for (const [id, t] of state.tactics) {
    const li = document.createElement("li");
    const label = TACTICS[id]?.label ?? "Other scam tactic";
    li.innerHTML = `<strong>${esc(label)}</strong><q>${esc(t.evidence)}</q><span class="src">${t.source === "claude" ? "Claude" : "rule"}</span>`;
    list.append(li);
  }
  if (!state.ai) {
    $("#safeReply").textContent =
      state.level === "safe" ? fallbackSafeReply([]) : fallbackSafeReply([...state.tactics.keys()]);
  }
}

function logWhisper(text, kind) {
  const log = $("#whispers");
  log.querySelector(".muted")?.remove();
  const li = document.createElement("li");
  li.className = kind;
  li.innerHTML = `<time>${elapsed()}</time> ${esc(text)}`;
  log.prepend(li);
  const toast = $("#toast");
  toast.textContent = text;
  toast.className = `toast show ${kind}`;
  clearTimeout(logWhisper.t);
  logWhisper.t = setTimeout(() => (toast.className = "toast"), 4500);
}

function setAiPill(status, latency, msg) {
  const pill = $("#aiPill");
  pill.dataset.status = status;
  pill.textContent =
    status === "on" ? `Claude · ${latency ?? "–"} ms` :
    status === "thinking" ? "Claude thinking…" :
    status === "off" ? "Rules only (no Claude key)" :
    "Claude error · rules active";
  pill.title = msg || "";
}

function elapsed() {
  const s = Math.floor((Date.now() - state.startedAt) / 1000);
  return `${String(Math.floor(s / 60)).padStart(1, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function resetCall(callerId, mode) {
  stopAudio();
  Object.assign(state, {
    running: true, callId: state.callId + 1, mode, transcript: [], tactics: new Map(), whispered: new Set(),
    level: "safe", ai: null, pendingWhisper: null, guardianSpeaking: false, startedAt: Date.now(),
  });
  $("#transcript").innerHTML = "";
  $("#whispers").innerHTML = `<li class="muted">Guardian is quiet until something looks wrong.</li>`;
  $("#summary").hidden = true;
  $("#callerId").textContent = callerId;
  $("#callState").textContent = "On call";
  document.body.classList.add("in-call");
  clearInterval(state.timer);
  state.timer = setInterval(() => ($("#callTimer").textContent = elapsed()), 500);
  updateRisk();
}

async function endCall() {
  if (!state.running) return;
  state.running = false;
  clearInterval(state.timer);
  state.recognition?.stop();
  document.body.classList.remove("in-call");
  $("#callState").textContent = "Call ended";
  document.querySelectorAll(".line.speaking").forEach((el) => el.classList.remove("speaking"));

  const ids = [...state.tactics.keys()];
  const risk = currentRisk();
  const s = $("#summary");
  s.hidden = false;
  s.dataset.level = state.level;
  const labels = ids.map((id) => TACTICS[id]?.label ?? "Other scam tactic");
  s.querySelector("h3").textContent = `${VERDICT_TEXT[state.level]} · risk ${risk}/100`;
  s.querySelector("p").textContent =
    state.level === "safe"
      ? "No scam tactics detected on this call."
      : `The caller used ${ids.length} warning sign${ids.length === 1 ? "" : "s"}: ${labels.join("; ")}. If you shared a code or paid anything, call your bank using the number on your card.`;

  let spoken;
  if (state.level === "likely_scam") {
    spoken = `Call ended. That was very likely a scam. If you shared anything, call your bank on the number on your card.`;
  } else if (state.level === "caution") {
    spoken = "Call ended. That call had some warning signs. Verify it by calling back on an official number.";
  }
  if (spoken && $("#whisperToggle").checked) {
    await sleep(500);
    await speak(spoken, "guardian", { volume: 0.85 });
  }
}

/* ---------------- demo mode ---------------- */

async function runDemo(id) {
  const sc = SCENARIOS[id];
  resetCall(sc.callerId, "demo");
  const call = state.callId;
  const alive = () => state.running && state.callId === call;
  const roleOf = (line) => line.voice || (line.speaker === "you" ? "you" : "caller");
  if (!SILENT) {
    // Warm the cache: every line, plus the rule whispers Guardian may say.
    sc.lines.forEach((l) => fetchVoice(l.text, roleOf(l)));
    Object.values(TACTICS).forEach((t) => fetchVoice(t.whisper, "guardian"));
    await fetchVoice(sc.lines[0].text, roleOf(sc.lines[0]));
  }
  await sleep(400);
  for (const line of sc.lines) {
    if (!alive()) return;
    const el = renderLine(line.speaker, line.text);
    await speak(line.text, roleOf(line));
    if (!alive()) return;
    el.classList.remove("speaking");
    onUtterance(line.speaker, line.text, el);
    // Commands wait briefly for Claude's suggested reply if one is in flight.
    if (line.speaker === "you" && WAKE.test(line.text) && state.aiInflight) await sleep(1200);
    await sleep(250);
    await flushWhisper();
    await sleep(300);
  }
  // Let a late Claude verdict land before the summary.
  for (let i = 0; i < 20 && state.aiInflight; i++) await sleep(200);
  if (!alive()) return;
  await flushWhisper();
  endCall();
}

/* ---------------- live mode ---------------- */

function startLive() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert("Live mode needs the Web Speech API (Chrome or Edge). Try a demo call instead.");
    return;
  }
  resetCall("Live call · speakerphone", "live");
  const rec = new SR();
  rec.lang = "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  let interimEl = null;
  rec.onresult = (e) => {
    // Ignore our own voice coming back through the mic.
    if (state.guardianSpeaking) return;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = r[0].transcript.trim();
      if (!text) continue;
      const speaker = WAKE.test(text) ? "you" : "caller";
      if (!interimEl) interimEl = renderLine(speaker, text);
      interimEl.className = `line ${speaker} speaking`;
      interimEl.querySelector(".who").textContent = speaker === "you" ? "You" : "Caller";
      interimEl.querySelector("p").textContent = text;
      if (r.isFinal) {
        interimEl.classList.remove("speaking");
        onUtterance(speaker, text, interimEl);
        interimEl = null;
      }
    }
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed") {
      alert("Microphone permission was denied.");
      endCall();
    }
  };
  rec.onend = () => state.running && state.mode === "live" && rec.start();
  state.recognition = rec;
  rec.start();
}

/* ---------------- wiring ---------------- */

document.querySelectorAll("[data-demo]").forEach((btn) =>
  btn.addEventListener("click", () => {
    endCall();
    runDemo(btn.dataset.demo);
  }),
);
$("#liveBtn").addEventListener("click", () => {
  endCall();
  startLive();
});
$("#hangupBtn").addEventListener("click", () => {
  stopAudio();
  endCall();
});
if (SILENT) $("#whisperToggle").closest("label").append(" (silent test mode)");

fetch("/api/status")
  .then((r) => r.json())
  .then((s) => {
    state.aiStatus = s.ai ? "unknown" : "off";
    setAiPill(s.ai ? "on" : "off");
    if (s.ai) $("#aiPill").textContent = `Claude ready · ${s.model}`;
  })
  .catch(() => setAiPill("off"));

updateRisk();
