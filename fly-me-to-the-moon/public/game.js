// Fly Me to the Moon: game logic
// draw -> (manual) -> they wake up and ask for your help -> character sheet
//      -> [brief -> level -> they tell you how it went] x N -> the moon -> THE END
//
// You are not the astronaut. Your drawing is. It wakes up, asks you to take it
// to the moon, and then you steer it through every level while it talks to you.
// Its trait powers change how each level plays.

const $ = (sel) => document.querySelector(sel);

// ---------- Game settings: tweak these freely ----------

// One entry per beat of the trip. `game` names a level in minigames.js.
// `hp` is the range that level can swing: perfect play earns the high number,
// a total mess costs the low one.
const LEVELS = [
  { game: 'liftoff', stage: 'Launch pad', kicker: 'Level 1 · Launch pad', progress: 0.1, hp: [-18, 6] },
  { repair: 'engine', progress: 0.18 },
  { game: 'sky', stage: 'The sky', kicker: 'Level 2 · The sky', progress: 0.34, hp: [-26, 6] },
  { game: 'whale', stage: 'Deep space', kicker: 'Level 3 · Deep space', progress: 0.5, hp: [-22, 10] },
  { game: 'refuel', stage: 'Halfway station', kicker: 'Level 4 · Halfway station', progress: 0.64, hp: [-8, 22] },
  { game: 'rocks', stage: 'Asteroid belt', kicker: 'Level 5 · Asteroid belt', progress: 0.82, hp: [-28, 6] },
  { repair: 'landing', progress: 0.9 },
  { game: 'lander', stage: 'The moon', kicker: 'Level 6 · The moon', progress: 1, hp: [-30, 8] },
];

// `prompt` goes to the AI judge; `line` is what the character says to you.
const REPAIR_CHALLENGES = {
  engine: {
    id: 'engine',
    title: 'The engine snapped',
    prompt: 'The engine coupler snapped and is coughing sparks. The player must draw something that could hold it together until space.',
    line: 'Help! The engine just snapped! Draw me something, anything, to hold it together!',
  },
  landing: {
    id: 'landing',
    title: 'The scanner floated off',
    prompt: 'The landing scanner has floated away. The player must draw something that can guide the ship safely down to the moon.',
    line: 'Uh oh. The landing scanner floated away! Can you draw me something to guide us down?',
  },
};

// The very last thing your character says to you.
const FINAL_LINE = 'Thank you for flying me to the moon. This is so beautiful.';

const POINT_BUDGET = 6;
const BASE_HP = 50;
const HP_PER_POINT = 25;

const POWERS = ['steady', 'agile', 'clever', 'lucky', 'heart'];
const POWER_LABEL = { steady: 'Steady', agile: 'Agile', clever: 'Clever', lucky: 'Lucky', heart: 'Heart' };

// What a trait power concretely does in each level. [as a strength, as a weakness]
// These are the real rules the levels apply, written out so the player sees them.
const POWER_NOTES = {
  liftoff: {
    steady: ['the gold zone is wider and the spark moves slower', 'the gold zone is tiny and the spark races'],
    lucky: ['one fizzled spark gets a free second try', 'no second tries'],
  },
  sky: {
    agile: ['I turn sharply and slip past clouds', 'I turn late, and clouds catch me'],
    lucky: ['more stars along the way', 'hardly any stars up here'],
  },
  whale: {
    heart: ['the whale is patient, so the timing window is wide', 'the whale is impatient, so the window is tight'],
    clever: ['I read the notes early, so they slide in slower', 'the notes rush in fast'],
  },
  refuel: {
    agile: ['I zip left and right quickly', 'I shuffle about slowly'],
    lucky: ['less junk falls out of the station', 'more junk falls out of the station'],
  },
  rocks: {
    agile: ['I turn sharply around the rocks', 'I turn late, and rocks catch me'],
    clever: ['my zaps are big and hard to miss', 'my zaps are thin'],
  },
  lander: {
    steady: ['a bigger tank of thruster fuel', 'the tanks are nearly empty'],
    agile: ['snappy side thrusters', 'sluggish side thrusters'],
  },
};

// ---------- Game state ----------

const state = {
  doodle: null,       // data URL of the drawing
  character: null,    // { name, hp, personality, intro, reason, traits: [{ name, kind, power, effect, inspiredBy }] }
  stats: null,        // { steady, agile, clever, lucky, heart }
  sprites: null,      // { main, small, steps: [...] } pixel versions of the drawing
  portrait: '',       // data URL of the main sprite, for dialogue boxes
  maxHp: 0,
  hp: 0,
  index: 0,           // position in LEVELS
  history: [],        // [{ stage, outcome, hp_change, score }]
  progress: 0,
  scores: [],
};

let currentScene = null;
const stopScene = () => { if (currentScene) currentScene.stop(); currentScene = null; };

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

function showError(sel, message) {
  const el = $(sel);
  el.textContent = message;
  el.hidden = !message;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ======================================================================
// Dialogue: a typewriter text box with the character's pixel portrait
// ======================================================================

// Types `line` into a dialogue box. With wait, it resolves when the player
// clicks (or presses Enter/Space) after the text is done; `auto` also moves on
// by itself after that many milliseconds. Without wait, it resolves once typed.
function speak(sel, line, opts) {
  const o = opts || {};
  const box = $(sel);
  const portrait = box.querySelector('.dialog-portrait');
  const name = box.querySelector('.dialog-name');
  const text = box.querySelector('.dialog-text');
  const next = box.querySelector('.dialog-next');
  const token = {};
  box._token = token;
  box.hidden = false;
  box.classList.toggle('is-player', !!o.player);
  box.classList.toggle('waits', !!o.wait);
  portrait.hidden = !!o.player;
  if (!o.player) portrait.src = state.portrait;
  name.textContent = o.player ? 'You' : state.character.name;
  if (next) next.hidden = true;
  text.textContent = '';

  return new Promise((resolve) => {
    let i = 0, typed = false, autoTimer = null;
    const cleanup = () => {
      clearInterval(timer);
      clearTimeout(autoTimer);
      box.removeEventListener('click', onAdvance);
      window.removeEventListener('keydown', onAdvance);
    };
    const done = () => { cleanup(); resolve(); };
    const finishTyping = () => {
      clearInterval(timer);
      text.textContent = line;
      typed = true;
      if (!o.wait) return done();
      if (next) next.hidden = false;
      if (o.auto) autoTimer = setTimeout(done, o.auto);
    };
    const timer = setInterval(() => {
      if (box._token !== token) return cleanup();
      i += 1;
      text.textContent = line.slice(0, i);
      if (i >= line.length) finishTyping();
    }, 30);
    const onAdvance = (e) => {
      if (e.type === 'keydown') {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) return;
        e.preventDefault();
      }
      if (!typed) return finishTyping();
      if (o.wait) done();
    };
    box.addEventListener('click', onAdvance);
    window.addEventListener('keydown', onAdvance);
  });
}

// ======================================================================
// Drawing
// ======================================================================

const canvas = $('#doodle');
const ctx = canvas.getContext('2d');
const draw = { color: '#1B2250', size: 6, erasing: false, active: false, last: null, undo: [] };

function resetCanvas() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  draw.undo = [];
  updateDrawButtons();
}

const hasDrawing = () => draw.undo.length > 0;
function updateDrawButtons() {
  $('#btn-ai').disabled = !hasDrawing();
}

function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height };
}

function strokeTo(p) {
  ctx.strokeStyle = draw.erasing ? '#fff' : draw.color;
  ctx.lineWidth = draw.erasing ? draw.size * 4 : draw.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(draw.last.x, draw.last.y);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  draw.last = p;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  draw.undo.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  if (draw.undo.length > 25) draw.undo.shift();
  draw.active = true;
  draw.last = canvasPoint(e);
  // A single tap leaves a dot
  ctx.fillStyle = draw.erasing ? '#fff' : draw.color;
  ctx.beginPath();
  ctx.arc(draw.last.x, draw.last.y, (draw.erasing ? draw.size * 4 : draw.size) / 2, 0, Math.PI * 2);
  ctx.fill();
  updateDrawButtons();
});
canvas.addEventListener('pointermove', (e) => { if (draw.active) strokeTo(canvasPoint(e)); });
['pointerup', 'pointercancel', 'pointerleave'].forEach((evt) =>
  canvas.addEventListener(evt, () => { draw.active = false; })
);

document.querySelectorAll('#screen-draw .swatch').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('#screen-draw .swatch').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    draw.color = btn.dataset.color;
    draw.erasing = false;
    $('#tool-eraser').setAttribute('aria-pressed', 'false');
  })
);

$('#tool-size').addEventListener('click', (e) => {
  const thick = draw.size === 6;
  draw.size = thick ? 14 : 6;
  e.target.setAttribute('aria-pressed', String(thick));
});
$('#tool-eraser').addEventListener('click', (e) => {
  draw.erasing = !draw.erasing;
  e.target.setAttribute('aria-pressed', String(draw.erasing));
});
$('#tool-undo').addEventListener('click', () => {
  const prev = draw.undo.pop();
  if (prev) ctx.putImageData(prev, 0, 0);
  updateDrawButtons();
});
$('#tool-clear').addEventListener('click', resetCanvas);

// A simple stand-in astronaut for players who skip drawing
function defaultDoodle() {
  const c = document.createElement('canvas');
  c.width = c.height = 240;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 240, 240);
  g.strokeStyle = '#1B2250'; g.lineWidth = 8; g.lineCap = 'round';
  g.beginPath(); g.arc(120, 85, 42, 0, Math.PI * 2); g.stroke();              // helmet
  g.fillStyle = '#29ADFF'; g.beginPath(); g.ellipse(120, 85, 26, 18, 0, 0, Math.PI * 2); g.fill(); // visor
  g.beginPath(); g.moveTo(120, 127); g.lineTo(120, 180);                       // body
  g.moveTo(120, 145); g.lineTo(85, 160); g.moveTo(120, 145); g.lineTo(155, 125); // arms
  g.moveTo(120, 180); g.lineTo(95, 215); g.moveTo(120, 180); g.lineTo(145, 215); // legs
  g.stroke();
  return c.toDataURL('image/png');
}

// ======================================================================
// Character creation
// ======================================================================

async function generateCharacter() {
  state.doodle = canvas.toDataURL('image/png');
  showError('#draw-error', '');
  $('#loading-text').textContent = 'Your drawing is waking up…';
  show('screen-loading');
  try {
    const character = await api('/api/character', { image: state.doodle.split(',')[1] });
    setCharacter(character);
    wakeUp();
  } catch (err) {
    console.error(err);
    show('screen-draw');
    showError('#draw-error', 'The game server did not respond. Check that node server.js is still running, then try again.');
  }
}

$('#btn-ai').addEventListener('click', generateCharacter);
$('#btn-reroll').addEventListener('click', () => {
  // Manual characters have nothing to re-roll, so send them to the form instead
  if (state.character?.manual) return show('screen-manual');
  generateCharacter();
});
$('#btn-redraw').addEventListener('click', () => show('screen-draw'));

// Traits become numbers here. A strength adds one to its power, a weakness
// takes one away, and the levels read the result directly.
function computeStats(character) {
  const stats = { steady: 0, agile: 0, clever: 0, lucky: 0, heart: 0 };
  (character.traits || []).forEach((t, i) => {
    const power = POWERS.includes(t.power) ? t.power : POWERS[i % POWERS.length];
    t.power = power;
    stats[power] += t.kind === 'weakness' ? -1 : 1;
  });
  return stats;
}

function setCharacter(c) {
  c.reason = c.reason || {};
  state.character = c;
  state.maxHp = c.hp;
  state.stats = computeStats(c);
}

// The drawing, crunched into pixel sprites at a few sizes.
async function buildSprites() {
  const d = state.doodle;
  const [main, small, s72, s48, s36] = await Promise.all([
    R.makeSprite(d, 32), R.makeSprite(d, 12), R.makeSprite(d, 72), R.makeSprite(d, 48), R.makeSprite(d, 36),
  ]);
  state.sprites = { main, small, steps: [s72, s48, s36] };
  state.portrait = main.toDataURL('image/png');
}

// ======================================================================
// They wake up, and ask you for something
// ======================================================================

async function wakeUp() {
  $('#loading-text').textContent = 'Your drawing is waking up…';
  show('screen-loading');
  await buildSprites();

  stopScene();
  $('#alive-dialog').hidden = true;
  $('#btn-reply').hidden = true;
  show('screen-alive');
  const scene = CUTSCENES.alive({ scr: R.makeScreen($('#alive-canvas')), sprites: state.sprites });
  currentScene = scene;
  await scene.ready;
  if (currentScene !== scene) return;

  const c = state.character;
  await speak('#alive-dialog', `Hi! I'm ${c.name}.`, { wait: true });
  if (c.reason.line) await speak('#alive-dialog', c.reason.line, { wait: true });
  await speak('#alive-dialog', 'Can you bring me to the moon?');

  const reply = $('#btn-reply');
  reply.hidden = false;
  reply.focus({ preventScroll: true });
  await new Promise((resolve) => { reply.onclick = resolve; });
  reply.hidden = true;

  await speak('#alive-dialog', 'But how...?', { player: true });
  await wait(700);
  scene.cue('happy');
  await speak('#alive-dialog', "You steer, and I'll hold on tight! Here's what I'm made of.", { wait: true });
  if (currentScene !== scene) return;
  stopScene();
  renderCard();
  show('screen-card');
}

function renderCard() {
  const c = state.character;
  $('#card-img').src = state.portrait;
  $('#card-name').textContent = c.name;
  $('#card-personality').textContent = c.personality;
  $('#card-hp').textContent = c.hp;
  $('#card-reason-line').textContent = c.reason.line || '';
  $('#card-keepsake').textContent = c.reason.keepsake || 'nothing at all';
  $('#btn-reroll').textContent = c.manual ? 'Edit stats' : 'Try another take';

  const list = $('#card-traits');
  list.innerHTML = '';
  c.traits.forEach((t) => {
    const li = document.createElement('li');
    li.className = t.kind;
    li.innerHTML = '<strong></strong><span class="power-tag"></span><span class="kind"></span>' +
      (t.inspiredBy ? '<span class="seen"></span>' : '');
    li.querySelector('strong').textContent = t.name;
    li.querySelector('.power-tag').textContent = `${POWER_LABEL[t.power]} ${t.kind === 'weakness' ? '−1' : '+1'}`;
    li.querySelector('.kind').textContent = t.effect || (t.kind === 'weakness' ? 'Weakness' : 'Strength');
    if (t.inspiredBy) li.querySelector('.seen').textContent = `Spotted in your drawing: ${t.inspiredBy}`;
    list.appendChild(li);
  });

  const wrap = $('#card-powers');
  wrap.innerHTML = '';
  POWERS.forEach((p) => {
    const v = state.stats[p] || 0;
    const chip = document.createElement('span');
    chip.className = `power-chip ${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}`;
    chip.textContent = `${POWER_LABEL[p]} ${v > 0 ? '+' + v : v < 0 ? v : '·'}`;
    wrap.appendChild(chip);
  });
}

// ======================================================================
// Character creation: manual, with point-buy
// ======================================================================

function buildTraitRows() {
  const wrap = $('#trait-rows');
  wrap.innerHTML = '';
  const placeholders = ['Rocket boots', 'Talks to birds', 'Scared of the dark'];
  const defaultPowers = ['agile', 'heart', 'steady'];
  for (let i = 0; i < 3; i++) {
    const row = document.createElement('div');
    row.className = 'trait-row';
    row.innerHTML = `
      <input class="t-name" maxlength="40" aria-label="Trait ${i + 1} name" placeholder="${placeholders[i]}" />
      <select class="t-power" aria-label="Trait ${i + 1} power">
        ${POWERS.map((p) => `<option value="${p}" ${p === defaultPowers[i] ? 'selected' : ''}>${POWER_LABEL[p]}</option>`).join('')}
      </select>
      <select class="t-kind" aria-label="Trait ${i + 1} type">
        <option value="strength">Strength (−1)</option>
        <option value="weakness" ${i === 2 ? 'selected' : ''}>Weakness (+1)</option>
      </select>`;
    wrap.appendChild(row);
  }
  wrap.addEventListener('input', updatePoints);
}

function readManualTraits() {
  return [...document.querySelectorAll('.trait-row')]
    .map((row) => ({
      name: row.querySelector('.t-name').value.trim(),
      kind: row.querySelector('.t-kind').value,
      power: row.querySelector('.t-power').value,
    }))
    .filter((t) => t.name);
}

function pointsLeft() {
  const hpPoints = Number($('#m-hp').value);
  const traits = readManualTraits();
  const strengths = traits.filter((t) => t.kind === 'strength').length;
  const weaknesses = traits.filter((t) => t.kind === 'weakness').length;
  return POINT_BUDGET - hpPoints - strengths + weaknesses;
}

function updatePoints() {
  $('#m-hp-out').textContent = BASE_HP + Number($('#m-hp').value) * HP_PER_POINT;
  const left = pointsLeft();
  $('#points-left').textContent = `${left} point${left === 1 ? '' : 's'}`;
  showError('#manual-error', left < 0 ? `You're ${-left} point${left === -1 ? '' : 's'} over budget. Lower the HP or swap a strength for a weakness.` : '');
}

$('#m-hp').addEventListener('input', updatePoints);
$('#m-name').addEventListener('input', updatePoints);

$('#btn-manual').addEventListener('click', () => { updatePoints(); show('screen-manual'); });
$('#btn-manual-back').addEventListener('click', () => show('screen-draw'));

$('#manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#m-name').value.trim();
  const personality = $('#m-personality').value.trim();
  const reasonLine = $('#m-reason').value.trim();
  if (!name || !personality) return showError('#manual-error', 'Give your character a name and a personality.');
  if (!reasonLine) return showError('#manual-error', 'Every trip needs a reason. One line is plenty.');
  if (pointsLeft() < 0) return updatePoints();

  const hp = BASE_HP + Number($('#m-hp').value) * HP_PER_POINT;
  setCharacter({
    manual: true,
    name,
    personality,
    hp,
    intro: `${name} is ${personality}, and absolutely determined to reach the moon.`,
    reason: {
      line: reasonLine,
      keepsake: $('#m-keepsake').value.trim() || 'a folded paper star',
      goal: 'keep the promise',
    },
    traits: readManualTraits().map((t) => ({ ...t, effect: '', inspiredBy: '' })),
  });
  state.doodle = hasDrawing() ? canvas.toDataURL('image/png') : defaultDoodle();
  wakeUp();
});

// ======================================================================
// The pixel route map (shown on every briefing)
// ======================================================================

const P = R.P;
const routeScr = R.makeScreen($('#route-canvas'), 192, 36);
const routeStars = Array.from({ length: 24 }, (_, i) => ({ x: (i * 53) % 192, y: (i * 29) % 36 }));
const routeAt = (u) => ({ x: R.lerp(28, 164, u), y: R.lerp(24, 16, u) - Math.sin(u * Math.PI) * 10 });
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function drawRoute(u) {
  const s = routeScr;
  R.rect(s, 0, 0, s.w, s.h, P.black);
  routeStars.forEach((st) => R.px(s, st.x, st.y, P.slate));
  R.disc(s, 14, 24, 11, P.black); R.disc(s, 14, 24, 10, P.blue);
  R.disc(s, 11, 21, 4, P.green); R.disc(s, 17, 28, 3, P.green);
  R.disc(s, 178, 14, 10, P.black); R.disc(s, 178, 14, 9, P.yellow);
  R.disc(s, 175, 11, 2, P.orange); R.disc(s, 181, 17, 3, P.orange);
  for (let k = 0; k <= 1; k += 0.02) {
    const p = routeAt(k);
    if (((k * 50) | 0) % 2 === 0) R.px(s, p.x, p.y, k <= u ? P.yellow : P.lavender);
  }
  LEVELS.filter((l) => l.game).forEach((l) => {
    const p = routeAt(l.progress);
    R.rect(s, p.x - 2, p.y - 2, 4, 4, P.black);
    R.rect(s, p.x - 1, p.y - 1, 3, 3, u >= l.progress ? P.yellow : P.slate);
  });
  const p = routeAt(u);
  R.sprite(s, state.sprites.small, p.x, p.y + 7);
}

function moveRider(to) {
  const from = state.progress;
  state.progress = to;
  if (reduceMotion) return drawRoute(to);
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / 900);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    drawRoute(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderHud(stageName) {
  const pct = Math.max(0, (state.hp / state.maxHp) * 100);
  $('#hp-fill').style.width = `${pct}%`;
  $('#hp-fill').classList.toggle('low', pct <= 30);
  $('#hp-text').textContent = `HP ${state.hp}/${state.maxHp}`;
  $('#hp-meter').setAttribute('aria-valuemax', state.maxHp);
  $('#hp-meter').setAttribute('aria-valuenow', state.hp);
  $('#hud-name').textContent = state.character.name;
  if (stageName) $('#hud-stage').textContent = stageName;
}

// ======================================================================
// The trip: briefing, level, and your character's verdict
// ======================================================================

const flightScr = R.makeScreen($('#flight'));
const input = R.makeInput($('#flight'));

function startJourney() {
  stopScene();
  state.hp = state.maxHp;
  state.index = 0;
  state.history = [];
  state.scores = [];
  state.progress = 0;
  drawRoute(0);
  renderHud('');
  nextLevel();
}

$('#btn-launch').addEventListener('click', startJourney);

function nextLevel() {
  if (state.hp <= 0) return finaleLost();
  const level = LEVELS[state.index];
  if (!level) return finaleLanded();
  if (level.repair) return showRepairChallenge(REPAIR_CHALLENGES[level.repair]);
  showBriefing(level);
}

// The briefing is where the character sheet meets the level: your character
// tells you what's coming, and the panel spells out which traits are in play.
function showBriefing(level) {
  const game = MINIGAMES[level.game];
  $('#brief-kicker').textContent = level.kicker;
  $('#brief-title').textContent = game.title;
  $('#brief-objective').textContent = game.objective;
  $('#brief-hint').textContent = game.hint;

  const list = $('#brief-traits');
  list.innerHTML = '';
  const notes = POWER_NOTES[level.game] || {};
  const relevant = state.character.traits.filter((t) => game.axis.includes(t.power));
  if (!relevant.length) {
    const li = document.createElement('li');
    li.className = 'flat';
    li.textContent = 'None of my traits matter here. It is all you!';
    list.appendChild(li);
  }
  relevant.forEach((t) => {
    const pair = notes[t.power];
    const li = document.createElement('li');
    li.className = t.kind === 'weakness' ? 'weakness' : 'strength';
    li.innerHTML = '<strong></strong><span></span>';
    li.querySelector('strong').textContent = `${t.name} · ${POWER_LABEL[t.power]} ${t.kind === 'weakness' ? '−1' : '+1'}`;
    li.querySelector('span').textContent = pair ? (t.kind === 'weakness' ? pair[1] : pair[0]) : (t.effect || 'It comes into play here.');
    list.appendChild(li);
  });

  moveRider(level.progress);
  show('screen-brief');
  speak('#brief-dialog', game.line);
  $('#btn-brief-go').focus({ preventScroll: true });
}

$('#btn-brief-go').addEventListener('click', () => {
  const level = LEVELS[state.index];
  if (level && level.game) runLevel(level);
});

async function runLevel(level) {
  const game = MINIGAMES[level.game];
  renderHud(level.stage);
  $('#flight-objective').textContent = game.objective;
  $('#flight-hint').textContent = game.hint;
  show('screen-flight');
  input.clear();

  const result = await game.run({ scr: flightScr, input, stats: state.stats, character: state.character, sprites: state.sprites });

  const [low, high] = level.hp;
  const change = Math.round(low + ((high - low) * result.score) / 100);
  const before = state.hp;
  state.hp = Math.max(0, Math.min(state.maxHp, state.hp + change));
  const actual = state.hp - before;
  state.scores.push(result.score);

  // A great refuel earns a bolt-on gadget that shores up the character's worst power.
  let bonusTrait = null;
  if (level.game === 'refuel' && result.score >= 70) bonusTrait = grantStationTrait();

  showLog(level, result, actual, bonusTrait);
}

const STATION_GADGETS = {
  steady: { name: 'Gyro Ballast', effect: 'A humming brick that steadies every held line.' },
  agile: { name: 'Snap Thrusters', effect: 'Four little nozzles that turn on a coin.' },
  clever: { name: 'Squint Lens', effect: 'Shows what is coming a good deal sooner.' },
  lucky: { name: 'Bent Horseshoe', effect: 'Statistically indefensible. Works anyway.' },
  heart: { name: 'Friendly Chime', effect: 'Plays a warm note at anything alive out there.' },
};

function grantStationTrait() {
  const worst = POWERS.slice().sort((a, b) => (state.stats[a] || 0) - (state.stats[b] || 0))[0];
  const gadget = STATION_GADGETS[worst];
  const trait = { name: gadget.name, kind: 'strength', power: worst, effect: gadget.effect, inspiredBy: '' };
  state.character.traits.push(trait);
  state.stats = computeStats(state.character);
  return trait;
}

async function showLog(level, result, actual, bonusTrait) {
  const game = MINIGAMES[level.game];
  $('#log-headline').textContent = '...';
  $('#log-score').textContent = `${result.score}`;
  $('#log-score').className = result.score >= 80 ? 'good' : result.score >= 50 ? 'ok' : 'bad';
  const delta = $('#log-delta');
  delta.textContent = actual > 0 ? `+${actual} HP` : actual < 0 ? `${actual} HP` : '±0 HP';
  delta.className = `delta ${actual > 0 ? 'up' : actual < 0 ? 'down' : 'even'}`;

  const facts = $('#log-facts');
  facts.innerHTML = '';
  result.facts.forEach((f) => {
    const li = document.createElement('li');
    li.textContent = f;
    facts.appendChild(li);
  });
  if (bonusTrait) {
    const li = document.createElement('li');
    li.className = 'gift';
    li.textContent = `The station gave us ${bonusTrait.name}: ${bonusTrait.effect}`;
    facts.appendChild(li);
  }

  const cont = $('#btn-log-continue');
  if (state.hp <= 0) {
    cont.textContent = 'Uh oh...';
    cont.onclick = () => finaleLost();
  } else {
    cont.textContent = state.index === LEVELS.length - 1 ? 'Step outside' : 'Keep flying';
    cont.onclick = () => { state.index += 1; nextLevel(); };
  }
  show('screen-log');
  speak('#log-dialog', '...');
  cont.focus({ preventScroll: true });

  // Record the beat now, so a fast player who skips ahead still has it.
  const entry = { stage: game.name, outcome: result.facts.join('; '), hp_change: actual, score: result.score };
  state.history.push(entry);

  const beat = await api('/api/beat', {
    character: state.character,
    stage: level.game,
    score: result.score,
    facts: result.facts,
    hp: state.hp,
    maxHp: state.maxHp,
  }).catch(() => ({ headline: game.title, outcome: result.facts.join('. ') + '.' }));

  entry.outcome = beat.outcome;
  if (!$('#screen-log').classList.contains('active')) return;
  $('#log-headline').textContent = beat.headline;
  speak('#log-dialog', beat.outcome);
}

// ======================================================================
// Mid-flight drawing emergencies
// ======================================================================

const repairCanvas = $('#repair-doodle');
const repairCtx = repairCanvas.getContext('2d');
const repairDraw = { color: '#1B2250', size: 6, erasing: false, active: false, last: null, undo: [] };
let currentChallenge = null;

function resetRepairCanvas() {
  repairCtx.fillStyle = '#fff';
  repairCtx.fillRect(0, 0, repairCanvas.width, repairCanvas.height);
  repairDraw.undo = [];
  repairDraw.erasing = false;
  $('#repair-tool-eraser').setAttribute('aria-pressed', 'false');
  $('#btn-repair-submit').disabled = true;
}

function repairPoint(e) {
  const r = repairCanvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * repairCanvas.width) / r.width, y: ((e.clientY - r.top) * repairCanvas.height) / r.height };
}

function repairStrokeTo(p) {
  repairCtx.strokeStyle = repairDraw.erasing ? '#fff' : repairDraw.color;
  repairCtx.lineWidth = repairDraw.erasing ? repairDraw.size * 4 : repairDraw.size;
  repairCtx.lineCap = 'round';
  repairCtx.lineJoin = 'round';
  repairCtx.beginPath();
  repairCtx.moveTo(repairDraw.last.x, repairDraw.last.y);
  repairCtx.lineTo(p.x, p.y);
  repairCtx.stroke();
  repairDraw.last = p;
}

repairCanvas.addEventListener('pointerdown', (e) => {
  repairCanvas.setPointerCapture(e.pointerId);
  repairDraw.undo.push(repairCtx.getImageData(0, 0, repairCanvas.width, repairCanvas.height));
  if (repairDraw.undo.length > 25) repairDraw.undo.shift();
  repairDraw.active = true;
  repairDraw.last = repairPoint(e);
  repairCtx.fillStyle = repairDraw.erasing ? '#fff' : repairDraw.color;
  repairCtx.beginPath();
  repairCtx.arc(repairDraw.last.x, repairDraw.last.y, (repairDraw.erasing ? repairDraw.size * 4 : repairDraw.size) / 2, 0, Math.PI * 2);
  repairCtx.fill();
  $('#btn-repair-submit').disabled = false;
});
repairCanvas.addEventListener('pointermove', (e) => { if (repairDraw.active) repairStrokeTo(repairPoint(e)); });
['pointerup', 'pointercancel', 'pointerleave'].forEach((evt) =>
  repairCanvas.addEventListener(evt, () => { repairDraw.active = false; })
);

document.querySelectorAll('.repair-swatches .swatch').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.repair-swatches .swatch').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    repairDraw.color = btn.dataset.color;
    repairDraw.erasing = false;
    $('#repair-tool-eraser').setAttribute('aria-pressed', 'false');
  })
);
$('#repair-tool-size').addEventListener('click', (e) => {
  const thick = repairDraw.size === 6;
  repairDraw.size = thick ? 14 : 6;
  e.target.setAttribute('aria-pressed', String(thick));
});
$('#repair-tool-eraser').addEventListener('click', (e) => {
  repairDraw.erasing = !repairDraw.erasing;
  e.target.setAttribute('aria-pressed', String(repairDraw.erasing));
});
$('#repair-tool-undo').addEventListener('click', () => {
  const prev = repairDraw.undo.pop();
  if (prev) repairCtx.putImageData(prev, 0, 0);
  $('#btn-repair-submit').disabled = repairDraw.undo.length === 0;
});
$('#repair-tool-clear').addEventListener('click', resetRepairCanvas);

function showRepairChallenge(challenge) {
  currentChallenge = challenge;
  resetRepairCanvas();
  $('#repair-title').textContent = challenge.title;
  $('#repair-result').hidden = true;
  $('#btn-repair-submit').hidden = false;
  $('#btn-repair-continue').hidden = true;
  showError('#repair-error', '');
  state.progress = LEVELS[state.index].progress;
  show('screen-repair');
  speak('#repair-dialog', challenge.line);
}

async function submitRepair() {
  const challenge = currentChallenge;
  $('#loading-text').textContent = 'Handing over your invention…';
  show('screen-loading');
  try {
    const result = await api('/api/repair', {
      image: repairCanvas.toDataURL('image/png').split(',')[1],
      challenge,
      character: state.character,
      hp: state.hp,
      maxHp: state.maxHp,
      history: state.history.slice(-6),
    });
    const before = state.hp;
    state.hp = Math.max(0, Math.min(state.maxHp, state.hp + result.hp_change));
    const actual = state.hp - before;
    state.history.push({ stage: 'Emergency sketch', outcome: result.outcome, hp_change: actual, score: result.score });
    $('#repair-object').textContent = result.object;
    $('#repair-score').textContent = `${result.score}`;
    $('#repair-score').className = result.score >= 80 ? 'good' : result.score >= 50 ? 'ok' : 'bad';
    const delta = $('#repair-delta');
    delta.textContent = actual > 0 ? `+${actual} HP` : actual < 0 ? `${actual} HP` : '±0 HP';
    delta.className = `delta ${actual > 0 ? 'up' : actual < 0 ? 'down' : 'even'}`;
    $('#repair-result').hidden = false;
    $('#btn-repair-submit').hidden = true;
    $('#btn-repair-continue').hidden = false;
    show('screen-repair');
    speak('#repair-dialog', result.outcome);
    $('#btn-repair-continue').focus({ preventScroll: true });
  } catch (err) {
    console.error(err);
    show('screen-repair');
    showError('#repair-error', 'That did not reach them. Please hand your invention over again.');
  }
}

$('#btn-repair-submit').addEventListener('click', submitRepair);
$('#btn-repair-continue').addEventListener('click', () => {
  if (state.hp <= 0) return finaleLost();
  state.index += 1;
  nextLevel();
});

// ======================================================================
// The end: the moon, the thank-you, the view back home
// ======================================================================

function resetFinale() {
  stopScene();
  $('#finale-dialog').hidden = true;
  $('#finale-actions').hidden = true;
  $('#finale-stats').hidden = true;
  show('screen-finale');
  return R.makeScreen($('#finale-canvas'));
}

async function finaleLanded() {
  const scene = CUTSCENES.finale({ scr: resetFinale(), sprites: state.sprites });
  currentScene = scene;
  await scene.ready;
  if (currentScene !== scene) return;
  await speak('#finale-dialog', FINAL_LINE, { wait: true, auto: 5000 });
  if (currentScene !== scene) return;
  $('#finale-dialog').hidden = true;
  scene.cue('view');
  await scene.ended;
  if (currentScene !== scene) return;
  const best = state.scores.length ? Math.max(...state.scores) : 0;
  const n = state.scores.length;
  $('#finale-stats').textContent = `${n} level${n === 1 ? '' : 's'} flown · ${state.hp}/${state.maxHp} HP left · best score ${best}`;
  $('#finale-stats').hidden = false;
  $('#btn-again').textContent = 'Fly again';
  $('#finale-actions').hidden = false;
  $('#btn-again').focus({ preventScroll: true });
}

async function finaleLost() {
  const scene = CUTSCENES.lost({ scr: resetFinale(), sprites: state.sprites });
  currentScene = scene;
  await scene.ready;
  if (currentScene !== scene) return;
  await speak('#finale-dialog', "Oof... I'm okay. Can we try again? I still really want to see the moon.");
  $('#btn-again').textContent = 'Try again';
  $('#finale-actions').hidden = false;
  $('#btn-again').focus({ preventScroll: true });
}

$('#btn-again').addEventListener('click', startJourney);
$('#btn-new').addEventListener('click', () => {
  stopScene();
  resetCanvas();
  state.character = null;
  show('screen-draw');
});

// ======================================================================
// Start up
// ======================================================================

(function drawTitleMoon() {
  const s = R.makeScreen($('#title-moon'), 24, 24);
  R.disc(s, 12, 12, 11, P.black);
  R.disc(s, 12, 12, 10, P.yellow);
  R.disc(s, 8, 9, 3, P.orange);
  R.disc(s, 15, 15, 3, P.orange);
  R.disc(s, 16, 7, 1, P.orange);
})();

resetCanvas();
buildTraitRows();
updatePoints();

fetch('/api/status')
  .then((r) => r.json())
  .then((s) => {
    $('#mode-note').textContent = s.demo
      ? 'Demo mode: no API key is set, so characters and their lines come from a built-in list. Add a key to .env to turn on the AI.'
      : `AI provider: ${s.provider}`;
  })
  .catch(() => {});
