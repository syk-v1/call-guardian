// Free neural voices via Microsoft Edge's Read Aloud service (msedge-tts, no key).
// Results are cached in memory and on disk, so repeated demo lines and whispers
// play instantly. If the service is unreachable the browser falls back to its
// built-in speechSynthesis voices.

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Roles the client may ask for. Whitelisted so the client can't pick arbitrary voices.
export const VOICES = {
  caller: { name: "en-US-AndrewNeural", rate: "+6%", pitch: "-2Hz" },
  caller_young: { name: "en-US-BrianNeural", rate: "+10%", pitch: "+0Hz" },
  caller_f: { name: "en-US-MichelleNeural", rate: "+4%", pitch: "+0Hz" },
  you: { name: "en-US-EmmaNeural", rate: "+0%", pitch: "+0Hz" },
  you_older: { name: "en-US-JennyNeural", rate: "-6%", pitch: "-4Hz" },
  guardian: { name: "en-US-AvaNeural", rate: "+4%", pitch: "+0Hz" },
};

const memory = new Map();
let cacheDir;

function xmlEscape(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
}

export function initTtsCache(dir) {
  cacheDir = dir;
  return mkdir(dir, { recursive: true });
}

/** @returns {Promise<Buffer>} MP3 audio */
export async function synthesize(text, role) {
  const voice = VOICES[role];
  if (!voice) throw new Error(`unknown voice role: ${role}`);
  const clean = String(text).replace(/\s+/g, " ").trim().slice(0, 400);
  if (!clean) throw new Error("empty text");

  const key = createHash("sha1").update(`${voice.name}|${voice.rate}|${voice.pitch}|${clean}`).digest("hex");
  if (memory.has(key)) return memory.get(key);

  const file = cacheDir && path.join(cacheDir, `${key}.mp3`);
  const job = (async () => {
    if (file) {
      try {
        return await readFile(file);
      } catch {
        /* not cached yet */
      }
    }
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(voice.name, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(xmlEscape(clean), { rate: voice.rate, pitch: voice.pitch });
      const chunks = [];
      await new Promise((resolve, reject) => {
        audioStream.on("data", (d) => chunks.push(d));
        audioStream.on("close", resolve);
        audioStream.on("error", reject);
      });
      const audio = Buffer.concat(chunks);
      if (audio.length === 0) throw new Error("TTS returned no audio");
      if (file) writeFile(file, audio).catch(() => {});
      return audio;
    } finally {
      tts.close();
    }
  })();

  memory.set(key, job);
  job.catch(() => memory.delete(key));
  return job;
}
