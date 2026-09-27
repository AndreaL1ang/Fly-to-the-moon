// Draw Me to the Moon: game server
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
// AI providers. Repair requests can include before/after images so the model
// judges the player's new marks instead of re-interpreting the whole character.
// To add a provider, write one function here and add it to the PROVIDERS map.
// ---------------------------------------------------------------------------

async function askGemini({ system, prompt, image, beforeImage }) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const parts = [];
  if (beforeImage) {
    parts.push({ text: 'BEFORE: the character before the player added an upgrade.' });
    parts.push({ inline_data: { mime_type: 'image/png', data: beforeImage } });
    parts.push({ text: 'AFTER: the character with the player\'s new upgrade drawn on it.' });
  }
  if (image) parts.push({ inline_data: { mime_type: 'image/png', data: image } });
  parts.push({ text: prompt });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEYS.gemini },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 1.0,
          // These game responses are small, playful JSON objects. Deep reasoning
          // adds several seconds without improving the result.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return parseJson(text);
}

async function askGroq({ system, prompt, image, beforeImage }) {
  const model = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
  const userContent = image
    ? [
        ...(beforeImage ? [
          { type: 'text', text: 'BEFORE: the character before the player added an upgrade.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${beforeImage}` } },
          { type: 'text', text: 'AFTER: the character with the player\'s new upgrade drawn on it.' },
        ] : []),
        { type: 'image_url', image_url: { url: `data:image/png;base64,${image}` } },
        { type: 'text', text: prompt },
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
  try {
    return await ask(request);
  } catch (err) {
    // Free tiers are rate limited (429) or briefly overloaded (503). Retry once,
    // but keep the pause short so the game can use its built-in fallback quickly.
    const busy = / (429|503):/.exec(err.message);
    if (!busy) throw err;
    const hinted = /try again in ([\d.]+)s/i.exec(err.message);
    const waitMs = Math.min(2500, hinted ? Number(hinted[1]) * 1000 + 250 : 1000);
    console.log(`  Provider busy (${busy[1]}), retrying in ${Math.round(waitMs / 1000)}s…`);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return ask(request);
  }
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
  'The game is called Draw Me to the Moon. Use very simple words and tiny sentences. ' +
  'Be warm, goofy, and specific. Prefer bonks, wobbles, snacks, odd noises, and silly comparisons. ' +
  'Never sound poetic, formal, epic, or like an instruction manual. Keep every line quick to read.';

function characterPrompt() {
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
      '  }\n' +
      '}\n' +
      'The reason must be personal and specific: a promise, a missing friend, a bet, a letter, ' +
      'a grandmother who pointed at the sky. Never just "for adventure".\n' +
      'If the drawing is blank or hard to read, invent something whimsical about a mysterious scribble.',
  };
}

// After each level the character talks to the player about it. The game has
// already decided what happened; the AI only puts it into the character's mouth,
// so the words can never contradict what the player's hands did.
// `n` holds this character's themed names for the level (see themeNames in game.js).
function stageBrief(stage, n) {
  const x = n || {};
  const briefs = {
    wobble: `balancing ${x.vehicle || 'the rocket'} while it wobbled away from Earth`,
    orbit: 'flying along the route the player drew through planets and star rings',
    whale: `singing back to ${x.singer || 'a giant space whale'}, note for note, as the player hit each note`,
  };
  return briefs[stage] || stage;
}

function beatPrompt(body) {
  const c = body.character;
  const facts = (body.facts || []).map((f) => `- ${f}`).join('\n') || '- nothing notable';
  const band = body.score >= 80 ? 'went great' : body.score >= 50 ? 'was messy but okay' : 'went badly';
  return {
    system:
      `You are a drawing that has just come to life. The player drew you, and now they are steering you to the moon. ${TONE} ` +
      'Respond with JSON only.',
    prompt:
      `You are ${c.name}, ${c.personality}.\n` +
      `Why you want to reach the moon: ${c.reason?.line || 'you never said.'}\n` +
      `Level just played: ${stageBrief(body.stage, body.names)}.\n` +
      `The player's steering ${band} (score ${body.score} of 100). Exactly what happened:\n${facts}\n\n` +
      'Talk to the player as "you". Use plain words. Add one goofy detail. ' +
      'Stay true to the facts. Be nice even when it went badly. ' +
      'Return exactly this JSON shape:\n' +
      '{ "headline": "2-4 word arcade shout, like NICE FLYING! or MY POOR HEAD", ' +
      '"outcome": "1 or 2 tiny, goofy sentences you say to the player, max 24 words total" }',
  };
}

function repairPrompt(body) {
  const past = (body.history || []).map((h) => `- ${h.outcome}`).join('\n') || '- The trip has just begun.';
  return {
    system:
      `You are a drawing that has come to life, flying to the moon, and the player just drew a landing idea onto your body. ${TONE} ` +
      'Compare BEFORE and AFTER. Identify the NEW marks the player added, not the original character. ' +
      'Reward practical ideas, but make strange ideas useful and funny rather than rejecting them. ' +
      'Respond with JSON only, no other text.',
    prompt:
      `Emergency: ${body.challenge.prompt}\n` +
      `You are ${body.character.name}, ${body.character.personality}. HP: ${body.hp} of ${body.maxHp}.\n` +
      `Recent trip: ${past}\n\n` +
      'Identify the main new body part or object and decide how well it helps the landing. ' +
      'A surprising addition such as a banana must create a specific funny landing result. ' +
      'Return exactly this JSON shape:\n' +
      '{ "object": "what the new marks look like, max 5 words", "score": integer 0 to 100, ' +
      '"hp_change": integer -12 to 16, ' +
      '"effect": "one tiny concrete sentence describing what the drawing does during the landing", ' +
      '"outcome": "1 or 2 tiny, goofy sentences about the landing idea, max 24 words total" }',
  };
}

// The pieces of pixel art the game can draw. The AI picks from these to build a
// world for each character. Keep in sync with public/themes.js.
const WORLD_VOCAB = {
  icons: ['cloud', 'rock', 'star', 'heart', 'bone', 'fish', 'bird', 'ghost', 'bubble', 'gear', 'sock', 'book', 'candy',
    'flower', 'note', 'crystal', 'can', 'wrench', 'cookie', 'balloon', 'leaf', 'coin'],
  colors: ['red', 'orange', 'yellow', 'green', 'blue', 'pink', 'lavender', 'brown', 'silver', 'white', 'plum', 'forest', 'slate', 'peach'],
  singers: ['whale', 'jellyfish', 'dog', 'cat', 'owl', 'robot'],
  vehicles: ['rocket', 'teapot', 'bathtub', 'box', 'balloon'],
  skies: ['day', 'dawn', 'sunset', 'night', 'space', 'candy', 'sea', 'forest'],
  floors: ['clouds', 'grass', 'sand', 'water', 'neon', 'circuit', 'candy', 'ice', 'lava'],
};

// Builds the whole trip around one character: what they ride, what they meet,
// what they collect. The mechanics never change; only who and what fills them.
function worldPrompt(body) {
  const c = body.character;
  const v = WORLD_VOCAB;
  return {
    system:
      `You are the level designer for a short drawing game. ${TONE} ` +
      'A drawing has come to life and the player is flying it to the moon. You theme a wobble launch and a space duet ' +
      'so the whole trip is about THIS character: their story, the person or thing they are going for, their keepsake, ' +
      'their personality. Respond with JSON only.',
    prompt:
      `Character: ${c.name}, ${c.personality}. ${c.intro || ''}\n` +
      `Why they are going: ${c.reason?.line || 'unknown'}\n` +
      `They carry: ${c.reason?.keepsake || 'nothing'}. On the moon they want to: ${c.reason?.goal || 'see it'}.\n` +
      'The two themed moments:\n' +
      '1 wobble launch: the player balances a silly vehicle carrying the character away from Earth.\n' +
      '2 space duet: a creature sings to them and the player taps the notes back.\n\n' +
      `Art you may use (use these exact words): icons ${v.icons.join(', ')}; colors ${v.colors.join(', ')}; ` +
      `singers ${v.singers.join(', ')}; vehicles ${v.vehicles.join(', ')}; skies ${v.skies.join(', ')}; floors ${v.floors.join(', ')}.\n\n` +
      'Return exactly this JSON shape:\n' +
      '{\n' +
      '  "anchors": ["3 specific things from THIS character\'s story or identity, e.g. a name, a person, a place, the keepsake"],\n' +
      '  "voice": { "ouch": "what they yell when hit, max 10 letters, e.g. YELP!", "yay": "what they yell when happy, max 10 letters" },\n' +
      '  "liftoff": { "title": "2-4 words", "line": "what they say to the player before it, max 140 chars", ' +
      '"vehicle": { "name": "the vehicle, starting with the", "kind": one of vehicles, "color": one of colors } },\n' +
      '  "whale": { "title": "...", "line": "...", "singer": { "name": "who sings, starting with the or a name", "kind": one of singers, "color": one of colors }, "sound": "the sound they sing, one word, max 6 letters, e.g. AWOO" },\n' +
      '  "keepsake": { "icon": the icon that looks most like their keepsake, "color": one of colors }\n' +
      '}\n' +
      'Rules:\n' +
      '- Both moments must use at least one anchor in the title, line, vehicle, or singer.\n' +
      '- Tie both moments to their reason, keepsake, or identity. The singer can be the one they miss.\n' +
      '- Do NOT fall back on the generic trip (a rocket, a whale, storm clouds, stars, asteroids, fuel cans) unless it ' +
      'genuinely belongs to their story. Every name should be specific, e.g. "the moon hound" not "the dog".\n' +
      '- The voice words must sound like THIS character (a dog yelps, a knight says HUZZAH).\n' +
      '- Pick icons that actually look like the names you give them.\n' +
      '- Each line is spoken by the character to the player ("you"), in their own voice, mentions the things by name, ' +
      'and tells the player what to do in that level. Keep it all-ages and warm.\n\n' +
      'Example. For a dramatic knight whose reason is "Gran pointed at the moon and said go on then, and I have been ' +
      'going on ever since" and who carries "a grandmother\'s brass button", a great answer is:\n' +
      JSON.stringify({ anchors: ['Gran', "Gran's brass button", 'the dare'], ...MOCK_WORLDS['Sir Loopsalot'] }) + '\n' +
      'Now do the same for the character above: every level built from THEIR anchors.',
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
    hp_change: clamp(raw.hp_change, -12, 16, 0),
    effect: str(raw.effect, 140, 'It makes the landing less bonky.'),
    outcome: str(raw.outcome, 320, 'It rattles, glows, and somehow keeps the mission moving.'),
  };
}

// Anything missing or outside the art library falls back to the generic trip,
// so a half-right answer still plays. Throws if the answer is mostly unusable.
function cleanWorld(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('World was not an object');
  const v = WORLD_VOCAB;
  const pick = (x, list, fb) => (list.includes(x) ? x : fb);
  const word = (x, fb) => (str(x, 10, fb).toUpperCase().replace(/[^A-Z0-9 !?'.-]/g, '') || fb);
  const thing = (x, fb) => ({ name: str(x?.name, 40, fb.name), icon: pick(x?.icon, v.icons, fb.icon), color: pick(x?.color, v.colors, fb.color) });
  const level = (id, fb) => ({ title: str(raw[id]?.title, 40, fb.title), line: str(raw[id]?.line, 160, fb.line) });
  const base = GENERIC_WORLD;
  const w = {
    voice: { ouch: word(raw.voice?.ouch, 'OUCH!'), yay: word(raw.voice?.yay, 'YAY!') },
    liftoff: { ...level('liftoff', base.liftoff), vehicle: {
      name: str(raw.liftoff?.vehicle?.name, 40, base.liftoff.vehicle.name),
      kind: pick(raw.liftoff?.vehicle?.kind, v.vehicles, 'rocket'),
      color: pick(raw.liftoff?.vehicle?.color, v.colors, 'red'),
    } },
    sky: { ...level('sky', base.sky), sky: pick(raw.sky?.sky, v.skies, 'day'), floor: pick(raw.sky?.floor, v.floors, 'clouds'),
      bad: thing(raw.sky?.bad, base.sky.bad), good: thing(raw.sky?.good, base.sky.good) },
    whale: { ...level('whale', base.whale), sound: word(raw.whale?.sound, 'LA').slice(0, 6), singer: {
      name: str(raw.whale?.singer?.name, 40, base.whale.singer.name),
      kind: pick(raw.whale?.singer?.kind, v.singers, 'whale'),
      color: pick(raw.whale?.singer?.color, v.colors, 'blue'),
    } },
    refuel: { ...level('refuel', base.refuel), station: str(raw.refuel?.station, 40, base.refuel.station),
      good: thing(raw.refuel?.good, base.refuel.good), bad: thing(raw.refuel?.bad, base.refuel.bad) },
    rocks: { ...level('rocks', base.rocks), sky: pick(raw.rocks?.sky, v.skies, 'space'), floor: pick(raw.rocks?.floor, v.floors, 'neon'),
      bad: thing(raw.rocks?.bad, base.rocks.bad), good: thing(raw.rocks?.good, base.rocks.good) },
    lander: level('lander', base.lander),
    keepsake: { icon: pick(raw.keepsake?.icon, v.icons, 'star'), color: pick(raw.keepsake?.color, v.colors, 'yellow') },
  };
  const themed = ['liftoff', 'whale'].filter((id) => raw[id]?.title).length;
  if (themed < 2) throw new Error('World was missing a themed moment');
  // A world built from the stock pieces isn't about anyone. Reject it so the
  // story-based fallback gets a go instead.
  const stock = [w.liftoff.vehicle.kind === 'rocket', w.whale.singer.kind === 'whale'].filter(Boolean).length;
  if (stock >= 2) throw new Error('World used only stock pieces');
  return w;
}

// ---------------------------------------------------------------------------
// Built-in content, used in demo mode and whenever an AI call fails.
// ---------------------------------------------------------------------------

const MOCK_CHARACTERS = [
  {
    name: 'Captain Scribbles', hp: 90, personality: 'brave but easily distracted',
    intro: 'Captain Scribbles is tired of waving at the moon. Today, the moon gets a visit.',
    reason: {
      keepsake: 'a chewed dog collar',
      goal: 'bury it where the Earth never sets',
      line: 'Rocket the dog loved the moon. I promised to sniff it for her.',
    },
    traits: [
      { name: 'Big Heart', kind: 'strength', power: 'heart', effect: 'Anything alive out there ends up on your side.', inspiredBy: 'the round shape in the middle' },
      { name: 'Quick Hands', kind: 'strength', power: 'agile', effect: 'Dodges what the eyes only just noticed.', inspiredBy: 'the confident lines' },
      { name: 'Wobbly Legs', kind: 'weakness', power: 'steady', effect: 'Anything needing a held nerve goes sideways.', inspiredBy: 'the uneven lines at the bottom' },
    ],
  },
  {
    name: 'Sir Loopsalot', hp: 120, personality: 'dramatic and fearless',
    intro: 'Sir Loopsalot told everyone about this trip. Even a confused pigeon.',
    reason: {
      keepsake: "a grandmother's brass button",
      goal: 'finish the dare she set him at seven',
      line: 'Gran pointed at the moon and said, "Go on then." So... I am going.',
    },
    traits: [
      { name: 'Iron Grip', kind: 'strength', power: 'steady', effect: 'Holds a line however hard it shakes.', inspiredBy: 'the thick outlines' },
      { name: 'Reads the Room', kind: 'strength', power: 'clever', effect: 'Spots the gap before it opens.', inspiredBy: 'the careful spacing' },
      { name: 'Show Off', kind: 'weakness', power: 'agile', effect: 'Turns a simple dodge into a flourish, badly.', inspiredBy: 'the extra flourishes' },
    ],
  },
];

// The trip before anything is themed. Also the fallback for any missing piece.
const GENERIC_WORLD = {
  voice: { ouch: 'OUCH!', yay: 'YAY!' },
  liftoff: { title: 'Light the rocket', line: "Okay, I'm holding on! Light the engines for me. Tap when the spark hits the gold!",
    vehicle: { name: 'the rocket', kind: 'rocket', color: 'red' } },
  sky: { title: 'Up through the clouds', line: 'Whoa, clouds! The dark ones zap. Steer me around them, and grab every star!', sky: 'day', floor: 'clouds',
    bad: { name: 'storm clouds', icon: 'cloud', color: 'slate' }, good: { name: 'stars', icon: 'star', color: 'yellow' } },
  whale: { title: 'Sing with the whale', line: 'Is that... a WHALE? It is singing to us! Help me sing back. Hit every note!', sound: 'LA',
    singer: { name: 'the space whale', kind: 'whale', color: 'blue' } },
  refuel: { title: 'Catch the fuel', line: 'A space station! They are tossing us fuel! Move me under the cans. Not the junk!', station: 'the halfway station',
    good: { name: 'fuel cans', icon: 'can', color: 'green' }, bad: { name: 'bits of junk', icon: 'wrench', color: 'slate' } },
  rocks: { title: 'Zap through the rocks', line: 'Rocks. So many rocks. Tap to zap them before they bonk me!', sky: 'space', floor: 'neon',
    bad: { name: 'asteroids', icon: 'rock', color: 'brown' }, good: { name: 'ice crystals', icon: 'crystal', color: 'blue' } },
  lander: { title: 'Land on the moon', line: 'There it is, the MOON! Hold to slow us down, and put me on the flashing pad. Gently!' },
  keepsake: { icon: 'star', color: 'yellow' },
};

// Hand-themed trips for the built-in characters, so demo mode shows the idea off.
const MOCK_WORLDS = {
  'Captain Scribbles': {
    voice: { ouch: 'YELP!', yay: 'GOOD DOG!' },
    liftoff: { title: 'Light the kennel', line: "Rocket's old kennel, now with engines! Tap when the spark hits the gold, and we're off!",
      vehicle: { name: 'the cardboard kennel', kind: 'box', color: 'red' } },
    sky: { title: 'Chase the gulls', line: 'Seagulls! Rocket barked at every single one. Steer me round them and grab the biscuits!', sky: 'dawn', floor: 'clouds',
      bad: { name: 'squawking seagulls', icon: 'bird', color: 'white' }, good: { name: 'dog biscuits', icon: 'bone', color: 'peach' } },
    whale: { title: 'Howl at the moon', line: 'A giant space dog is howling... it sounds just like Rocket! Howl back with me, note for note!', sound: 'AWOO',
      singer: { name: 'the moon hound', kind: 'dog', color: 'silver' } },
    refuel: { title: 'Treats from the pound', line: 'The Space Pound is tossing treats! Catch the bones, but dodge the bath-time socks. I HATE bath time.',
      station: 'the Space Pound', good: { name: 'juicy bones', icon: 'bone', color: 'white' }, bad: { name: 'bath-time socks', icon: 'sock', color: 'blue' } },
    rocks: { title: 'Fetch in the belt', line: 'Meteors everywhere! Zap them, and grab the tennis balls. Rocket would have LOVED this bit.', sky: 'night', floor: 'neon',
      bad: { name: 'grumpy meteors', icon: 'rock', color: 'brown' }, good: { name: 'tennis balls', icon: 'coin', color: 'green' } },
    lander: { title: 'Down to the moon', line: "There's the moon, Rocket! Hold to slow us down and land us on the flashing pad. Gently!" },
    keepsake: { icon: 'heart', color: 'red' },
  },
  'Sir Loopsalot': {
    voice: { ouch: 'GADZOOKS!', yay: 'HUZZAH!' },
    liftoff: { title: "Gran's teapot launch", line: "Gran's teapot, fitted with rockets, as she would have wanted! Light it on the gold, squire!",
      vehicle: { name: "Gran's old teapot", kind: 'teapot', color: 'blue' } },
    sky: { title: 'The crow gauntlet', line: "Crows! The very ones that pinched Gran's buttons. Dodge them, and grab every button back!", sky: 'sunset', floor: 'grass',
      bad: { name: 'nosy crows', icon: 'bird', color: 'slate' }, good: { name: 'lost buttons', icon: 'coin', color: 'yellow' } },
    whale: { title: 'Duet with Duchess', line: "Duchess? Gran's old cat, in SPACE? She wants a duet. Sing back with me, note for note!", sound: 'MEOW',
      singer: { name: 'Duchess the cat', kind: 'cat', color: 'lavender' } },
    refuel: { title: "Gran's floating kitchen", line: "Gran's kitchen, floating in space! Catch the cookies, but mind the recipe books. They are HEAVY.",
      station: "Gran's floating kitchen", good: { name: 'warm cookies', icon: 'cookie', color: 'peach' }, bad: { name: 'heavy recipe books', icon: 'book', color: 'plum' } },
    rocks: { title: 'Joust the meteors', line: 'Dastardly meteors bar our path! Zap them, and seize the gems. For Gran!', sky: 'space', floor: 'neon',
      bad: { name: 'dastardly meteors', icon: 'rock', color: 'brown' }, good: { name: 'glimmering gems', icon: 'crystal', color: 'pink' } },
    lander: { title: 'Finish the dare', line: "The moon! Gran, I'm nearly there. Hold to slow us, and set us on the flashing pad!" },
    keepsake: { icon: 'coin', color: 'yellow' },
  },
};

// For any other character with no AI available: read their story for clues and
// theme the trip from those. Earlier rules win when two want the same slot.
const WORLD_CLUES = [
  [/\b(dog|puppy|pup|bark|woof|collar)\b/, { skyGood: ['dog treats', 'bone', 'peach'], singer: ['the moon hound', 'dog', 'silver', 'AWOO'], yay: 'WOOF!' }],
  [/\b(cat|kitten|kitty|meow|purr)\b/, { skyGood: ['fish snacks', 'fish', 'orange'], singer: ['the space cat', 'cat', 'lavender', 'MEOW'], yay: 'PURR!' }],
  [/\b(sea|ocean|fish|sail|boat|beach|shell|swim)\b/, { skyGood: ['little fish', 'fish', 'blue'], singer: ['the space whale', 'whale', 'blue', 'OOOO'], vehicle: ['the bathtub boat', 'bathtub', 'blue'], sky: 'sea', floor: 'water' }],
  [/\b(gran|granny|grandma|grandmother|nan|nana|kitchen|cook|bake|baking)\b/, { refuel: ['the floating kitchen', 'warm cookies', 'cookie', 'peach'], vehicle: ['the flying teapot', 'teapot', 'blue'] }],
  [/\b(music|song|sing|singer|guitar|piano|band|melody)\b/, { skyGood: ['music notes', 'note', 'yellow'], singer: ['the singing robot', 'robot', 'silver', 'BEEP'] }],
  [/\b(flower|garden|plant|tree|forest|park|leaf)\b/, { skyGood: ['flowers', 'flower', 'pink'], skyBad: ['swirling leaves', 'leaf', 'green'], sky: 'forest', floor: 'grass' }],
  [/\b(book|school|read|reading|library|teacher|homework)\b/, { skyBad: ['flying homework', 'book', 'plum'], skyGood: ['gold stars', 'star', 'yellow'] }],
  [/\b(robot|machine|computer|code|engine|invent|inventor)\b/, { rocksBad: ['rusty gears', 'gear', 'orange'], singer: ['the old satellite', 'robot', 'silver', 'BEEP'], floor: 'circuit' }],
  [/\b(ghost|spooky|haunted|dark|night)\b/, { skyBad: ['grumpy ghosts', 'ghost', 'white'], sky: 'night' }],
  [/\b(candy|sweet|sweets|sugar|chocolate|cake)\b/, { skyGood: ['sweets', 'candy', 'pink'], sky: 'candy', floor: 'candy' }],
  [/\b(balloon|party|birthday|circus)\b/, { vehicle: ['the party balloon', 'balloon', 'pink'], skyGood: ['balloons', 'balloon', 'red'] }],
  [/\b(bread|toast|toaster|baker|bakery|cheese|pizza|sandwich|food|breakfast|butter)\b/, { skyGood: ['cheese crumbs', 'cookie', 'yellow'], refuel: ['the flying bakery', 'warm buns', 'cookie', 'peach'], vehicle: ['the toast rocket', 'box', 'orange'] }],
  [/\b(bird|feather|wing|wings|nest|owl)\b/, { skyGood: ['shiny feathers', 'leaf', 'white'], singer: ['the night owl', 'owl', 'brown', 'HOOT'] }],
  [/\b(snow|ice|winter|cold|frozen|penguin)\b/, { skyBad: ['flying snowballs', 'bubble', 'white'], floor: 'ice' }],
  [/\b(ball|football|soccer|sport|tennis|goal)\b/, { skyGood: ['bouncy balls', 'coin', 'green'] }],
  [/\b(love|heart|sister|brother|mum|mom|mother|dad|father|friend|promise)\b/, { skyGood: ['little hearts', 'heart', 'pink'] }],
];

const KEEPSAKE_CLUES = [
  [/button|coin|medal|penny|badge/, 'coin', 'yellow'], [/letter|book|photo|diary|card|map/, 'book', 'white'],
  [/flower|rose|daisy/, 'flower', 'pink'], [/sock|mitten|glove|scarf/, 'sock', 'red'], [/heart|locket/, 'heart', 'red'],
  [/bone|collar/, 'bone', 'white'], [/cookie|biscuit/, 'cookie', 'peach'], [/shell|fish/, 'fish', 'orange'],
  [/note|song|music|harmonica/, 'note', 'yellow'], [/crystal|gem|ring|stone|marble/, 'crystal', 'blue'],
  [/balloon/, 'balloon', 'red'], [/leaf|acorn|seed/, 'leaf', 'green'], [/star/, 'star', 'yellow'],
];

function mockWorld(body) {
  const c = body.character || {};
  if (MOCK_WORLDS[c.name]) return copy(MOCK_WORLDS[c.name]);
  const w = copy(GENERIC_WORLD);
  const text = [c.name, c.personality, c.intro, c.reason?.line, c.reason?.keepsake, c.reason?.goal].join(' ').toLowerCase();
  const taken = new Set();
  const set = (slot, fn) => { if (!taken.has(slot)) { taken.add(slot); fn(); } };
  for (const [re, clue] of WORLD_CLUES) {
    if (!re.test(text)) continue;
    if (clue.skyGood) set('skyGood', () => { const [name, icon, color] = clue.skyGood; w.sky.good = { name, icon, color }; });
    if (clue.skyBad) set('skyBad', () => { const [name, icon, color] = clue.skyBad; w.sky.bad = { name, icon, color }; });
    if (clue.rocksBad) set('rocksBad', () => { const [name, icon, color] = clue.rocksBad; w.rocks.bad = { name, icon, color }; });
    if (clue.singer) set('singer', () => { const [name, kind, color, sound] = clue.singer; w.whale.singer = { name, kind, color }; w.whale.sound = sound; });
    if (clue.vehicle) set('vehicle', () => { const [name, kind, color] = clue.vehicle; w.liftoff.vehicle = { name, kind, color }; });
    if (clue.refuel) set('refuel', () => { const [station, name, icon, color] = clue.refuel; w.refuel.station = station; w.refuel.good = { name, icon, color }; });
    if (clue.sky) set('sky', () => { w.sky.sky = clue.sky; });
    if (clue.floor) set('floor', () => { w.sky.floor = clue.floor; });
    if (clue.yay) set('yay', () => { w.voice.yay = clue.yay; });
  }
  const keep = (c.reason?.keepsake || '').toLowerCase();
  const k = KEEPSAKE_CLUES.find(([re]) => re.test(keep));
  if (k) w.keepsake = { icon: k[1], color: k[2] };

  // Lines written from the chosen names, so they always match what's on screen.
  const cap = (x) => x[0].toUpperCase() + x.slice(1);
  w.liftoff.title = `Launch ${w.liftoff.vehicle.name}`;
  w.liftoff.line = `${cap(w.liftoff.vehicle.name)} is ready! Tap when the spark hits the gold, and we're off to the moon!`;
  w.sky.line = `Look out, ${w.sky.bad.name}! Steer me around them, and grab the ${w.sky.good.name}!`;
  w.whale.title = `Sing with ${w.whale.singer.name}`;
  w.whale.line = `Listen... it's ${w.whale.singer.name}, singing to us! Help me sing back, note for note!`;
  w.refuel.title = `Catch the ${w.refuel.good.name}`;
  w.refuel.line = `${cap(w.refuel.station)}! Catch the ${w.refuel.good.name}, and keep me away from the ${w.refuel.bad.name}!`;
  w.rocks.line = `Here come the ${w.rocks.bad.name}! Tap to zap them, and grab the ${w.rocks.good.name}!`;
  // Even with no clues at all, the last stretch is still about them.
  const carrying = (c.reason?.keepsake || '').trim();
  if (carrying) w.lander.line = `There's the moon! Hold to slow us down and land me on the pad. I've got ${carrying} ready.`;
  return w;
}

// In the character's own voice, talking to the player. {bad}, {good}, {singer},
// {vehicle} and {station} are filled with this character's themed names.
const MOCK_BEATS = {
  wobble: {
    high: { headline: 'STABLE-ISH!', outcome: 'You tamed the wobble! Only my socks screamed.' },
    mid: { headline: 'WIGGLE POWER!', outcome: 'We leaned. We bonked. We still escaped Earth!' },
    low: { headline: 'WOBBLE BONK!', outcome: 'That rocket danced like jelly. Somehow, up happened.' },
  },
  orbit: {
    high: { headline: 'PRETTY SPACE ROAD!', outcome: 'Your line scooped up every shiny ring. Very professional spaghetti!' },
    mid: { headline: 'MOON-ISH!', outcome: 'A few planet bonks, but your road went mostly moonward.' },
    low: { headline: 'LOST WITH STYLE!', outcome: 'Your line visited several planets with its face. The moon is still over there!' },
  },
  liftoff: {
    high: { headline: 'ZOOM! NO BONKS!', outcome: 'Three perfect sparks! My stomach stayed on Earth, but the rest of me is fine.' },
    mid: { headline: 'UP-ISH!', outcome: 'One spark went pfft. {vehicle} still went WHOOSH!' },
    low: { headline: 'WOBBLE LAUNCH!', outcome: '{vehicle} coughed a lot. We are flying anyway. Probably on purpose.' },
  },
  sky: {
    high: { headline: 'ZERO FACE BONKS!', outcome: 'You dodged the {bad}! I grabbed the {good} like a hungry vacuum.' },
    mid: { headline: 'BONK-ISH!', outcome: 'Some {bad} hugged my face. We kept going.' },
    low: { headline: 'BONK FEST!', outcome: 'I met every {bad} with my head. My head votes no.' },
  },
  whale: {
    high: { headline: 'SPACE BANGER!', outcome: 'You hit every note! {singer} did a happy wiggle.' },
    mid: { headline: 'CLOSE ENOUGH!', outcome: 'We missed a few notes. {singer} politely pretended not to notice.' },
    low: { headline: 'MUSICAL BONK!', outcome: 'Those were definitely noises. {singer} left very quickly.' },
  },
  refuel: {
    high: { headline: 'FULL TUMMY!', outcome: 'So many {good}! I could zoom through a wall. I will not.' },
    mid: { headline: 'SNACK SECURED!', outcome: 'Some {good}, some {bad}. A balanced space lunch.' },
    low: { headline: 'JUNK BUFFET!', outcome: 'Mostly {bad}. Crunchy. Bad flavor.' },
  },
  rocks: {
    high: { headline: 'ZAP ZAP YIPPEE!', outcome: 'You toasted the {bad}! Not one butt-bonk.' },
    mid: { headline: 'A FEW BONKS', outcome: 'Some {bad} bonked me. The moon is still right there!' },
    low: { headline: 'BONK CITY!', outcome: 'The {bad} used me as a drum. But hey—moon!' },
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
  const set = MOCK_BEATS[body.stage] || MOCK_BEATS.sky;
  const beat = copy(body.score >= 80 ? set.high : body.score >= 50 ? set.mid : set.low);
  const given = Object.entries(body.names || {}).filter(([, v]) => typeof v === 'string' && v.trim());
  const n = { bad: 'storm clouds', good: 'stars', singer: 'the space whale', vehicle: 'the rocket', station: 'the station', ...Object.fromEntries(given) };
  const out = beat.outcome.replace(/\{(bad|good|singer|vehicle|station)\}/g, (_, k) => String(n[k]).slice(0, 40));
  beat.outcome = out[0].toUpperCase() + out.slice(1);
  return beat;
}

function mockRepair(body) {
  return body.challenge?.id === 'landing'
    ? { object: 'a moon-pointing doodad', score: 72, hp_change: 8, effect: 'It finds a soft spot to land.',
        outcome: 'It points at the moon and goes BEEP. Good enough for me!' }
    : { object: 'a suspicious space tool', score: 68, hp_change: 6, effect: 'It makes the engine wobble less.',
        outcome: 'The sparks stopped! It smells like toast, but it works.' };
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

  // A whole trip themed around one character. Called once, in the background,
  // while the character wakes up, so the player never waits on it.
  'POST /api/world': async (body) =>
    withFallback(
      'world',
      async () => {
        if (!body.character) throw new Error('World needs a character');
        return cleanWorld(await askAI(worldPrompt(body)));
      },
      () => mockWorld(body)
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
        return cleanRepair(await askAI({ ...repairPrompt(body), image: body.image, beforeImage: body.beforeImage }));
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

async function handleRequest(req, res) {
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
}

if (require.main === module) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`\n  Draw Me to the Moon is running at http://localhost:${PORT}`);
    console.log(
      MOCK_MODE
        ? `  Demo mode: no API key found for "${PROVIDER}", so characters and flight logs come from the built-in list.\n  Add a key to .env to turn on the AI.\n`
        : `  AI provider: ${PROVIDER}\n`
    );
  });
}

// Vercel's /api entry points import this handler. Keeping the listener above
// behind require.main preserves the same `node server.js` local workflow.
module.exports = handleRequest;

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
