# AI tools used

## While building

**Claude Code (Claude Opus 5.5)**, in the Claude desktop app, was my pair programmer for the whole build.

- **Choosing the problem.** I asked for concepts across the five tracks and picked the scam-call guardian. Hiya's core business is call protection. A scam happens *inside* a voice call, so voice is the only channel where a warning can reach you in time.
- **Scaffolding and code.** Claude Code wrote the first drafts of every file: server, rules engine, Claude integration, browser speech pipeline, UI, tests, and docs. I steered the design decisions below and reviewed the output.
- **Testing.** Claude Code ran the unit tests and drove the app in a built-in browser. It played the bank-fraud demo end to end and read back the transcript, the risk score and the whisper log to confirm the flow worked. That run also exposed the missing-key path (a 401 from the API), and the app now handles that cleanly.

Decisions I made and can defend:
- **Two-layer detection** (instant rules + Claude judgement), instead of sending every utterance to an LLM and waiting.
- **A rules floor:** Claude can lower a keyword false alarm, but never below the floor once a code, payment or remote-access request has been heard.
- **The whisper policy:** silent below caution, one short sentence per new tactic, a single-slot queue, and spoken between caller sentences.
- **A deliberate legit-call demo** (the pharmacy call) to show the guardian *doesn't* cry wolf.

## Inside the product

| Piece | Tool | Why |
|---|---|---|
| Speech-to-text | Browser **Web Speech API** | Zero setup, streaming, good enough for a prototype |
| Scam judgement | **Claude API** (`claude-opus-5-5`, `@anthropic-ai/sdk`) | Reads the whole transcript and judges intent, not keywords |
| Output format | Claude **structured outputs** (`output_config.format` JSON schema) | The UI gets guaranteed fields: risk, verdict, tactics with quotes, whisper, reply |
| Latency | `effort: "low"` + prompt caching on the system prompt | It runs after every utterance, so it has to come back fast |
| Robustness | Server-side refusal fallback (`fallbacks: "default"`) | A scam transcript can trip a safety classifier. If it does, the API reruns the request on a fallback model instead of failing |
| Voices (calls + whispers) | **Microsoft neural TTS** via `msedge-tts` (free, no key), cached; browser **SpeechSynthesis** as offline fallback | Human-sounding voices. Guardian has its own calm voice (Ava), so it never sounds like the caller |
| Alert sound | Web Audio chime + vibration | Signals "this is Guardian, not the caller" before the words |

The Claude prompt lives in `src/analyze.js` (`SYSTEM`). It tells the model to judge intent rather than keywords, and to keep whispers to 12 words or fewer.
