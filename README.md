# Call Guardian

A voice agent that listens to a phone call with you. When the caller starts using scam tactics, it **whispers a short warning in your ear**, mid-call. It also answers when you ask it, under your breath, *"Guardian, what should I say?"*

Built for the Hiya Voice AI Challenge, **Security / Real-Time Assistance** track. The one-page write-up is in [WRITEUP.md](WRITEUP.md). AI tool usage is in [ai.md](ai.md).

## Quick start

Needs **Node 20+** and **Chrome or Edge** (for the Web Speech API).

```bash
npm install
npm start            # http://localhost:5190
```

Open http://localhost:5190, **turn your sound on**, and click **Bank fraud call**.

### Turn on the Claude layer (optional, recommended)

The app runs without a key, using only the rules engine. To add Claude's judgement:

```bash
# macOS / Linux
ANTHROPIC_API_KEY=sk-ant-... npm start

# Windows PowerShell
$env:ANTHROPIC_API_KEY="sk-ant-..."; npm start
```

The pill in the top-right shows `Claude · 1234 ms` per analysis when the layer is live, or `Rules only` when it isn't.

| Env var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Enables the Claude layer |
| `GUARDIAN_MODEL` | `claude-opus-5-5` | Model used for analysis |
| `GUARDIAN_AI` | on | Set to `off` to force rules only |
| `PORT` | `5190` | HTTP port |

### Voices

Demo calls and whispers use free **Microsoft neural voices** (the Edge Read Aloud service, through the [`msedge-tts`](https://www.npmjs.com/package/msedge-tts) package). They need no key, but they do need internet access. Each line is synthesized once on the server and cached in `.tts-cache/`, so repeat plays start instantly. If the service can't be reached, the app falls back to your OS's built-in voices automatically.

Voice roles (whitelisted in `src/tts.js`): caller (Andrew), young caller (Brian), pharmacist (Michelle), you (Emma), older you (Jenny), **Guardian (Ava)**.

### Silent test mode

Open `http://localhost:5190/?silent` to run any call with no audio at all. The pipeline, whispers and summary all still run at speed. Use it for automated testing.

### Tests

```bash
npm test
```

There are 9 unit tests. They cover the rules engine and replay all three demo calls through it: both scams must end as `likely_scam`, and the real pharmacy call must get **zero** hits.

## What to try

| Button | What happens |
|---|---|
| **Bank fraud call** | A fake "Chase fraud team" call. Guardian stays quiet through the bank name alone. It warns when pressure starts ("compromised… frozen"), escalates to *Likely scam* when the caller asks for the texted code, and answers *"Guardian, what should I say?"* |
| **Grandchild in trouble** | The classic "Grandma, I'm in jail, don't tell mom, buy Google Play cards". You can ask *"Guardian, is this real?"* |
| **Real pharmacy call** | A genuine refill call that mentions a copay. Guardian stays silent. This is the false-positive check. |
| **Start listening** | Live mode. Put a real call (or a friend reading a script) on speaker. The mic transcribes it continuously. Say *"Guardian, …"* to ask a question. |

## How it works

```
 call audio ──► Web Speech API (browser STT, streaming)
                    │ each final utterance
                    ▼
   ┌──────── rules.js (in browser, ~0 ms) ─────────┐
   │ regex tactic detectors → weighted risk score │──► whisper if risk ≥ 35 and tactic is new
   └──────────────────────────────────────────────┘
                    │ full transcript so far
                    ▼
   server.js ──► src/analyze.js ──► Claude (structured JSON output)
                    │ risk_score, verdict, tactics+evidence, whisper, safe_reply
                    ▼
   merge: risk = max(Claude, rules floor if a decisive tactic was heard)
                    │
                    ▼
   whisper channel: chime + vibration + quiet TTS voice between caller sentences
```

**Two layers, on purpose.**
- **Rules** (`public/rules.js`) are instant and work offline. They catch the phrases that matter most: one-time codes, gift cards, crypto, remote-access apps, secrecy, threats. A scammer asking for your code can't outrun a network call.
- **Claude** (`src/analyze.js`) reads the whole transcript and judges *intent*. It catches paraphrases the regexes miss, and it can *lower* a keyword false alarm (a real bank saying "your card was locked"). It can never lower the score below the rules floor once a decisive tactic has been heard (code, payment, remote access). Claude's output is constrained by a JSON schema, so the UI never parses free text.

**Whisper design** is the core of the voice UX:
- **Silent until risk reaches 35.** A caller saying "bank" alone never makes Guardian talk over a normal call.
- **One sentence of 12 words or fewer, once per tactic.** The whisper slot holds one message. A more severe warning replaces a pending milder one, so you never hear a backlog.
- **Chime first, then a different, quieter voice.** You can tell it apart from the caller. A haptic buzz fires on phones.
- **Spoken in the gap after the caller finishes a sentence**, so it doesn't talk over them.
- **Every whisper also appears as an on-screen toast and in the log**, for users who can't hear it.

## Project layout

```
server.js            zero-dependency HTTP server + /api/analyze proxy (keeps the key server-side)
src/analyze.js       Claude call: system prompt, JSON schema, refusal handling
src/tts.js           free neural TTS (Edge voices) with memory + disk cache
public/rules.js      tactic detectors, scoring, verdict thresholds (shared with tests)
public/app.js        speech in/out, whisper channel, risk merge, UI
public/scenarios.js  scripted demo calls
tests/               node:test unit tests
```

## Known limits of the prototype

- **One audio channel.** The browser mic hears the room, so in live mode every line is labelled *caller* except your *"Guardian…"* commands. A production build would tap the two call legs separately (on-device telephony APIs or a carrier integration), which gives exact speaker labels.
- **Web Speech API is Chrome/Edge only.** In Chrome it sends audio to Google for recognition. Production would use on-device STT (Whisper.cpp, or the platform's speech API) for privacy.
- The neural voices use Microsoft's unofficial Read Aloud endpoint. That's fine for a prototype, but production would use a paid TTS API with an SLA (Azure Speech, ElevenLabs) or an on-device model.
