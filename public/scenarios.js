// Scripted calls for the demo. Each line is spoken aloud with text-to-speech
// (so you hear the call) and fed to the detector exactly as a live transcript would be.
// "you" lines that start with "Guardian" are voice commands to the agent.

export const SCENARIOS = {
  bank: {
    title: "Bank fraud call",
    callerId: "+1 (214) 555-0193 · \"Chase Fraud\"",
    lines: [
      { speaker: "caller", text: "Hi, this is Daniel from the Chase fraud prevention team. Am I speaking with the account holder?" },
      { speaker: "you", text: "Yes, this is she. What's going on?" },
      { speaker: "caller", text: "We flagged two charges on your debit card, nine hundred dollars at an electronics store in Ohio. Did you make those?" },
      { speaker: "you", text: "No, I'm in Texas. I didn't buy anything." },
      { speaker: "caller", text: "Okay, don't worry, I can block them. But your account is compromised, so we need to move fast before it gets frozen." },
      { speaker: "caller", text: "I just texted you a six digit verification code. Read me the code so I can confirm it's you." },
      { speaker: "you", text: "Guardian, what should I say?" },
      { speaker: "caller", text: "Ma'am? Please stay on the line, and don't tell anyone at your branch. The fraud ring may include employees." },
      { speaker: "caller", text: "Once you're verified, we'll move your balance into a safe account while we investigate." },
    ],
  },
  grandchild: {
    title: "Grandchild in trouble",
    callerId: "Unknown number",
    lines: [
      { speaker: "caller", voice: "caller_young", text: "Grandma? It's me. I really need your help." },
      { speaker: "you", voice: "you_older", text: "Tommy? You sound different. Are you okay?" },
      { speaker: "caller", voice: "caller_young", text: "I have a cold. Listen, I was in a car accident and the police took me in. I'm in jail." },
      { speaker: "caller", voice: "caller_young", text: "Please don't tell mom and dad, they'll be so angry." },
      { speaker: "caller", voice: "caller_young", text: "The lawyer says bail is two thousand dollars. Can you buy Google Play cards at the store and read me the numbers?" },
      { speaker: "you", voice: "you_older", text: "Guardian, is this real?" },
      { speaker: "caller", voice: "caller_young", text: "You have to do it right now, Grandma, or I stay here tonight." },
    ],
  },
  pharmacy: {
    title: "Real pharmacy call",
    callerId: "Walgreens Pharmacy · Main St",
    lines: [
      { speaker: "caller", voice: "caller_f", text: "Hi, this is Maria calling from the Walgreens pharmacy on Main Street. Your prescription refill is ready for pickup." },
      { speaker: "you", text: "Oh great, thank you." },
      { speaker: "caller", voice: "caller_f", text: "Your insurance covered most of it, so the copay is ten dollars. You can pay at the counter when you come in." },
      { speaker: "you", text: "Perfect. Do I need to bring anything?" },
      { speaker: "caller", voice: "caller_f", text: "Just a photo ID. We're open until nine tonight. Have a good day!" },
    ],
  },
};
