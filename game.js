// Fly Me to the Moon: game logic
// Screens: draw -> (manual) -> card -> journey -> ending

const $ = (sel) => document.querySelector(sel);

// ---------- Game settings: tweak these freely ----------

const STAGES = [
  { id: 'launch', name: 'Launch pad', blurb: 'getting off the ground' },
  { id: 'sky', name: 'Up through the sky', blurb: 'clouds, birds, and weather' },
  { id: 'space', name: 'Deep space', blurb: 'asteroids and strange company' },
  { id: 'landing', name: 'Lunar landing', blurb: 'the final descent and touchdown' },
];
const EVENTS_PER_STAGE = 2;
const TOTAL_EVENTS = STAGES.length * EVENTS_PER_STAGE;

const POINT_BUDGET = 6;
const BASE_HP = 50;
const HP_PER_POINT = 25;

// ---------- Game state ----------

const state = {
  doodle: null,       // data URL of the drawing
  character: null,    // { name, hp, personality, intro, traits: [{ name, kind, effect, inspiredBy }] }
  maxHp: 0,
  hp: 0,
  step: 0,            // index of the current event, 0..TOTAL_EVENTS-1
  history: [],        // [{ stage, scene, choice, outcome, hp_change, trait_used }]
  progress: 0,        // 0..1 along the route
};

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

document.querySelectorAll('.swatch').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach((b) => b.classList.remove('active'));
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
  g.strokeStyle = '#1B2250'; g.lineWidth = 6; g.lineCap = 'round';
  g.beginPath(); g.arc(120, 85, 42, 0, Math.PI * 2); g.stroke();              // helmet
  g.fillStyle = '#A9B1E3'; g.beginPath(); g.ellipse(120, 85, 26, 18, 0, 0, Math.PI * 2); g.fill(); // visor
  g.beginPath(); g.moveTo(120, 127); g.lineTo(120, 180);                       // body
  g.moveTo(120, 145); g.lineTo(85, 160); g.moveTo(120, 145); g.lineTo(155, 125); // arms
  g.moveTo(120, 180); g.lineTo(95, 215); g.moveTo(120, 180); g.lineTo(145, 215); // legs
  g.stroke();
  return c.toDataURL('image/png');
}

// ======================================================================
// Character creation: AI
// ======================================================================

async function generateCharacter() {
  state.doodle = canvas.toDataURL('image/png');
  showError('#draw-error', '');
  $('#loading-text').textContent = 'Studying your drawing…';
  show('screen-loading');
  try {
    const character = await api('/api/character', { image: state.doodle.split(',')[1] });
    setCharacter(character);
    renderCard();
    show('screen-card');
  } catch (err) {
    console.error(err);
    show('screen-draw');
    showError('#draw-error', 'The game server did not respond. Check that node server.js is still running, then try again.');
  }
}

$('#btn-ai').addEventListener('click', generateCharacter);
$('#btn-reroll').addEventListener('click', () => {
  // Manual characters have nothing to re-roll, so send them to the drawing instead
  if (state.character?.manual) return show('screen-manual');
  generateCharacter();
});
$('#btn-redraw').addEventListener('click', () => show('screen-draw'));

function setCharacter(c) {
  state.character = c;
  state.maxHp = c.hp;
}

function renderCard() {
  const c = state.character;
  $('#card-img').src = state.doodle;
  $('#card-name').textContent = c.name;
  $('#card-personality').textContent = c.personality;
  $('#card-hp').textContent = c.hp;
  $('#card-intro').textContent = c.intro || '';
  $('#btn-reroll').textContent = c.manual ? 'Edit stats' : 'Try another take';
  const list = $('#card-traits');
  list.innerHTML = '';
  c.traits.forEach((t) => {
    const li = document.createElement('li');
    li.className = t.kind;
    li.innerHTML = `<strong></strong><span class="kind"></span>${t.inspiredBy ? '<span class="seen"></span>' : ''}`;
    li.querySelector('strong').textContent = t.name;
    li.querySelector('.kind').textContent = `${t.kind === 'weakness' ? 'Weakness' : 'Strength'}${t.effect ? ': ' + t.effect : ''}`;
    if (t.inspiredBy) li.querySelector('.seen').textContent = `Spotted in your drawing: ${t.inspiredBy}`;
    list.appendChild(li);
  });
}

// ======================================================================
// Character creation: manual, with point-buy
// ======================================================================

function buildTraitRows() {
  const wrap = $('#trait-rows');
  wrap.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const row = document.createElement('div');
    row.className = 'trait-row';
    row.innerHTML = `
      <input class="t-name" maxlength="40" aria-label="Trait ${i + 1} name" placeholder="${['Rocket boots', 'Talks to birds', 'Scared of the dark'][i]}" />
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
    .map((row) => ({ name: row.querySelector('.t-name').value.trim(), kind: row.querySelector('.t-kind').value }))
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
  showError('#manual-error', left < 0 ? `You're ${-left} point${left === -1 ? '' : 's'} over budget. Lower your HP or swap a strength for a weakness.` : '');
}

$('#m-hp').addEventListener('input', updatePoints);
$('#m-name').addEventListener('input', updatePoints);

$('#btn-manual').addEventListener('click', () => { updatePoints(); show('screen-manual'); });
$('#btn-manual-back').addEventListener('click', () => show('screen-draw'));

$('#manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#m-name').value.trim();
  const personality = $('#m-personality').value.trim();
  if (!name || !personality) return showError('#manual-error', 'Give your astronaut a name and a personality.');
  if (pointsLeft() < 0) return updatePoints();

  const hp = BASE_HP + Number($('#m-hp').value) * HP_PER_POINT;
  setCharacter({
    manual: true,
    name,
    personality,
    hp,
    intro: `${name} is ${personality}, and absolutely determined to reach the moon.`,
    traits: readManualTraits().map((t) => ({ ...t, effect: '', inspiredBy: '' })),
  });
  state.doodle = hasDrawing() ? canvas.toDataURL('image/png') : defaultDoodle();
  renderCard();
  show('screen-card');
});

// ======================================================================
// Journey
// ======================================================================

const route = $('#route');
const routeDone = $('#route-done');
const routeLength = route.getTotalLength();
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function drawStageMarks() {
  const g = $('#stage-marks');
  g.innerHTML = '';
  for (let i = 1; i < STAGES.length; i++) {
    const p = route.getPointAtLength((routeLength * i) / STAGES.length);
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    mark.setAttribute('cx', p.x);
    mark.setAttribute('cy', p.y);
    mark.setAttribute('r', 6);
    mark.setAttribute('class', 'stage-mark');
    mark.dataset.at = i / STAGES.length;
    g.appendChild(mark);
  }
}

function setRider(fraction) {
  const p = route.getPointAtLength(routeLength * fraction);
  $('#rider').setAttribute('transform', `translate(${p.x} ${p.y})`);
  routeDone.style.strokeDasharray = `${routeLength * fraction} ${routeLength}`;
  document.querySelectorAll('.stage-mark').forEach((m) => m.classList.toggle('passed', fraction >= Number(m.dataset.at)));
}

function moveRider(to) {
  const from = state.progress;
  state.progress = to;
  if (reduceMotion) return setRider(to);
  const start = performance.now();
  const duration = 1100;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    setRider(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderHud() {
  const pct = Math.max(0, (state.hp / state.maxHp) * 100);
  $('#hp-fill').style.width = `${pct}%`;
  $('#hp-fill').classList.toggle('low', pct <= 30);
  $('#hp-text').textContent = `HP ${state.hp} / ${state.maxHp}`;
  $('#hp-meter').setAttribute('aria-valuemax', state.maxHp);
  $('#hp-meter').setAttribute('aria-valuenow', state.hp);
  $('#hud-name').textContent = state.character.name;
  const stageIndex = Math.min(STAGES.length - 1, Math.floor(state.step / EVENTS_PER_STAGE));
  $('#hud-stage').textContent = `Stage ${stageIndex + 1} of ${STAGES.length}: ${STAGES[stageIndex].name}`;
}

function startJourney() {
  state.hp = state.maxHp;
  state.step = 0;
  state.history = [];
  state.progress = 0;
  $('#rider-img').setAttribute('href', state.doodle);
  $('.rider-inner').classList.remove('adrift', 'landed');
  drawStageMarks();
  setRider(0);
  renderHud();
  show('screen-journey');
  showEvent(requestEvent(0));
}

$('#btn-launch').addEventListener('click', startJourney);

function requestEvent(step) {
  const stageIndex = Math.floor(step / EVENTS_PER_STAGE);
  const stage = STAGES[stageIndex];
  return api('/api/event', {
    character: state.character,
    hp: state.hp,
    maxHp: state.maxHp,
    stage,
    eventInStage: (step % EVENTS_PER_STAGE) + 1,
    eventsPerStage: EVENTS_PER_STAGE,
    isFinal: step === TOTAL_EVENTS - 1,
    history: state.history.slice(-6),
  }).catch(() => offlineEvent(stage));
}

// Last-resort event if the server itself can't be reached
function offlineEvent(stage) {
  return {
    scene: `Static crackles over the radio somewhere in the ${stage.name.toLowerCase()}. You're on your own for a moment.`,
    choices: [
      { text: 'Stay calm and steer', trait_used: null, hp_change: 0, outcome: 'Steady hands. The static clears.' },
      { text: 'Bang on the radio', trait_used: null, hp_change: -10, outcome: 'Ouch. It works though.' },
      { text: 'Take a snack break', trait_used: null, hp_change: 5, outcome: 'You feel a little better.' },
    ],
  };
}

async function showEvent(eventPromise) {
  const scene = $('#event-scene');
  scene.textContent = 'Charting the next stretch…';
  scene.classList.add('waiting');
  $('#event-choices').innerHTML = '';
  $('#event-outcome').hidden = true;
  $('#btn-continue').hidden = true;

  const ev = await eventPromise;
  scene.classList.remove('waiting');
  scene.textContent = ev.scene;

  ev.choices.forEach((ch, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.innerHTML = '<span class="choice-text"></span>';
    btn.querySelector('.choice-text').textContent = ch.text;
    if (ch.trait_used) {
      const trait = state.character.traits.find((t) => t.name === ch.trait_used);
      const tag = document.createElement('span');
      tag.className = `trait-tag ${trait?.kind || ''}`;
      tag.textContent = ch.trait_used;
      btn.appendChild(tag);
    }
    btn.addEventListener('click', () => choose(ev, i));
    $('#event-choices').appendChild(btn);
  });
  $('#event-choices .choice')?.focus({ preventScroll: true });
}

function choose(ev, index) {
  const ch = ev.choices[index];
  document.querySelectorAll('.choice').forEach((b, i) => {
    b.disabled = true;
    b.classList.toggle('picked', i === index);
  });

  const before = state.hp;
  state.hp = Math.max(0, Math.min(state.maxHp, state.hp + ch.hp_change));
  const actual = state.hp - before;
  const stage = STAGES[Math.floor(state.step / EVENTS_PER_STAGE)];
  state.history.push({ stage: stage.name, scene: ev.scene, choice: ch.text, outcome: ch.outcome, hp_change: actual, trait_used: ch.trait_used });

  const delta = $('#outcome-delta');
  delta.textContent = actual > 0 ? `+${actual}` : actual < 0 ? `${actual}` : '±0';
  delta.className = `delta ${actual > 0 ? 'up' : actual < 0 ? 'down' : 'even'}`;
  $('#outcome-text').textContent = ch.outcome;
  $('#event-outcome').hidden = false;
  renderHud();

  const cont = $('#btn-continue');
  cont.hidden = false;

  if (state.hp <= 0) {
    $('.rider-inner').classList.add('adrift');
    cont.textContent = 'See what happened';
    cont.onclick = () => finish('lost');
  } else if (state.step === TOTAL_EVENTS - 1) {
    moveRider(1);
    $('.rider-inner').classList.add('landed');
    cont.textContent = 'Read the mission report';
    cont.onclick = () => finish('landed');
  } else {
    moveRider((state.step + 1) / TOTAL_EVENTS);
    // Start fetching the next event now, while the player reads the outcome
    const next = requestEvent(state.step + 1);
    cont.textContent = 'Keep flying';
    cont.onclick = () => {
      state.step += 1;
      renderHud();
      showEvent(next);
    };
  }
  cont.focus({ preventScroll: true });
}

// ======================================================================
// Ending
// ======================================================================

async function finish(outcome) {
  $('#loading-text').textContent = 'Writing the mission report…';
  show('screen-loading');

  const payload = { character: state.character, outcome, hp: state.hp, maxHp: state.maxHp, history: state.history };
  const ending = await api('/api/ending', payload).catch(() => ({
    stamp: outcome === 'landed' ? 'Landed' : 'Lost in space',
    title: outcome === 'landed' ? `${state.character.name} reached the moon` : `${state.character.name} drifted off course`,
    report: 'Mission control lost the transcript, but the adventure definitely happened.',
  }));

  $('#ending-img').src = state.doodle;
  const stamp = $('#ending-stamp');
  stamp.textContent = ending.stamp;
  stamp.classList.toggle('lost', outcome !== 'landed');
  $('#ending-title').textContent = ending.title;
  $('#ending-report').textContent = ending.report;
  $('#stat-events').textContent = `${state.history.length} of ${TOTAL_EVENTS}`;
  $('#stat-hp').textContent = `${state.hp} / ${state.maxHp}`;
  $('#stat-traits').textContent = state.history.filter((h) => h.trait_used).length;
  show('screen-ending');
}

$('#btn-again').addEventListener('click', startJourney);
$('#btn-new').addEventListener('click', () => {
  resetCanvas();
  state.character = null;
  show('screen-draw');
});

// ======================================================================
// Start up
// ======================================================================

resetCanvas();
buildTraitRows();
updatePoints();

fetch('/api/status')
  .then((r) => r.json())
  .then((s) => {
    $('#mode-note').textContent = s.demo
      ? 'Demo mode: no API key is set, so characters and events come from a built-in list. Add a key to .env to turn on the AI.'
      : `AI provider: ${s.provider}`;
  })
  .catch(() => {});
