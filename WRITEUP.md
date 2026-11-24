# Call Guardian: a voice that has your back during a scam call

**Track:** Security / Real-Time Assistance

## What I built

Call Guardian listens to a phone call alongside you. It transcribes the call live and watches for the tactics scammers use: asking for one-time codes, gift cards or crypto, threats and deadlines, impersonating a bank or agency, demanding secrecy, asking to install remote-access apps, and fake family emergencies. When the risk crosses a threshold, it **whispers one short sentence into your ear** between the caller's sentences, after a soft chime. Example: *"Likely scam. Never share a code. Your bank will not ask for it."* You can also ask it quietly, mid-call, *"Guardian, what should I say?"* It gives you a line to say back.

Detection has two layers. A rules engine in the browser fires instantly and works offline. Claude reads the whole transcript after each line and judges intent. It catches paraphrases and lowers keyword false alarms, but it can never clear a call once a code, payment or remote-access request has been heard.

## Who it's for

People who get targeted most and are least able to step out of the moment to verify: older adults, recent immigrants facing fake "immigration officer" calls, and anyone caught off guard. In 2024 the US FTC recorded about $12.5B in reported fraud losses, and phone calls had the highest per-person losses of any contact method.

## Why voice is the right interface

A scam happens **in a voice channel, in real time, under pressure.** At the key moment, the victim has the phone at their ear. Their eyes are off the screen, and the caller is working hard to keep their attention. A notification on the screen would go unseen, and a "scam score" after the call is too late. The warning has to reach the same channel the attack is using, at the moment it matters, in a voice that's clearly not the caller's.

Emotion and pacing matter too. Scams work by creating urgency, so a calm second voice saying *"They're rushing you. You have time to hang up"* is a direct counter to the attack. Talking back to the guardian also takes no hands and no unlocking.

## What I'd do next

1. **Tap the real call audio.** Use Android's call-screening and in-call audio APIs, or a carrier-side integration, with on-device STT and two call legs for exact speaker labels. Whisper through the earpiece only, so the caller never hears it.
2. **Voice-clone and spoof signals.** Add synthetic-speech detection on the caller leg, and caller-ID and reputation data (Hiya's core asset) as a prior before the first word is spoken.
3. **An eval set.** Build labelled scam and legit transcripts, including hard negatives such as real banks verifying identity, to tune thresholds and measure false-alarm rate, the metric that decides whether people keep it switched on.
4. **Trusted-contact escalation.** Optionally text a family member when a likely scam call runs past a time limit or the user starts reading out numbers.
5. **Multilingual support** and a configurable whisper voice, speed and volume, tested with older users.
