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

// The five things a trait can be about. Every level reads one or two of them,
// so a trait is never just a label: it changes how the level actually plays.
const POWERS = ['steady', 'agile', 'clever', 'lucky', 'heart'];
const POWER_HELP = {
  steady: 'nerves and fine control (valve timing, docking, landing burns)',
  agile: 'reflexes and handling (dodging storms and asteroids)',
  clever: 'reading a situation early (spotting gaps and incoming notes)',
  lucky: 'plain good fortune (second chances, extra pickups)',
  heart: 'warmth and connection (getting along with whatever lives out there)',
};

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
  const powerLines = POWERS.map((p) => `  - ${p}: ${POWER_HELP[p]}`).join('\n');
  return {
    system:
      `You are the character designer for a game. ${TONE} ` +
      'The player has drawn their protagonist, who is about to fly to the moon. ' +
      'Study the drawing closely and base everything on what you actually see in it. ' +
      'Respond with JSON only, no other text.',
    prompt:
      'Create a character from this drawing. Return exactly this JSON shape:\n' +
      '{\n' +
      '  "name": "a fun name, max 3 words",\n' +
      '  "hp": number between 50 and 150 (sturdier or bigger-looking drawings get more),\n' +
      '  "personality": "2 to 5 words",\n' +
      '  "intro": "one sentence introducing them",\n' +
      '  "reason": {\n' +
      '    "keepsake": "a small object they are carrying, 1-4 words",\n' +
      '    "goal": "what they will do on the moon with it, max 9 words",\n' +
      '    "line": "one heartfelt or funny sentence, in their own voice, on why the moon and why now"\n' +
      '  },\n' +
      '  "traits": [\n' +
      '    { "name": "2-3 word trait", "kind": "strength" or "weakness",\n' +
      '      "power": one of steady, agile, clever, lucky, heart,\n' +
      '      "effect": "one short sentence on how it helps or hurts in flight",\n' +
      '      "inspiredBy": "the specific part of the drawing that inspired it" }\n' +
      '  ]\n' +
      '}\n' +
      'The reason must be personal and specific: a promise, a missing friend, a bet, a letter, ' +
      'a grandmother who pointed at the sky. Never just "for adventure".\n' +
      'The "power" field decides what the trait actually does in play:\n' +
      powerLines + '\n' +
      'Give 2 or 3 traits with different powers: at least one strength and exactly one funny weakness. ' +
      'If the drawing is blank or hard to read, invent something whimsical about a mysterious scribble.',
  };
}

// After each level the character talks to the player about it. The game has
// already decided what happened; the AI only puts it into the character's mouth,
// so the words can never contradict what the player's hands did.
const STAGE_BRIEF = {
  liftoff: "lighting the rocket's three engine stages by timing a sweeping spark meter",
  sky: 'flying up through storm clouds while the player steered you and grabbed stars',
  whale: 'singing back to a giant space whale, note for note, as the player hit each note',
  refuel: 'catching fuel cans dropped by a space station while dodging falling junk',
  rocks: 'zapping and dodging asteroids on the way to the moon',
  lander: 'the final landing on the moon in a tiny lander',
};

function beatPrompt(body) {
  const c = body.character;
  const traits = (c.traits || []).map((t) => `${t.name} (${t.kind}, ${t.power})`).join('; ') || 'none';
  const facts = (body.facts || []).map((f) => `- ${f}`).join('\n') || '- nothing notable';
  const band = body.score >= 80 ? 'went great' : body.score >= 50 ? 'was messy but okay' : 'went badly';
  return {
    system:
      `You are a drawing that has just come to life. The player drew you, and now they are steering you to the moon. ${TONE} ` +
      'Respond with JSON only.',
    prompt:
      `You are ${c.name}, ${c.personality}. Your traits: ${traits}.\n` +
      `Why you want to reach the moon: ${c.reason?.line || 'you never said.'}\n` +
      `Level just played: ${STAGE_BRIEF[body.stage] || body.stage}.\n` +
      `The player's steering ${band} (score ${body.score} of 100). Exactly what happened:\n${facts}\n\n` +
      'Talk straight to the player, calling them "you", about what they just did, in your own voice. ' +
      'Stay strictly true to the facts above. Be warm even when it went badly. Mention one of your traits if it fits. ' +
      'Return exactly this JSON shape:\n' +
      '{ "headline": "2-4 word arcade shout, like NICE FLYING! or MY POOR HEAD", ' +
      '"outcome": "1-2 short sentences you say to the player" }',
  };
}

function repairPrompt(body) {
  const past = (body.history || []).map((h) => `- ${h.outcome}`).join('\n') || '- The trip has just begun.';
  return {
    system:
      `You are a drawing that has come to life, flying to the moon, and the player just drew you a gadget to fix an emergency. ${TONE} ` +
      'Study what is actually visible in the image. Reward practical ideas, but make strange ideas funny rather than simply rejecting them. ' +
      'Respond with JSON only, no other text.',
    prompt:
      `Emergency: ${body.challenge.prompt}\n` +
      `You are ${body.character.name}, ${body.character.personality}. HP: ${body.hp} of ${body.maxHp}.\n` +
      `Recent trip: ${past}\n\n` +
      'Identify the main thing the player drew and decide how well it solves the emergency. ' +
      'A sensible tool such as a wrench should work well. A surprising object such as a banana should create a specific funny result, and may still help a little. ' +
      'Return exactly this JSON shape:\n' +
      '{ "object": "what the drawing looks like, max 5 words", "score": integer 0 to 100, ' +
      '"hp_change": integer -20 to 20, "outcome": "2 short sentences you say to the player about how their gadget works or backfires" }',
  };
}

// ---------------------------------------------------------------------------
// Validation. Never trust AI output blindly: clamp numbers, trim text, fix shapes.
// ---------------------------------------------------------------------------

const str = (v, max, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);
const clamp = (n, lo, hi, fallback) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Math.round(Number(n)))) : fallback);

function cleanCharacter(raw) {
  const traits = (Array.isArray(raw.traits) ? raw.traits : []).slice(0, 3).map((t, i) => ({
    name: str(t.name, 40, 'Mystery Trait'),
    kind: t.kind === 'weakness' ? 'weakness' : 'strength',
    power: POWERS.includes(t.power) ? t.power : POWERS[i % POWERS.length],
    effect: str(t.effect, 140),
    inspiredBy: str(t.inspiredBy, 100),
  }));
  const reason = raw.reason || {};
  return {
    name: str(raw.name, 40, 'The Doodle'),
    hp: clamp(raw.hp, 50, 150, 100),
    personality: str(raw.personality, 60, 'curious'),
    intro: str(raw.intro, 240),
    reason: {
      keepsake: str(reason.keepsake, 40, 'a folded paper star'),
      goal: str(reason.goal, 70, 'leave it somewhere the sky can see'),
      line: str(reason.line, 240, 'Somebody up there is owed a visit, and it has waited long enough.'),
    },
    traits,
  };
}

function cleanBeat(raw) {
  return {
    headline: str(raw.headline, 60, 'That happened'),
    outcome: str(raw.outcome, 320, 'The ship keeps going, which is the main thing.'),
  };
}


function cleanRepair(raw) {
  return {
    object: str(raw.object, 60, 'a mysterious invention'),
    score: clamp(raw.score, 0, 100, 50),
    hp_change: clamp(raw.hp_change, -20, 20, 0),
    outcome: str(raw.outcome, 320, 'It rattles, glows, and somehow keeps the mission moving.'),
  };
}

// ---------------------------------------------------------------------------
// Built-in content, used in demo mode and whenever an AI call fails.
// ---------------------------------------------------------------------------

const MOCK_CHARACTERS = [
  {
    name: 'Captain Scribbles', hp: 90, personality: 'brave but easily distracted',
    intro: 'Captain Scribbles has stared at the moon every night for eleven years and has finally had enough of waving.',
    reason: {
      keepsake: 'a chewed dog collar',
      goal: 'bury it where the Earth never sets',
      line: 'Rocket the dog watched the moon with me every night, and I promised her a proper view one day.',
    },
    traits: [
      { name: 'Big Heart', kind: 'strength', power: 'heart', effect: 'Anything alive out there ends up on your side.', inspiredBy: 'the round shape in the middle' },
      { name: 'Quick Hands', kind: 'strength', power: 'agile', effect: 'Dodges what the eyes only just noticed.', inspiredBy: 'the confident lines' },
      { name: 'Wobbly Legs', kind: 'weakness', power: 'steady', effect: 'Anything needing a held nerve goes sideways.', inspiredBy: 'the uneven lines at the bottom' },
    ],
  },
  {
    name: 'Sir Loopsalot', hp: 120, personality: 'dramatic and fearless',
    intro: 'Sir Loopsalot has announced the voyage to everyone in town, twice, including the postman.',
    reason: {
      keepsake: "a grandmother's brass button",
      goal: 'finish the dare she set him at seven',
      line: 'Gran pointed at the moon and said "go on then", and I have been going on ever since.',
    },
    traits: [
      { name: 'Iron Grip', kind: 'strength', power: 'steady', effect: 'Holds a line however hard it shakes.', inspiredBy: 'the thick outlines' },
      { name: 'Reads the Room', kind: 'strength', power: 'clever', effect: 'Spots the gap before it opens.', inspiredBy: 'the careful spacing' },
      { name: 'Show Off', kind: 'weakness', power: 'agile', effect: 'Turns a simple dodge into a flourish, badly.', inspiredBy: 'the extra flourishes' },
    ],
  },
];

// In the character's own voice, talking to the player.
const MOCK_BEATS = {
  liftoff: {
    high: { headline: 'WE HAVE LIFTOFF!', outcome: 'Three perfect sparks! You made that look easy, and my stomach is still on the launch pad.' },
    mid: { headline: 'UP WE GO-ISH', outcome: 'One spark fizzled, but you got us up anyway. I am choosing to call that style.' },
    low: { headline: 'BUMPY START!', outcome: 'The rocket coughed the whole way up, but we are off the ground! I believe in you. Mostly.' },
  },
  sky: {
    high: { headline: 'NICE FLYING!', outcome: 'You slid me right between those grumpy clouds. I did not even get damp!' },
    mid: { headline: 'A LITTLE SOGGY', outcome: 'A couple of clouds got me square in the face. Still, you kept us climbing!' },
    low: { headline: 'MY POOR HEAD', outcome: 'I think I hugged every storm cloud up there. Can we steer AROUND them next time?' },
  },
  whale: {
    high: { headline: 'WHAT A DUET!', outcome: 'You hit every note and the whale sang with us! I think we made a friend the size of a town.' },
    mid: { headline: 'SORT OF IN TUNE', outcome: 'We lost a few notes, but the whale was polite about it and let us pass.' },
    low: { headline: 'OOPS, OFF-KEY', outcome: 'We sang all the wrong notes and the whale swam off in a huff. At least it moved out of the way!' },
  },
  refuel: {
    high: { headline: 'TANKS FULL!', outcome: 'You caught every can like a pro. I feel brand new!' },
    mid: { headline: 'GOOD ENOUGH!', outcome: 'We got some fuel and only a little junk on my head. I will take it.' },
    low: { headline: 'JUNK ON MY HEAD', outcome: 'That was mostly wrenches, and one of them was very pointy. We can still make it... I think.' },
  },
  rocks: {
    high: { headline: 'ZAP ZAP ZAP!', outcome: 'You blasted a road straight through those rocks! Not one scratch on me.' },
    mid: { headline: 'A FEW BONKS', outcome: 'Some rocks bonked me, but you zapped plenty more. The moon is so close now!' },
    low: { headline: 'SO MANY ROCKS', outcome: 'I got bonked a lot. Like, a LOT. But look — the moon is right there!' },
  },
  lander: {
    high: { headline: 'FEATHER SOFT!', outcome: 'You set us down so gently the moon dust did not even notice. We are HERE!' },
    mid: { headline: 'BUMP! WE MADE IT', outcome: 'A little bounce, a little wobble, but my feet are on the moon!' },
    low: { headline: 'CRUNCH LANDING', outcome: 'That was more of a skid than a landing, but we are down! We are really down!' },
  },
};

// Plain deep copy, so the built-in content also works on older Node.
const copy = (v) => JSON.parse(JSON.stringify(v));

function mockCharacter() {
  const c = copy(MOCK_CHARACTERS[Math.floor(Math.random() * MOCK_CHARACTERS.length)]);
  // The built-in characters never actually saw the drawing, so don't pretend they did
  c.traits.forEach((t) => (t.inspiredBy = ''));
  return c;
}

function mockBeat(body) {
  const set = MOCK_BEATS[body.stage] || MOCK_BEATS.storm;
  return copy(body.score >= 80 ? set.high : body.score >= 50 ? set.mid : set.low);
}

function mockRepair(body) {
  return body.challenge?.id === 'landing'
    ? { object: 'a moon-pointing doodad', score: 72, hp_change: 8,
        outcome: 'Ooh, it points straight at the flattest patch of moon! I have no idea how it works, and I love it.' }
    : { object: 'a suspicious space tool', score: 68, hp_change: 6,
        outcome: 'You wedged it right into the engine and the sparks stopped! It hums the birthday song now, but it works.' };
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

  // Narration for a level the player has already played. The score and the
  // facts come from the game, not the model, so the story always matches play.
  'POST /api/beat': async (body) =>
    withFallback(
      'beat',
      async () => {
        if (!body.character || !body.stage) throw new Error('Beat context missing');
        return cleanBeat(await askAI(beatPrompt(body)));
      },
      () => mockBeat(body)
    ),

  'POST /api/repair': async (body) =>
    withFallback(
      'repair',
      async () => {
        if (!body.image) throw new Error('No repair image sent');
        if (!body.challenge || !body.character) throw new Error('Repair context missing');
        return cleanRepair(await askAI({ ...repairPrompt(body), image: body.image }));
      },
      () => mockRepair(body)
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
      ? `  Demo mode: no API key found for "${PROVIDER}", so characters and flight logs come from the built-in list.\n  Add a key to .env to turn on the AI.\n`
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
