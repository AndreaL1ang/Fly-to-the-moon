// Fly Me to the Moon: game server
// No npm install needed. Requires Node 18 or newer (for built-in fetch).
// Run with:  node server.js   then open http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');

loadEnvFile(path.join(__dirname, '.env'));

const PORT = process.env.PORT || 3000;
const PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
const KEYS = { gemini: process.env.GEMINI_API_KEY, groq: process.env.GROQ_API_KEY };
// With no key for the chosen provider, the game still runs using built-in content.
const MOCK_MODE = PROVIDER === 'mock' || !KEYS[PROVIDER];

// ---------------------------------------------------------------------------
// AI providers. Each one takes { system, prompt, image } and returns parsed JSON.
// To add a provider, write one function here and add it to the PROVIDERS map.
// ---------------------------------------------------------------------------

async function askGemini({ system, prompt, image }) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const parts = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: 'image/png', data: image } });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEYS.gemini },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 1.0 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return parseJson(text);
}

async function askGroq({ system, prompt, image }) {
  const model = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
  const userContent = image
    ? [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } },
      ]
    : prompt;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEYS.groq}` },
    body: JSON.stringify({
      model,
      temperature: 1.0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseJson(data.choices?.[0]?.message?.content || '');
}

const PROVIDERS = { gemini: askGemini, groq: askGroq };

async function askAI(request) {
  const ask = PROVIDERS[PROVIDER];
  if (!ask) throw new Error(`Unknown AI_PROVIDER "${PROVIDER}". Use gemini, groq, or mock.`);
  return ask(request);
}

// Models sometimes wrap JSON in ```fences``` or add a sentence. Dig the object out.
function parseJson(text) {
  const clean = text.replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI reply contained no JSON: ' + text.slice(0, 200));
  return JSON.parse(clean.slice(start, end + 1));
}

// ---------------------------------------------------------------------------
// Prompts. Tweak these to change the game's tone.
// ---------------------------------------------------------------------------

const TONE =
  'The game is called Fly Me to the Moon. It is playful, warm, and suitable for all ages. ' +
  'Keep writing short and punchy; players read it during a live demo.';

function characterPrompt() {
  return {
    system:
      `You are the character designer for a game. ${TONE} ` +
      'The player has drawn their protagonist, who is trying to reach the moon. ' +
      'Study the drawing closely and base everything on what you actually see in it. ' +
      'Respond with JSON only, no other text.',
    prompt:
      'Create a character from this drawing. Return exactly this JSON shape:\n' +
      '{\n' +
      '  "name": "a fun name, max 3 words",\n' +
      '  "hp": number between 50 and 150 (sturdier or bigger-looking drawings get more),\n' +
      '  "personality": "2 to 5 words",\n' +
      '  "intro": "one sentence introducing them and why they want to reach the moon",\n' +
      '  "traits": [\n' +
      '    { "name": "2-3 word trait", "kind": "strength" or "weakness",\n' +
      '      "effect": "one short sentence on how it helps or hurts on the journey",\n' +
      '      "inspiredBy": "the specific part of the drawing that inspired it" }\n' +
      '  ]\n' +
      '}\n' +
      'Give 2 or 3 traits: at least one strength and exactly one funny weakness. ' +
      'If the drawing is blank or hard to read, invent something whimsical about a mysterious scribble.',
  };
}

function eventPrompt(body) {
  const c = body.character;
  const traitList = c.traits.map((t) => `${t.name} (${t.kind}: ${t.effect})`).join('; ') || 'none';
  const past = body.history.length
    ? body.history.map((h) => `- ${h.scene} They chose "${h.choice}". ${h.outcome}`).join('\n')
    : '- Nothing yet, this is the first event.';

  return {
    system:
      `You write story events for a choose-your-path game. ${TONE} ` +
      'Respond with JSON only, no other text.',
    prompt:
      `Protagonist: ${c.name}, personality: ${c.personality}. HP: ${body.hp} of ${body.maxHp}.\n` +
      `Traits: ${traitList}\n` +
      `Current stage: ${body.stage.name} (${body.stage.blurb}). ` +
      `Event ${body.eventInStage} of ${body.eventsPerStage} in this stage.` +
      (body.isFinal ? ' This is the final event: the actual touchdown on the moon.' : '') +
      `\nWhat has happened so far:\n${past}\n\n` +
      'Write the next event. Return exactly this JSON shape:\n' +
      '{\n' +
      '  "scene": "2-3 sentences describing a new situation",\n' +
      '  "choices": [\n' +
      '    { "text": "short action, max 8 words", "trait_used": "exact trait name or null",\n' +
      '      "hp_change": integer from -35 to 15, "outcome": "1-2 sentences on what happens" }\n' +
      '  ]\n' +
      '}\n' +
      'Rules: exactly 3 choices. At least one choice must use one of the traits by its exact name. ' +
      'Choices using a strength should usually go well; choices using the weakness should backfire in a funny way. ' +
      'Make choices fit the personality. Mix risk levels, and avoid making every choice safe. ' +
      'Do not repeat situations from earlier events.',
  };
}

function endingPrompt(body) {
  const c = body.character;
  const past = body.history.map((h) => `- ${h.scene} They chose "${h.choice}". ${h.outcome}`).join('\n');
  const result =
    body.outcome === 'landed'
      ? `They reached the moon with ${body.hp} of ${body.maxHp} HP left.`
      : 'They ran out of HP before reaching the moon.';

  return {
    system: `You write the end-of-game mission report. ${TONE} Respond with JSON only, no other text.`,
    prompt:
      `Protagonist: ${c.name}, personality: ${c.personality}. ${result}\n` +
      `The journey:\n${past}\n\n` +
      'Return exactly this JSON shape:\n' +
      '{ "stamp": "2-4 word verdict", "title": "a short headline", ' +
      '"report": "3-4 sentences retelling the trip, calling back to specific moments" }\n' +
      (body.outcome === 'landed'
        ? 'Make it triumphant.'
        : 'Make the failure funny and gentle, and end on a hopeful note about trying again.'),
  };
}

// ---------------------------------------------------------------------------
// Validation. Never trust AI output blindly: clamp numbers, trim text, fix shapes.
// ---------------------------------------------------------------------------

const str = (v, max, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);
const clamp = (n, lo, hi, fallback) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Math.round(Number(n)))) : fallback);

function cleanCharacter(raw) {
  const traits = (Array.isArray(raw.traits) ? raw.traits : []).slice(0, 3).map((t) => ({
    name: str(t.name, 40, 'Mystery Trait'),
    kind: t.kind === 'weakness' ? 'weakness' : 'strength',
    effect: str(t.effect, 140),
    inspiredBy: str(t.inspiredBy, 100),
  }));
  return {
    name: str(raw.name, 40, 'The Doodle'),
    hp: clamp(raw.hp, 50, 150, 100),
    personality: str(raw.personality, 60, 'curious'),
    intro: str(raw.intro, 240),
    traits,
  };
}

function cleanEvent(raw, character) {
  const traitNames = character.traits.map((t) => t.name);
  const choices = (Array.isArray(raw.choices) ? raw.choices : []).slice(0, 3).map((ch) => ({
    text: str(ch.text, 80, 'Keep going'),
    trait_used: traitNames.includes(ch.trait_used) ? ch.trait_used : null,
    hp_change: clamp(ch.hp_change, -35, 15, 0),
    outcome: str(ch.outcome, 300, 'You press on.'),
  }));
  if (choices.length < 2 || !str(raw.scene, 10)) throw new Error('AI event was missing pieces');
  return { scene: str(raw.scene, 400), choices };
}

function cleanEnding(raw, outcome) {
  return {
    stamp: str(raw.stamp, 30, outcome === 'landed' ? 'Landed' : 'Lost in space'),
    title: str(raw.title, 80, 'Mission report'),
    report: str(raw.report, 700),
  };
}

// ---------------------------------------------------------------------------
// Built-in content, used in demo mode and whenever an AI call fails.
// ---------------------------------------------------------------------------

const MOCK_CHARACTERS = [
  {
    name: 'Captain Scribbles', hp: 90, personality: 'brave but easily distracted',
    intro: 'Captain Scribbles has stared at the moon every night and finally decided to say hello in person.',
    traits: [
      { name: 'Big Heart', kind: 'strength', effect: 'Makes friends with anything, even space rocks.', inspiredBy: 'the round shape in the middle' },
      { name: 'Quick Thinker', kind: 'strength', effect: 'Great at improvising fixes under pressure.', inspiredBy: 'the confident lines' },
      { name: 'Wobbly Legs', kind: 'weakness', effect: 'Anything involving balance goes badly.', inspiredBy: 'the uneven lines at the bottom' },
    ],
  },
  {
    name: 'Sir Loopsalot', hp: 120, personality: 'dramatic and fearless',
    intro: 'Sir Loopsalot heard the moon is made of cheese and intends to verify this personally.',
    traits: [
      { name: 'Iron Grip', kind: 'strength', effect: 'Holds on tight when things get bumpy.', inspiredBy: 'the thick outlines' },
      { name: 'Show Off', kind: 'weakness', effect: 'Cannot resist a risky stunt.', inspiredBy: 'the extra flourishes' },
    ],
  },
];

const MOCK_EVENTS = {
  launch: [
    { scene: 'The countdown reaches three and the rocket hiccups. A loose bolt is rattling somewhere near the engines.',
      choices: [
        { text: 'Fix it with {trait}', trait: true, hp_change: 5, outcome: 'It works better than anyone expected. The engines purr like a happy cat.' },
        { text: 'Give the rocket a kick', hp_change: -15, outcome: 'The rattling stops. The pain in your foot does not.' },
        { text: 'Launch anyway', hp_change: -10, outcome: 'You lift off with a worrying clank that follows you all the way up.' },
      ] },
    { scene: 'A seagull has built a nest in the cockpit and refuses to leave. Launch is in ten seconds.',
      choices: [
        { text: 'Win it over with {trait}', trait: true, hp_change: 5, outcome: 'The seagull salutes and flies off. You have a friend on Earth now.' },
        { text: 'Offer it your sandwich', hp_change: 0, outcome: 'Deal struck. You are hungry, but the cockpit is yours.' },
        { text: 'Shoo it with a map', hp_change: -15, outcome: 'The seagull wins. You launch with a copilot who pecks.' },
      ] },
    { scene: "Mission control's radio is stuck on full volume. Every instruction is a deafening roar.",
      choices: [
        { text: 'Handle it with {trait}', trait: true, hp_change: 5, outcome: 'You get the volume down and hear a small cheer from the control room.' },
        { text: 'Launch by guessing', hp_change: -10, outcome: 'You press the big red button. It was the right one. Mostly.' },
        { text: 'Stuff socks in the speaker', hp_change: 0, outcome: 'Quieter, and now the cockpit smells of socks.' },
      ] },
  ],
  sky: [
    { scene: 'A thundercloud the size of a city blocks your path. It rumbles in a way that sounds personal.',
      choices: [
        { text: 'Punch straight through', hp_change: -20, outcome: 'You come out the other side, crackling with static and slightly singed.' },
        { text: 'Take the long way around', hp_change: -5, outcome: 'Slow but safe. The cloud grumbles as you pass.' },
        { text: 'Rely on {trait}', trait: true, hp_change: 5, outcome: 'You slip past the storm and feel pleased with yourself.' },
      ] },
    { scene: 'A passenger jet pulls up alongside you. Everyone inside is pressed to the windows, waving.',
      choices: [
        { text: 'Wave back', hp_change: 10, outcome: 'The pilot flashes the lights. You feel wonderful.' },
        { text: 'Show off with a loop', hp_change: -15, outcome: 'Impressive. Also extremely dizzying.' },
        { text: 'Impress them with {trait}', trait: true, hp_change: 5, outcome: 'The passengers burst into applause you can somehow hear.' },
      ] },
    { scene: 'The air gets thin and cold. Frost creeps across your window until you can barely see.',
      choices: [
        { text: 'Breathe on the glass', hp_change: -5, outcome: 'You clear a tiny peephole. It will have to do.' },
        { text: 'Solve it with {trait}', trait: true, hp_change: 5, outcome: 'The frost melts away and the stars appear, sharp and bright.' },
        { text: 'Fly blind and hope', hp_change: -20, outcome: 'You bump into something. You decide not to find out what.' },
      ] },
  ],
  space: [
    { scene: 'An asteroid field tumbles ahead, rocks spinning in every direction.',
      choices: [
        { text: 'Weave through with {trait}', trait: true, hp_change: 0, outcome: 'You thread every gap like it was nothing.' },
        { text: 'Full speed, eyes closed', hp_change: -30, outcome: 'You make it. Your rocket now has a lot of new dents.' },
        { text: 'Hitch a ride on a big rock', hp_change: -5, outcome: 'Slow, bumpy, and weirdly relaxing.' },
      ] },
    { scene: 'A lonely old satellite drifts over and beeps hopefully. It clearly wants to chat.',
      choices: [
        { text: 'Keep it company', hp_change: 10, outcome: 'It shares the best route to the moon. Friendship pays off.' },
        { text: 'Ignore it and fly on', hp_change: -5, outcome: 'It follows you for a while, beeping sadly.' },
        { text: 'Connect using {trait}', trait: true, hp_change: 5, outcome: 'The satellite plays you a little song in beeps.' },
      ] },
    { scene: 'Zero gravity kicks in and every snack you packed goes floating around the cabin.',
      choices: [
        { text: 'Catch them all', hp_change: 10, outcome: 'A floating feast. You feel refueled.' },
        { text: 'Use {trait}', trait: true, hp_change: 5, outcome: 'You round up the snacks in record time.' },
        { text: 'Let them float', hp_change: -10, outcome: 'A cracker lodges itself in the controls.' },
      ] },
  ],
  landing: [
    { scene: 'The moon fills your window. It is covered in craters and you need somewhere flat to land.',
      choices: [
        { text: 'Aim for the biggest crater', hp_change: -15, outcome: 'Turns out crater walls are steep. You slide in sideways.' },
        { text: 'Pick a spot with {trait}', trait: true, hp_change: 5, outcome: 'You find a perfectly flat patch. Textbook.' },
        { text: 'Circle once to look around', hp_change: -5, outcome: 'Fuel runs low, but you spot a safe landing zone.' },
      ] },
    { scene: 'The landing legs will not unfold. The ground is coming up fast.',
      choices: [
        { text: 'Kick the lever hard', hp_change: -10, outcome: 'Two legs pop out. Two is fine. Probably.' },
        { text: 'Trust your {trait}', trait: true, hp_change: 5, outcome: 'The legs unfold with a satisfying click just in time.' },
        { text: 'Land on your belly', hp_change: -25, outcome: 'A long, dusty skid ends in a gentle bump.' },
      ] },
  ],
};

function mockCharacter() {
  const c = structuredClone(MOCK_CHARACTERS[Math.floor(Math.random() * MOCK_CHARACTERS.length)]);
  // The built-in characters never actually saw the drawing, so don't pretend they did
  c.traits.forEach((t) => (t.inspiredBy = ''));
  return c;
}

function mockEvent(body) {
  const pool = MOCK_EVENTS[body.stage.id] || MOCK_EVENTS.space;
  const seen = new Set(body.history.map((h) => h.scene));
  const fresh = pool.filter((e) => !seen.has(e.scene));
  const pick = structuredClone((fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length || pool.length))]);
  const strengths = body.character.traits.filter((t) => t.kind === 'strength');
  const trait = strengths[Math.floor(Math.random() * strengths.length)];

  pick.choices = pick.choices.map((ch) => {
    if (!ch.trait) return { ...ch, trait_used: null };
    if (!trait) return { ...ch, text: 'Trust your gut', trait_used: null };
    return { ...ch, text: ch.text.replace('{trait}', trait.name), trait_used: trait.name };
  });
  pick.choices.forEach((ch) => delete ch.trait);
  return pick;
}

function mockEnding(body) {
  const name = body.character.name;
  return body.outcome === 'landed'
    ? { stamp: 'Landed', title: `${name} made it to the moon`,
        report: `Against the odds and a few questionable decisions, ${name} touched down on the moon with ${body.hp} HP to spare. The footprints are still there.` }
    : { stamp: 'Lost in the stars', title: `${name} took the scenic route`,
        report: `${name} ran out of steam somewhere between Earth and the moon and is now drifting peacefully among the stars. Mission control says the next launch window opens right away.` };
}

// ---------------------------------------------------------------------------
// API routes. Every route falls back to built-in content, so the game never breaks mid-demo.
// ---------------------------------------------------------------------------

async function withFallback(label, aiCall, fallback) {
  if (MOCK_MODE) return { ...fallback(), demo: true };
  try {
    return await aiCall();
  } catch (err) {
    console.error(`[${label}] AI call failed, using built-in content:`, err.message);
    return { ...fallback(), fallback: true };
  }
}

const routes = {
  'GET /api/status': async () => ({ provider: PROVIDER, demo: MOCK_MODE }),

  'POST /api/character': async (body) =>
    withFallback(
      'character',
      async () => {
        if (!body.image) throw new Error('No image sent');
        return cleanCharacter(await askAI({ ...characterPrompt(), image: body.image }));
      },
      mockCharacter
    ),

  'POST /api/event': async (body) =>
    withFallback(
      'event',
      async () => cleanEvent(await askAI(eventPrompt(body)), body.character),
      () => mockEvent(body)
    ),

  'POST /api/ending': async (body) =>
    withFallback(
      'ending',
      async () => cleanEnding(await askAI(endingPrompt(body)), body.outcome),
      () => mockEnding(body)
    ),
};

// ---------------------------------------------------------------------------
// Plain HTTP server: serves /public and the routes above.
// ---------------------------------------------------------------------------

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const PUBLIC_DIR = path.join(__dirname, 'public');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5_000_000) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = routes[`${req.method} ${url.pathname}`];

  if (route) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      sendJson(res, 200, await route(body));
    } catch (err) {
      console.error(err);
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // Static files
  const filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.readFile(filePath, (err, content) => {
    if (err) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Fly Me to the Moon is running at http://localhost:${PORT}`);
  console.log(
    MOCK_MODE
      ? `  Demo mode: no API key found for "${PROVIDER}", so events come from the built-in list.\n  Add a key to .env to turn on the AI.\n`
      : `  AI provider: ${PROVIDER}\n`
  );
});

// Tiny .env reader so you don't need the dotenv package.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (match && !line.trim().startsWith('#') && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}
