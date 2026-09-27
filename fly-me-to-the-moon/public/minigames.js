// The levels and the cutscenes, all drawn in the retro renderer (retro.js).
//
// The player's doodle is always on screen: they are not the pilot, they are
// the one steering their drawing. Each level reads the character's trait powers,
// so a nimble doodle really does handle better and a wobbly one really does drift.
//
// Every character also brings their own world (themes.js): what they ride, what
// gets in their way, what they collect, who sings to them. The mechanics are
// shared; the story on screen is theirs.
//
// A level is { id, name, axis, hint, brief(world), run(ctx) }. brief() returns the
// themed { title, line, objective }; run() resolves with { score 0..100, facts }.
// ctx = { scr, input, stats, character, sprites, world }

(function (global) {
  const { P, W, H, F, clamp, lerp } = R;

  // ---------- shared bits ----------

  function hud(scr, left, right) {
    R.rect(scr, 0, 0, W, 9, P.black);
    R.text(scr, left, 3, 2, P.white);
    if (right) R.text(scr, right, W - 3, 2, P.yellow, { align: 'right' });
  }

  function progressBar(scr, pct) {
    R.rect(scr, 0, 9, W, 2, P.navy);
    R.rect(scr, 0, 9, Math.round(W * clamp(pct, 0, 1)), 2, P.yellow);
  }

  // The character's little in-level reactions ("OUCH!", "YAY!").
  function makeSay() {
    let line = '', left = 0;
    return {
      set(text, secs) { line = text; left = secs || 0.9; },
      tick(dt) { left = Math.max(0, left - dt); },
      draw(scr, x, y) { if (left > 0) R.bubble(scr, x, y, line); },
    };
  }

  function burst(list, x, y, n, colors, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (speed || 40) * (0.4 + Math.random() * 0.8);
      list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.5, c: colors[i % colors.length], g: 0 });
    }
  }

  function particles(scr, list, dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      R.rect(scr, p.x, p.y, p.size || 1, p.size || 1, p.c);
    }
  }

  const bobOf = (t, speed) => Math.round(Math.sin(t * (speed || 6)));
  const worldOf = (ctx) => ctx.world || THEMES.DEFAULT_WORLD;
  // Upper-cases a HUD title and, if it's too long, trims it at a word break.
  const upper = (str, max) => {
    const s = String(str).toUpperCase();
    if (s.length <= max) return s;
    const cut = s.slice(0, max + 1).lastIndexOf(' ');
    return cut > max / 2 ? s.slice(0, cut) : s.slice(0, max);
  };

  function seeded(seed) {
    let n = seed || 7;
    return () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  }

  function moonDisc(scr, x, y, r) {
    R.disc(scr, x, y, r + 1, P.black);
    R.disc(scr, x, y, r, P.yellow);
    R.disc(scr, x - r * 0.35, y - r * 0.25, r * 0.22, P.orange);
    R.disc(scr, x + r * 0.3, y + r * 0.35, r * 0.28, P.orange);
    R.disc(scr, x + r * 0.4, y - r * 0.4, r * 0.12, P.orange);
  }

  // ---------------------------------------------------------------------
  // Wobble launch. Keep the homemade ship upright while it rattles apart.
  // ---------------------------------------------------------------------

  const wobble = {
    id: 'wobble',
    name: 'Wobble launch',
    axis: [],
    hint: 'Move left and right to stop the rocket from tipping over.',
    brief: (w) => ({
      title: 'Wobble launch',
      line: 'This rocket has two settings: WOBBLE and MORE WOBBLE. Please balance me!',
      objective: `Keep ${w.liftoff.vehicle.name} upright until it escapes Earth.`,
    }),
    run(ctx) {
      const { scr, input, sprites } = ctx;
      const w = worldOf(ctx);
      const stars = R.makeStars(45, 10, 112);
      const say = makeSay();
      const parts = [];
      const duration = 11;
      const s = { angle: 0, av: 0, safe: 0, bonks: 0, lastSecond: -1 };
      say.set('WHY IS IT WIGGLING?', 1.8);

      return R.loop((dt, t) => {
        const control = input.axis().x;
        const wind = Math.sin(t * 1.7) + Math.sin(t * 3.9) * 0.45;
        s.av += (s.angle * 1.7 + wind * 0.42 - control * 2.2) * dt;
        s.av *= Math.pow(0.96, dt * 60);
        s.angle += s.av * dt;
        if (Math.abs(s.angle) < 0.25) s.safe += dt;
        if (Math.abs(s.angle) > 0.78) {
          s.bonks += 1;
          s.angle = Math.sign(s.angle) * 0.42;
          s.av *= -0.45;
          say.set('WOBBLE BONK!', 0.9);
          burst(parts, 96, 106, 14, [P.yellow, P.orange, P.white], 45);
        }
        const second = Math.floor(t);
        if (second !== s.lastSecond && second > 1 && second < duration && Math.random() < 0.45) {
          s.lastSecond = second;
          say.set(['HOLD MY SOCKS!', 'LEFT! NO, RIGHT!', 'I REGRET PHYSICS!'][second % 3], 0.9);
        }
        input.clear();
        say.tick(dt);

        R.bands(scr, 0, H, [P.black, P.navy, P.plum, P.orange]);
        R.drawStars(scr, stars, t, t * 22);
        moonDisc(scr, 164, 27, 10);
        R.rect(scr, 0, 116, W, 28, P.forest);
        R.rect(scr, 0, 116, W, 2, P.green);

        scr.g.save();
        scr.g.translate(96, 110);
        scr.g.rotate(s.angle);
        scr.g.translate(-96, -110);
        const seat = THEMES.vehicle(scr, w.liftoff.vehicle, 96, 112, 3);
        R.sprite(scr, sprites.main, 96, seat + bobOf(t, 11));
        R.poly(scr, [{ x: 88, y: 116 }, { x: 104, y: 116 }, { x: 96, y: 137 }], P.orange);
        R.poly(scr, [{ x: 92, y: 116 }, { x: 100, y: 116 }, { x: 96, y: 130 }], P.yellow);
        scr.g.restore();

        particles(scr, parts, dt);
        say.draw(scr, 96, 48);
        hud(scr, 'WOBBLE LAUNCH', `${Math.max(0, Math.ceil(duration - t))}s`);
        progressBar(scr, t / duration);
        R.rect(scr, 44, 132, 104, 6, P.slate);
        R.rect(scr, 94, 130, 4, 10, P.white);
        R.rect(scr, 94 + clamp(s.angle / 0.78, -1, 1) * 48, 130, 4, 10, Math.abs(s.angle) < 0.3 ? P.green : P.red);

        if (t >= duration) {
          const score = Math.round(clamp((s.safe / duration) * 115 - s.bonks * 4, 0, 100));
          return { score, facts: [`kept the rocket steady for ${Math.round(s.safe)} seconds`, `${s.bonks} giant wobble bonk${s.bonks === 1 ? '' : 's'}`, 'escaped Earth with all important socks aboard'] };
        }
        return null;
      });
    },
  };

  // ---------------------------------------------------------------------
  // Orbit painter. Draw one route, then watch the doodle fly along it.
  // ---------------------------------------------------------------------

  const orbit = {
    id: 'orbit',
    name: 'Orbit painter',
    axis: [],
    hint: 'Hold and draw a path through the stars to the moon. Release to fly it.',
    brief: () => ({
      title: 'Orbit painter',
      line: 'Space has no roads. Rude! Draw me one through the shiny rings.',
      objective: 'Draw a safe path through the three star rings and end at the moon.',
    }),
    run(ctx) {
      const { scr, input, sprites } = ctx;
      const stars = R.makeStars(70, 10, H);
      const planets = [
        { x: 69, y: 91, r: 13, c: P.red },
        { x: 121, y: 54, r: 11, c: P.blue },
      ];
      const rings = [{ x: 48, y: 54 }, { x: 100, y: 112 }, { x: 148, y: 72 }];
      const say = makeSay();
      const s = { phase: 'draw', path: [{ x: 20, y: 120 }], wasDown: false, flight: 0, hits: 0, got: new Set(), hit: new Set(), endT: 0 };
      say.set('DRAW ME A ROAD!', 1.6);

      const resample = (pts) => {
        const out = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          const n = Math.max(1, Math.ceil(d / 3));
          for (let j = 1; j <= n; j++) out.push({ x: lerp(a.x, b.x, j / n), y: lerp(a.y, b.y, j / n) });
        }
        return out;
      };

      return R.loop((dt, t) => {
        if (s.phase === 'draw') {
          if (input.down) {
            const p = { x: clamp(input.x, 8, W - 8), y: clamp(input.y, 14, H - 8) };
            const last = s.path[s.path.length - 1];
            if (Math.hypot(p.x - last.x, p.y - last.y) > 2) s.path.push(p);
          }
          if (s.wasDown && !input.down && s.path.length > 2) {
            s.path = resample(s.path);
            s.phase = 'fly';
            say.set('I TRUST THIS LINE!', 1.4);
          }
          s.wasDown = input.down;
        } else {
          s.flight += dt * 34;
          const idx = Math.min(s.path.length - 1, Math.floor(s.flight));
          const p = s.path[idx];
          planets.forEach((pl, i) => {
            if (!s.hit.has(i) && Math.hypot(p.x - pl.x, p.y - pl.y) < pl.r + 5) {
              s.hit.add(i); s.hits += 1; say.set('PLANET BONK!', 0.9);
            }
          });
          rings.forEach((ring, i) => {
            if (!s.got.has(i) && Math.hypot(p.x - ring.x, p.y - ring.y) < 11) {
              s.got.add(i); say.set('DING!', 0.6);
            }
          });
          if (idx >= s.path.length - 1) s.endT += dt;
        }
        input.clear();
        say.tick(dt);

        R.bands(scr, 0, H, [P.black, P.black, P.navy, P.plum]);
        R.drawStars(scr, stars, t);
        planets.forEach((pl) => {
          R.disc(scr, pl.x, pl.y, pl.r + 1, P.black);
          R.disc(scr, pl.x, pl.y, pl.r, pl.c);
          R.oval(scr, pl.x, pl.y, pl.r + 7, 3, P.silver);
        });
        rings.forEach((ring, i) => {
          R.ring(scr, ring.x, ring.y, 8 + Math.sin(t * 4 + i), s.got.has(i) ? P.green : P.yellow);
          R.text(scr, '+', ring.x, ring.y - 3, P.white, { align: 'center' });
        });
        moonDisc(scr, 174, 24, 12);
        for (let i = 1; i < s.path.length; i++) R.line(scr, s.path[i - 1].x, s.path[i - 1].y, s.path[i].x, s.path[i].y, s.phase === 'draw' ? P.pink : P.lavender);

        const pos = s.phase === 'fly' ? s.path[Math.min(s.path.length - 1, Math.floor(s.flight))] : s.path[0];
        R.sprite(scr, sprites.main, pos.x, pos.y, { scale: 1.2 });
        say.draw(scr, pos.x, pos.y - 18);
        hud(scr, 'ORBIT PAINTER', s.phase === 'draw' ? 'DRAW + RELEASE' : `${s.got.size}/3 RINGS`);

        if (s.endT > 1.2) {
          const end = s.path[s.path.length - 1];
          const moonClose = Math.hypot(end.x - 174, end.y - 24) < 28;
          const score = Math.round(clamp(s.got.size * 25 + (moonClose ? 30 : 5) - s.hits * 18, 0, 100));
          return { score, facts: [`flew through ${s.got.size} of 3 star rings`, `${s.hits} planet bonk${s.hits === 1 ? '' : 's'}`, moonClose ? 'the path reached the moon' : 'the path ended somewhere moon-ish'] };
        }
        return null;
      });
    },
  };

  // ---------------------------------------------------------------------
  // 1. Lift-off. Side view of the pad. Stop the spark in the gold, 3 times.
  //    Steady widens the gold and slows the spark. Lucky forgives one miss.
  // ---------------------------------------------------------------------

  const liftoff = {
    id: 'liftoff',
    name: 'Lift-off',
    axis: ['steady', 'lucky'],
    hint: 'Tap the screen (or press Space) when the red spark is in the gold.',
    brief: (w) => ({
      title: w.liftoff.title,
      line: w.liftoff.line,
      objective: `Light all three stages of ${w.liftoff.vehicle.name}. Stop the spark inside the gold zone.`,
    }),
    run(ctx) {
      const { scr, input, stats, sprites } = ctx;
      const w = worldOf(ctx);
      const steady = stats.steady || 0;
      const band = clamp(0.11 + 0.035 * steady, 0.05, 0.25);
      let retries = (stats.lucky || 0) > 0 ? 1 : 0;
      const stars = R.makeStars(50, 12, 116);
      const say = makeSay();
      const parts = [];
      const s = { stage: 0, results: [], phase: 'aim', needleT: Math.random() * 3, center: 0.5, speed: 2, lift: 0, scroll: 0, vel: 0, shake: 0, usedLuck: false };
      const next = () => {
        s.center = 0.25 + Math.random() * 0.5;
        s.speed = (2.1 + s.stage * 0.4) * (1 - 0.08 * steady);
      };
      next();
      say.set('LIGHT ME UP!', 1.6);

      return R.loop((dt, t) => {
        say.tick(dt);
        s.shake = Math.max(0, s.shake - dt * 3);
        s.needleT += dt;
        const needle = (Math.sin(s.needleT * s.speed) + 1) / 2;

        if (s.phase === 'aim' && input.tapped) {
          const acc = clamp(1 - Math.abs(needle - s.center) / (band * 1.7), 0, 1);
          if (acc <= 0 && retries > 0) {
            retries -= 1; s.usedLuck = true;
            say.set('LUCKY! AGAIN!', 1.2);
          } else {
            s.results.push(acc);
            s.stage += 1;
            if (acc > 0.75) say.set(w.voice.yay, 1);
            else if (acc > 0.35) say.set('OKAY...', 1);
            else { say.set(w.voice.ouch, 1); s.shake = 1; }
            burst(parts, 100, 116, 10, [P.silver, P.white, P.slate], 30);
            if (s.stage >= 3) { s.phase = 'lift'; say.set('HERE WE GO!', 2); } else next();
          }
        }
        input.clear();

        if (s.phase === 'lift') {
          s.lift += dt;
          s.vel += dt * 110;
          s.scroll += s.vel * dt;
          if (Math.random() < 0.6) parts.push({ x: 96 + Math.random() * 8, y: 124, vx: (Math.random() - 0.5) * 30, vy: 20 + Math.random() * 20, life: 0.8, c: Math.random() > 0.5 ? P.silver : P.white, size: 2 });
        }

        R.shake(scr, s.shake * 2 + (s.phase === 'lift' ? 1 : 0));
        R.bands(scr, 0, H, [P.black, P.navy, P.navy, P.plum]);
        R.drawStars(scr, stars, t, s.scroll * 0.3);
        moonDisc(scr, 164, 30 + s.scroll * 0.03, 11);

        const gy = 118 + s.scroll;
        if (gy < H) {
          R.rect(scr, 0, gy, W, H - gy + 8, P.forest);
          R.rect(scr, 0, gy, W, 2, P.green);
          for (let x = 0; x < W; x += 12) R.rect(scr, x + ((gy / 3) | 0) % 12, gy + 6, 5, 1, P.green);
          // launch tower
          const tx = 60;
          R.rect(scr, tx - 1, gy - 86, 12, 86, P.black);
          R.rect(scr, tx, gy - 85, 2, 85, P.silver);
          R.rect(scr, tx + 8, gy - 85, 2, 85, P.silver);
          for (let y = gy - 84; y < gy; y += 10) R.line(scr, tx, y, tx + 9, y + 9, P.silver);
          R.rect(scr, tx + 10, gy - 62, 18, 3, P.silver);
          R.rect(scr, 80, gy - 6, 40, 6, P.slate);
          R.rect(scr, 80, gy - 6, 40, 1, P.silver);
        }

        const seat = THEMES.vehicle(scr, w.liftoff.vehicle, 100, 112, Math.min(3, s.stage));
        R.sprite(scr, sprites.main, 100, seat + bobOf(t, s.phase === 'lift' ? 14 : 5));
        particles(scr, parts, dt);
        say.draw(scr, 100, 56);

        if (s.phase === 'aim') {
          R.rect(scr, 12, 122, 168, 20, P.black);
          R.rect(scr, 12, 122, 168, 1, P.white);
          R.text(scr, `STAGE ${s.stage + 1} OF 3`, 18, 125, P.white);
          const bx = 18, bw = 156, by = 132;
          R.rect(scr, bx, by, bw, 6, P.slate);
          R.rect(scr, bx + (s.center - band) * bw, by, band * 2 * bw, 6, P.yellow);
          R.rect(scr, bx + needle * bw - 1, by - 2, 3, 10, P.red);
        }
        hud(scr, upper(w.liftoff.title, 26), `${Math.min(3, s.stage)}/3 LIT`);
        R.shake(scr, 0);

        if (s.phase === 'lift' && s.lift > 2.6) {
          const avg = s.results.reduce((a, b) => a + b, 0) / s.results.length;
          const clean = s.results.filter((r) => r > 0.75).length;
          const bad = s.results.filter((r) => r < 0.35).length;
          const facts = [`${clean} of 3 engine stages lit perfectly`];
          if (bad) facts.push(`${bad} spark${bad > 1 ? 's' : ''} fizzled and shook ${w.liftoff.vehicle.name}`);
          if (s.usedLuck) facts.push('a lucky second try saved one spark');
          facts.push(`${w.liftoff.vehicle.name} still left the ground`);
          return { score: Math.round(avg * 100), facts };
        }
        return null;
      });
    },
  };

  // ---------------------------------------------------------------------
  // Behind-the-character runner, shared by the sky and the asteroid belt.
  // You see your doodle from behind the camera; things rush at it from the
  // horizon across a scrolling arcade floor.
  // ---------------------------------------------------------------------

  function runner(ctx, cfg) {
    const { scr, input, stats, sprites } = ctx;
    const agile = stats.agile || 0;
    const HOR = 52, FLOOR = 44;
    const handling = clamp(5 * (1 + 0.3 * agile), 2, 12);
    const charW = 12 * (1 - 0.06 * agile);
    const SCALE = 1.25; // your drawing, a little bigger than life
    const rnd = seeded(cfg.seed);
    const say = makeSay();
    const parts = [];
    const s = { z: 0, cx: 0, cy: 10, hits: 0, got: 0, zapped: 0, objs: [], bolts: [], nextBad: 260, nextGood: 420, hitT: 0, fireT: 0 };
    say.set(cfg.startLine, 1.6);

    return R.loop((dt, t) => {
      say.tick(dt);
      s.hitT = Math.max(0, s.hitT - dt);
      s.fireT -= dt;
      s.z += cfg.speed * dt;

      const ax = input.axis();
      s.cx = lerp(s.cx, ax.x * 74, clamp(handling * dt, 0, 1));
      s.cy = lerp(s.cy, clamp(ax.y, -1, 1) * 22 + 16, clamp(handling * dt, 0, 1));
      if (cfg.fire && input.tapped && s.fireT <= 0) {
        s.bolts.push({ x: s.cx, y: s.cy - 20, z: s.z + F });
        s.fireT = 0.15;
      }
      input.clear();

      while (s.nextBad < s.z + 900) {
        s.objs.push({ kind: 'bad', x: (rnd() - 0.5) * 260, y: -40 + rnd() * 72, z: s.nextBad, r: cfg.badR * (0.7 + rnd() * 0.6), seed: (rnd() * 999) | 0 });
        s.nextBad += cfg.badGap * (0.7 + rnd() * 0.7);
      }
      while (s.nextGood < s.z + 900) {
        s.objs.push({ kind: 'good', x: (rnd() - 0.5) * 170, y: -30 + rnd() * 56, z: s.nextGood, r: 6 });
        s.nextGood += cfg.goodGap * (0.8 + rnd() * 0.5);
      }

      // zaps travel away from you into the screen
      for (const b of s.bolts) {
        b.z += 720 * dt;
        for (const o of s.objs) {
          if (o.kind !== 'bad' || o.done || b.dead) continue;
          if (Math.abs(o.z - b.z) < 40 && Math.abs(o.x - b.x) < o.r + cfg.boltR && Math.abs(o.y - b.y) < o.r + cfg.boltR) {
            o.done = true; o.gone = true; b.dead = true; s.zapped += 1;
            const p = R.project(o.x, o.y, o.z - s.z, HOR);
            burst(parts, p.x, p.y, 10, [P.orange, P.yellow, P.brown], 50);
          }
        }
      }
      s.bolts = s.bolts.filter((b) => !b.dead && b.z - s.z < 1000);

      // things reaching your doodle
      for (const o of s.objs) {
        if (o.done || o.z - s.z > F) continue;
        o.done = true;
        const hit = Math.abs(o.x - s.cx) < o.r * 0.8 + charW && Math.abs(o.y - (s.cy - 20)) < o.r * 0.8 + 16;
        if (!hit) continue;
        if (o.kind === 'bad') { s.hits += 1; s.hitT = 0.5; say.set(cfg.hitLine, 0.9); }
        else {
          s.got += 1; o.gone = true; say.set(cfg.goodLine, 0.8);
          burst(parts, W / 2 + s.cx, HOR + s.cy - 22, 8, [P.yellow, P.white, P.blue], 40);
        }
      }
      // Anything that has passed your drawing vanishes, so it never hides behind them.
      s.objs = s.objs.filter((o) => o.z - s.z > F - 10 && !o.gone);

      // ---- draw ----
      R.shake(scr, s.hitT > 0 ? 2 : 0);
      const ground = THEMES.FLOORS[cfg.theme.floor] || THEMES.FLOORS.clouds;
      R.bands(scr, 0, HOR, THEMES.SKIES[cfg.theme.sky] || THEMES.SKIES.day);
      if (cfg.decor) cfg.decor(scr, t, HOR, s.z / cfg.distance);
      R.rect(scr, 0, HOR - 1, W, 1, ground.haze);
      R.floor(scr, { horizon: HOR, height: FLOOR, tile: cfg.tile, camZ: s.z, a: ground.a, b: ground.b, haze: ground.haze, grid: ground.grid });

      const items = s.objs.map((o) => ({ d: o.z - s.z, o }));
      for (const b of s.bolts) items.push({ d: b.z - s.z, b });
      items.sort((a, b) => b.d - a.d);
      const drawItem = (it) => {
        if (it.b) {
          const p = R.project(it.b.x, it.b.y, it.d, HOR);
          const k = Math.max(1, Math.round(2 * p.s));
          R.rect(scr, p.x - k, p.y - k, k * 2, k * 2, P.yellow);
          R.rect(scr, p.x - k / 2, p.y - k / 2, k, k, P.white);
          return;
        }
        const p = R.project(it.o.x, it.o.y, it.d, HOR);
        THEMES.icon(scr, it.o.kind === 'bad' ? cfg.theme.bad : cfg.theme.good, p.x, p.y, it.o.r * p.s, t, it.o.seed);
      };
      items.filter((it) => it.d > F).forEach(drawItem);
      const shadowY = HOR + FLOOR;
      R.oval(scr, W / 2 + s.cx, shadowY, 9, 2, P.black);
      const flashing = s.hitT > 0 && ((t * 20) | 0) % 2 === 0;
      R.sprite(scr, sprites.main, W / 2 + s.cx, HOR + s.cy + bobOf(t, 8), { scale: SCALE, flash: flashing, sy: s.hitT > 0 ? 0.85 : 1 });
      items.filter((it) => it.d <= F).forEach(drawItem);
      particles(scr, parts, dt);
      say.draw(scr, W / 2 + s.cx, HOR + s.cy - 46);

      hud(scr, cfg.name, cfg.counter(s));
      progressBar(scr, s.z / cfg.distance);
      R.shake(scr, 0);

      if (s.z >= cfg.distance) {
        return { score: Math.round(clamp(cfg.score(s), 0, 100)), facts: cfg.facts(s) };
      }
      return null;
    });
  }

  // ---------------------------------------------------------------------
  // 2. Sky dash. Agile turns sharper. Lucky scatters more stars.
  // ---------------------------------------------------------------------

  const sky = {
    id: 'sky',
    name: 'Sky dash',
    axis: ['agile', 'lucky'],
    hint: 'Point where you want me to fly (or use the arrow keys).',
    brief: (w) => ({
      title: w.sky.title,
      line: w.sky.line,
      objective: `Steer me around the ${w.sky.bad.name} and grab the ${w.sky.good.name}.`,
    }),
    run(ctx) {
      const lucky = ctx.stats.lucky || 0;
      const w = worldOf(ctx), th = w.sky;
      return runner(ctx, {
        seed: 11,
        theme: th,
        name: upper(th.title, 20),
        speed: 250,
        distance: 3700,
        badR: 16,
        badGap: 105,
        goodGap: clamp(250 - lucky * 55, 120, 420),
        boltR: 0,
        tile: 28,
        startLine: 'HOLD ON TO ME!',
        hitLine: w.voice.ouch,
        goodLine: w.voice.yay,
        counter: (s) => `BONK ${s.hits}  GOT ${s.got}`,
        score: (s) => 100 - s.hits * 9 + s.got * 4,
        facts: (s) => [
          s.hits === 0 ? `dodged every single one of the ${th.bad.name}` : `got bonked by ${s.hits} of the ${th.bad.name}`,
          `grabbed ${s.got} of the ${th.good.name}`,
        ],
      });
    },
  };

  // ---------------------------------------------------------------------
  // 3. Whale song. A three-lane rhythm game. Heart widens the timing window.
  //    Clever slows the notes down so you can read them.
  // ---------------------------------------------------------------------

  const LANE_COLORS = [P.red, P.yellow, P.blue];

  const whale = {
    id: 'whale',
    name: 'Whale song',
    axis: [],
    hint: 'Tap the left, middle or right side (or press 1, 2, 3) as each note hits its ring.',
    brief: (w) => ({
      title: w.whale.title,
      line: w.whale.line,
      objective: `${w.whale.singer.name[0].toUpperCase() + w.whale.singer.name.slice(1)} is singing to us. Help me sing back: hit each note as it lands on its ring.`,
    }),
    run(ctx) {
      const { scr, input, stats, sprites } = ctx;
      const w = worldOf(ctx), th = w.whale;
      const sound = th.sound || 'LA';
      const singWords = [`${sound}!`, sound, `${sound} ${sound}!`, 'OOH!'];
      // This is the one pure arcade beat: everyone gets the same fair timing.
      const heart = 0, clever = 0;
      const total = 8;
      const travel = 2.3 * (1 + 0.15 * clever);
      const win = clamp(0.1 + 0.035 * heart, 0.05, 0.22);
      const stars = R.makeStars(60, 12, H);
      const say = makeSay();
      const parts = [];
      const lane = (i, u) => ({
        x: lerp(W / 2 + (i - 1) * 7, W / 2 + (i - 1) * 46, u),
        y: lerp(54, 100, u),
      });
      const s = { notes: [], spawned: 0, hits: 0, misses: 0, press: [-1, 0], mouth: 0, joy: 0, endT: 0, singT: 0 };
      say.set(`${sound} ${sound}?`, 1.5);

      const judge = (i, t) => {
        s.press = [i, 0.15];
        const live = s.notes.filter((n) => !n.done && Math.abs((t - n.t0) / travel - 1) < win);
        const mine = live.filter((n) => n.lane === i).sort((a, b) => Math.abs((t - a.t0) / travel - 1) - Math.abs((t - b.t0) / travel - 1))[0];
        if (mine) {
          mine.done = true; mine.hit = true; s.hits += 1; s.joy += 1; s.singT = 0.3;
          const p = lane(i, 1);
          burst(parts, p.x, p.y, 8, [LANE_COLORS[i], P.white], 40);
          parts.push({ x: W / 2, y: 104, vx: 0, vy: -70, life: 0.9, c: LANE_COLORS[i], size: 2 });
          say.set(singWords[s.hits % 4], 0.5);
        } else if (live.length) {
          live[0].done = true; s.misses += 1;
          say.set(w.voice.ouch, 0.7);
        }
      };

      return R.loop((dt, t) => {
        say.tick(dt);
        s.mouth = Math.max(0, s.mouth - dt);
        s.singT = Math.max(0, s.singT - dt);
        s.press[1] = Math.max(0, s.press[1] - dt);

        if (s.spawned < total && t > 1.2 + s.spawned * 0.9) {
          s.notes.push({ lane: Math.floor(Math.random() * 3), t0: t, done: false });
          s.spawned += 1;
          s.mouth = 0.25;
        }
        for (const n of s.notes) {
          if (!n.done && (t - n.t0) / travel > 1 + win) { n.done = true; s.misses += 1; say.set('MISSED IT!', 0.7); }
        }

        const keyLanes = { 1: 0, 2: 1, 3: 2, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 1, ArrowRight: 2 };
        for (const k of input.presses) if (k in keyLanes) judge(keyLanes[k], t);
        for (const tap of input.taps) judge(tap.nx < -1 / 3 ? 0 : tap.nx < 1 / 3 ? 1 : 2, t);
        input.clear();

        // ---- draw ----
        R.bands(scr, 0, H, [P.black, P.black, P.navy, P.navy]);
        R.drawStars(scr, stars, t);

        // the singer
        const wx = W / 2 + Math.sin(t * 0.7) * 6, wy = 34 + Math.round(Math.sin(t * 1.3) * 2);
        THEMES.singer(scr, th.singer, wx, wy, s.mouth > 0, t);
        if (s.joy > 0 && ((t * 4) | 0) % 2 === 0) {
          for (let i = 0; i < Math.min(6, s.joy); i++) R.rect(scr, wx - 30 + i * 11, 14 + (i % 2) * 3, 2, 2, i % 2 ? P.white : P.pink);
        }

        // lanes and their rings
        for (let i = 0; i < 3; i++) {
          for (let u = 0; u < 1; u += 0.04) { const p = lane(i, u); R.px(scr, p.x, p.y, LANE_COLORS[i]); }
          const end = lane(i, 1);
          if (s.press[0] === i && s.press[1] > 0) R.oval(scr, end.x, end.y, 8, 4, LANE_COLORS[i]);
          R.ring(scr, end.x, end.y, 8, 4, LANE_COLORS[i]);
          R.ring(scr, end.x, end.y, 9, 5, P.black);
          R.text(scr, String(i + 1), end.x, end.y + 7, LANE_COLORS[i], { align: 'center' });
        }

        // the notes, as diamonds sliding down each lane
        for (const n of s.notes) {
          const u = (t - n.t0) / travel;
          if (n.hit || u > 1.2) continue;
          const p = lane(n.lane, Math.min(u, 1.2));
          const k = Math.round(lerp(2, 6, clamp(u, 0, 1)));
          const pts = [{ x: p.x, y: p.y - k }, { x: p.x + k, y: p.y }, { x: p.x, y: p.y + k }, { x: p.x - k, y: p.y }];
          R.poly(scr, pts.map((q) => ({ x: q.x + (q.x > p.x ? 1 : q.x < p.x ? -1 : 0), y: q.y + (q.y > p.y ? 1 : q.y < p.y ? -1 : 0) })), P.black);
          R.poly(scr, pts, n.done ? P.slate : LANE_COLORS[n.lane]);
        }

        R.sprite(scr, sprites.main, W / 2, 142 + bobOf(t, 4), { sy: s.singT > 0 ? 1.12 : 1, sx: s.singT > 0 ? 0.92 : 1 });
        particles(scr, parts, dt);
        say.draw(scr, W / 2, 108);
        hud(scr, upper(th.title, 26), `SUNG ${s.hits}/${total}`);

        if (s.spawned >= total && s.notes.every((n) => n.done)) {
          s.endT += dt;
          if (s.endT > 1) {
            return {
              score: Math.round((s.hits / total) * 100),
              facts: [
                `sang back ${s.hits} of ${total} notes`,
                s.hits >= total - 1 ? `${th.singer.name} sang the last verse with us` : s.hits > total / 2 ? `${th.singer.name} liked the duet well enough to let us pass` : `${th.singer.name} got bored and wandered off mid-song`,
              ],
            };
          }
        }
        return null;
      });
    },
  };

  // ---------------------------------------------------------------------
  // 4. Refuel. A catching game under a space station. This is the healing beat.
  //    Agile moves faster. Lucky means fewer wrenches in the mix.
  // ---------------------------------------------------------------------

  const refuel = {
    id: 'refuel',
    name: 'Refuel',
    axis: ['agile', 'lucky'],
    hint: 'Point left and right (or use the arrow keys) to move me under the good stuff.',
    brief: (w) => ({
      title: w.refuel.title,
      line: w.refuel.line,
      objective: `${w.refuel.station[0].toUpperCase() + w.refuel.station.slice(1)} is throwing us ${w.refuel.good.name}. Catch those, dodge the ${w.refuel.bad.name}.`,
    }),
    run(ctx) {
      const { scr, input, stats, sprites } = ctx;
      const w = worldOf(ctx), th = w.refuel;
      const agile = stats.agile || 0, lucky = stats.lucky || 0;
      const duration = 16;
      const maxSpeed = 110 * (1 + 0.3 * agile);
      const junkChance = clamp(0.34 - 0.07 * lucky, 0.12, 0.5);
      const stars = R.makeStars(50, 30, H);
      const say = makeSay();
      const parts = [];
      const s = { x: W / 2, items: [], nextDrop: 0.8, fuel: 0, stars: 0, junk: 0, dropped: 0, hitT: 0 };
      say.set('I AM SO THIRSTY', 1.6);

      return R.loop((dt, t) => {
        say.tick(dt);
        s.hitT = Math.max(0, s.hitT - dt);
        const ax = input.axis();
        const target = input.keys.has('ArrowLeft') || input.keys.has('ArrowRight') || input.keys.has('a') || input.keys.has('d')
          ? s.x + ax.x * 60 : input.x;
        const dx = clamp(target - s.x, -maxSpeed * dt, maxSpeed * dt);
        s.x = clamp(s.x + dx, 14, W - 14);
        input.clear();

        const hatchX = W / 2 + Math.sin(t * 1.3) * 52;
        if (t < duration - 1.5 && t > s.nextDrop) {
          const r = Math.random();
          const kind = r < junkChance ? 'junk' : 'fuel';
          s.items.push({ kind, x: hatchX, y: 32, vy: 34 + Math.random() * 22 + t * 1.5 });
          if (kind !== 'junk') s.dropped += 1;
          s.nextDrop = t + 0.5 + Math.random() * 0.25;
        }
        for (const it of s.items) {
          it.y += it.vy * dt;
          if (!it.done && it.y > 104 && it.y < 126 && Math.abs(it.x - s.x) < 13) {
            it.done = true;
            if (it.kind === 'junk') { s.junk += 1; s.hitT = 0.5; say.set(w.voice.ouch, 0.8); burst(parts, it.x, it.y, 8, [P.slate, P.silver], 40); }
            else {
              s.fuel += 1;
              say.set(w.voice.yay, 0.6);
              burst(parts, it.x, it.y, 8, [P.green, P.yellow, P.white], 40);
            }
          }
        }
        s.items = s.items.filter((it) => !it.done && it.y < H + 8);

        // ---- draw ----
        R.shake(scr, s.hitT > 0 ? 2 : 0);
        R.bands(scr, 0, H, [P.black, P.black, P.navy, P.plum]);
        R.drawStars(scr, stars, t);
        R.disc(scr, 22, 128, 15, P.black);
        R.disc(scr, 22, 128, 14, P.blue);
        R.disc(scr, 17, 124, 5, P.green);
        R.disc(scr, 27, 133, 4, P.green);

        // the station
        R.rect(scr, 10, 13, 40, 13, P.black); R.rect(scr, 142, 13, 40, 13, P.black);
        R.rect(scr, 11, 14, 38, 11, P.navy); R.rect(scr, 143, 14, 38, 11, P.navy);
        for (let x = 11; x < 49; x += 6) { R.rect(scr, x, 14, 1, 11, P.blue); R.rect(scr, x + 132, 14, 1, 11, P.blue); }
        R.rect(scr, 49, 18, 94, 3, P.silver);
        R.rect(scr, 60, 10, 72, 20, P.black);
        R.rect(scr, 61, 11, 70, 18, P.silver);
        for (let i = 0; i < 5; i++) R.rect(scr, 66 + i * 13, 15, 6, 5, ((t * 2 + i) | 0) % 5 === 0 ? P.yellow : P.blue);
        R.rect(scr, 94, 6, 3, 5, ((t * 3) | 0) % 2 ? P.red : P.plum);
        R.rect(scr, hatchX - 6, 29, 12, 4, P.black);
        R.rect(scr, hatchX - 5, 29, 10, 3, P.slate);

        for (const it of s.items) THEMES.icon(scr, it.kind === 'junk' ? th.bad : th.good, it.x, it.y, 5, t);

        const flashing = s.hitT > 0 && ((t * 20) | 0) % 2 === 0;
        R.sprite(scr, sprites.main, s.x, 138 + bobOf(t, 7), { flash: flashing });
        R.rect(scr, s.x - 6, 139, 13, 3, P.slate);
        if (((t * 12) | 0) % 2) R.rect(scr, s.x - 2, 142, 5, 2, P.orange);
        particles(scr, parts, dt);
        say.draw(scr, s.x, 104);

        const left = Math.max(0, Math.ceil(duration - t));
        hud(scr, upper(th.title, 20), `GOT ${s.fuel} OOF ${s.junk} ${left}S`);
        progressBar(scr, t / duration);
        R.shake(scr, 0);

        if (t >= duration) {
          const caught = s.fuel;
          const score = Math.round(clamp((caught / Math.max(1, s.dropped)) * 110 - s.junk * 14, 0, 100));
          return {
            score,
            facts: [
              `caught ${caught} of ${s.dropped} ${th.good.name} from ${th.station}`,
              s.junk ? `got hit on the head by ${s.junk} of the ${th.bad.name}` : `dodged all of the ${th.bad.name}`,
            ],
          };
        }
        return null;
      });
    },
  };

  // ---------------------------------------------------------------------
  // 5. Rock blaster. Same runner, neon grid floor, and now you can zap.
  //    Agile turns sharper. Clever makes your zaps fatter.
  // ---------------------------------------------------------------------

  const rocks = {
    id: 'rocks',
    name: 'Rock blaster',
    axis: ['agile', 'clever'],
    hint: 'Point to steer. Tap (or press Space) to zap straight ahead.',
    brief: (w) => ({
      title: w.rocks.title,
      line: w.rocks.line,
      objective: `Zap the ${w.rocks.bad.name} before they bonk me, and grab the ${w.rocks.good.name}.`,
    }),
    run(ctx) {
      const clever = ctx.stats.clever || 0;
      const w = worldOf(ctx), th = w.rocks;
      return runner(ctx, {
        seed: 23,
        theme: th,
        name: upper(th.title, 20),
        speed: 300,
        distance: 4500,
        badR: 14,
        badGap: 95,
        goodGap: 420,
        fire: true,
        boltR: clamp(5 + 3 * clever, 2, 12),
        tile: 30,
        startLine: 'ZAP TIME!',
        hitLine: w.voice.ouch,
        goodLine: w.voice.yay,
        decor(scr, t, hor, pct) { moonDisc(scr, W / 2, hor - 2, 6 + 16 * clamp(pct, 0, 1)); },
        counter: (s) => `ZAP ${s.zapped} BONK ${s.hits}`,
        score: (s) => 100 - s.hits * 12 + s.zapped * 2 + s.got * 5,
        facts: (s) => [
          `zapped ${s.zapped} of the ${th.bad.name}`,
          s.hits === 0 ? `never got hit by any of the ${th.bad.name}` : `got bonked by ${s.hits} of the ${th.bad.name}`,
          `grabbed ${s.got} of the ${th.good.name}`,
        ],
      });
    },
  };

  // ---------------------------------------------------------------------
  // 6. Moon landing. Classic side-view lander. Steady buys fuel, agile steers.
  // ---------------------------------------------------------------------

  function drawLander(scr, x, y, spr, thrusting, side, t) {
    R.line(scr, x - 5, y + 6, x - 9, y + 12, P.black); R.line(scr, x - 4, y + 6, x - 8, y + 12, P.silver);
    R.line(scr, x + 5, y + 6, x + 9, y + 12, P.black); R.line(scr, x + 4, y + 6, x + 8, y + 12, P.silver);
    R.rect(scr, x - 11, y + 11, 5, 2, P.silver); R.rect(scr, x + 7, y + 11, 5, 2, P.silver);
    R.rect(scr, x - 8, y + 1, 17, 8, P.black);
    R.rect(scr, x - 7, y + 2, 15, 6, P.silver);
    R.rect(scr, x - 7, y + 5, 15, 1, P.orange);
    R.disc(scr, x, y - 4, 9, P.black);
    R.disc(scr, x, y - 4, 8, P.navy);
    if (spr) R.sprite(scr, spr, x, y + 3);
    R.px(scr, x - 5, y - 9, P.white); R.px(scr, x - 4, y - 10, P.white);
    if (thrusting) {
      const len = 5 + Math.random() * 6;
      R.poly(scr, [{ x: x - 4, y: y + 9 }, { x: x + 4, y: y + 9 }, { x: x, y: y + 9 + len }], P.orange);
      R.poly(scr, [{ x: x - 2, y: y + 9 }, { x: x + 2, y: y + 9 }, { x: x, y: y + 9 + len * 0.6 }], P.yellow);
    }
    if (side) R.rect(scr, x - side * 10, y + 3, 2, 2, ((t * 20) | 0) % 2 ? P.white : P.silver);
  }

  function makeTerrain(padW) {
    const pts = [];
    for (let x = 0; x <= W; x += 12) pts.push(104 + Math.random() * 28);
    const heights = new Array(W + 1);
    for (let x = 0; x <= W; x++) {
      const i = Math.floor(x / 12), f = (x % 12) / 12;
      heights[x] = Math.round(lerp(pts[i], pts[Math.min(pts.length - 1, i + 1)], f));
    }
    const padX = Math.round(30 + Math.random() * (W - 60 - padW));
    for (let x = padX - 2; x <= padX + padW + 2; x++) heights[x] = 118;
    return { heights, padX, padW };
  }

  const lander = {
    id: 'lander',
    name: 'Moon landing',
    axis: ['steady', 'agile'],
    hint: 'Hold the screen (or Space) to thrust. Hold to the left or right of me to drift that way.',
    brief: (w) => ({
      title: w.lander.title,
      line: w.lander.line,
      objective: 'Hold to fire the thruster. Land me softly on the flashing pad.',
    }),
    run(ctx) {
      const { scr, input, stats, sprites } = ctx;
      const steady = stats.steady || 0, agile = stats.agile || 0;
      const maxFuel = 3.6 + 0.7 * steady;
      const sideAcc = 26 * (1 + 0.3 * agile);
      const gravity = 16, thrust = 38;
      const land = makeTerrain(30);
      const stars = R.makeStars(60, 12, 100);
      const say = makeSay();
      const parts = [];
      const s = { x: 40 + Math.random() * 110, y: 22, vx: (Math.random() - 0.5) * 24, vy: 4, fuel: maxFuel, done: false, endT: 0, result: null };
      say.set('SLOWLY NOW...', 1.8);

      return R.loop((dt, t) => {
        say.tick(dt);
        let thrusting = false, side = 0;
        if (!s.done) {
          thrusting = input.down && s.fuel > 0;
          if (input.keys.has('ArrowLeft') || input.keys.has('a')) side = -1;
          else if (input.keys.has('ArrowRight') || input.keys.has('d')) side = 1;
          else if (input.down && Math.abs(input.x - s.x) > 6 && !input.keys.has(' ')) side = Math.sign(input.x - s.x);
          if (side && s.fuel > 0) { s.vx += side * sideAcc * dt; s.fuel = Math.max(0, s.fuel - dt * 0.3); }
          if (thrusting) s.fuel = Math.max(0, s.fuel - dt);
          s.vy += (gravity - (thrusting ? thrust : 0)) * dt;
          s.vx *= 1 - 0.15 * dt;
          s.x = clamp(s.x + s.vx * dt, 10, W - 10);
          s.y = Math.max(16, s.y + s.vy * dt);
          const ground = Math.min(land.heights[Math.round(s.x - 8)], land.heights[Math.round(s.x)], land.heights[Math.round(s.x + 8)]);
          if (s.y + 13 >= ground) {
            s.done = true;
            s.y = ground - 13;
            const onPad = s.x - 9 >= land.padX && s.x + 9 <= land.padX + land.padW;
            const speed = Math.max(0, s.vy);
            let score;
            if (onPad) score = 45 + 55 * clamp(1 - (speed - 8) / 18, 0, 1) - (Math.abs(s.vx) > 12 ? 12 : 0);
            else score = clamp(35 - speed * 0.6 - Math.abs(s.x - (land.padX + land.padW / 2)) * 0.15, 5, 35);
            s.result = { onPad, speed, score: Math.round(clamp(score, 0, 100)) };
            burst(parts, s.x, s.y + 13, 16, [P.silver, P.white, P.slate], 40);
            say.set(onPad && speed < 22 ? 'WE MADE IT!' : onPad ? 'OOF! BUT HERE!' : 'CRUNCH!', 3);
          }
        } else {
          s.endT += dt;
        }
        input.clear();
        if (thrusting && Math.random() < 0.5) parts.push({ x: s.x, y: s.y + 14, vx: (Math.random() - 0.5) * 20, vy: 30, life: 0.3, c: P.orange });

        // ---- draw ----
        R.bands(scr, 0, H, [P.black, P.black, P.navy, P.black]);
        R.drawStars(scr, stars, t);
        R.disc(scr, 34, 30, 13, P.black);
        R.disc(scr, 34, 30, 12, P.blue);
        R.disc(scr, 30, 26, 4, P.green);
        R.disc(scr, 39, 34, 5, P.green);
        R.oval(scr, 37, 30, 8, 3, P.white);

        const groundPts = [{ x: 0, y: H }];
        for (let x = 0; x <= W; x += 2) groundPts.push({ x, y: land.heights[x] });
        groundPts.push({ x: W, y: H });
        R.poly(scr, groundPts.map((p) => ({ x: p.x, y: p.y - 1 })), P.black);
        R.poly(scr, groundPts, P.silver);
        for (let x = 0; x < W; x += 2) R.rect(scr, x, land.heights[x] + 3, 2, H, P.slate);
        for (let i = 0; i < 6; i++) { const cx = 14 + i * 32; R.oval(scr, cx, land.heights[cx] + 8, 5, 2, P.lavender); }
        R.rect(scr, land.padX, 118, land.padW, 3, P.yellow);
        const blink = ((t * 3) | 0) % 2;
        R.rect(scr, land.padX, 114, 2, 4, blink ? P.red : P.yellow);
        R.rect(scr, land.padX + land.padW - 2, 114, 2, 4, blink ? P.yellow : P.red);
        if (!s.done && blink) {
          const ax = land.padX + land.padW / 2;
          R.poly(scr, [{ x: ax - 4, y: 104 }, { x: ax + 4, y: 104 }, { x: ax, y: 109 }], P.yellow);
        }

        drawLander(scr, s.x, s.y, sprites.small, thrusting, side, t);
        particles(scr, parts, dt);
        say.draw(scr, s.x, s.y - 16);

        hud(scr, 'MOON LANDING', `FUEL ${Math.round((s.fuel / maxFuel) * 100)}%`);
        const fast = s.vy > 22;
        R.rect(scr, 0, 9, W, 7, P.black);
        R.text(scr, `SPEED ${Math.max(0, Math.round(s.vy))}`, 3, 10, fast ? P.red : P.green);
        R.text(scr, fast ? 'TOO FAST!' : 'SAFE', W - 3, 10, fast ? P.red : P.green, { align: 'right' });

        if (s.done && s.endT > 1.8) {
          const r = s.result;
          return {
            score: r.score,
            facts: [
              `touched down at speed ${Math.round(r.speed)}${r.speed < 22 ? ', nice and soft' : ', way too fast'}`,
              r.onPad ? 'landed right on the flashing pad' : 'missed the pad and came down in the rocks',
              s.fuel < 0.2 ? 'ran out of thruster fuel on the way down' : `had ${Math.round((s.fuel / maxFuel) * 100)}% fuel left`,
            ],
          };
        }
        return null;
      });
    },
  };

  // =====================================================================
  // Cutscenes. Each returns a controller: { ready, ended, cue(name), stop() }.
  // They run on their own loop while game.js drives the dialogue.
  // =====================================================================

  function controller() {
    const c = { stopped: false, cues: [] };
    c.ready = new Promise((r) => (c.resolveReady = r));
    c.ended = new Promise((r) => (c.resolveEnd = r));
    c.cue = (name) => c.cues.push(name);
    c.stop = () => { c.stopped = true; };
    return c;
  }

  // The doodle wakes up: it rumbles on the paper, crunches into pixels,
  // and hops off the page into a night sky with the moon in the window.
  function alive(ctx) {
    const { scr, sprites } = ctx;
    const c = controller();
    const stars = R.makeStars(60, 4, 110);
    const parts = [];
    let happyT = 0, readyFired = false, landedBurst = false;
    const steps = [...sprites.steps, sprites.main];
    const showH = 72;

    R.loop((dt, t) => {
      if (c.stopped) return true;
      while (c.cues.length) if (c.cues.shift() === 'happy') happyT = 1.4;
      happyT = Math.max(0, happyT - dt);

      const popped = t > 2.2;
      if (!popped) {
        R.rect(scr, 0, 0, W, H, P.brown);
        for (let y = 6; y < H; y += 14) R.rect(scr, 0, y, W, 1, P.plum);
        R.shake(scr, t > 1 ? Math.min(3, (t - 1) * 2.4) : 0);
        R.rect(scr, 50, 18, 96, 98, P.black);
        R.rect(scr, 48, 16, 96, 98, P.white);
        for (let y = 26; y < 112; y += 8) R.rect(scr, 52, y, 88, 1, P.peach);
        const idx = t < 1.3 ? 0 : t < 1.65 ? 1 : t < 1.95 ? 2 : 3;
        const spr = steps[idx];
        R.sprite(scr, spr, 96, 108, { scale: showH / spr.height });
        if (t > 1) R.text(scr, '!', 150, 20 + ((t * 10) | 0) % 2, P.yellow, { scale: 2 });
        R.shake(scr, 0);
      } else {
        if (!readyFired && t > 3.1) { readyFired = true; c.resolveReady(); }
        R.bands(scr, 0, 118, [P.black, P.navy, P.navy, P.plum]);
        R.drawStars(scr, stars, t);
        moonDisc(scr, 158, 30, 16);
        R.rect(scr, 0, 118, W, H - 118, P.brown);
        R.rect(scr, 0, 118, W, 2, P.orange);
        for (let x = 4; x < W; x += 24) R.rect(scr, x, 126, 12, 1, P.plum);

        // the paper falls away, the character arcs up and lands
        const k = clamp((t - 2.2) / 0.7, 0, 1);
        if (k < 1) {
          R.rect(scr, 48, 16 + k * 140, 96, 98, P.white);
          burst(parts, 96, 70, 2, [P.yellow, P.white, P.pink], 60);
        }
        if (!landedBurst && t >= 2.9) { landedBurst = true; burst(parts, 80, 118, 24, [P.yellow, P.white, P.pink, P.blue], 70); }
        const x = lerp(96, 80, k);
        const hop = Math.sin(k * Math.PI) * 34;
        let y = 118 - hop;
        const scale = lerp(showH / sprites.main.height, 2, k);
        let sx = 1, sy = 1;
        if (k >= 1) {
          const land = clamp((t - 2.9) / 0.25, 0, 1);
          sy = land < 1 ? 0.8 + land * 0.2 : 1 + Math.sin(t * 5) * 0.03;
          sx = 2 - sy;
          if (happyT > 0) {
            y = 118 - Math.abs(Math.sin(happyT * 9)) * 12;
            if (Math.random() < 0.3) parts.push({ x: x + (Math.random() - 0.5) * 30, y: y - 50, vx: 0, vy: -20, life: 0.8, c: P.pink, size: 2 });
          }
        }
        R.oval(scr, x, 119, 14, 2, P.plum);
        R.sprite(scr, sprites.main, x, y, { scale, sx, sy });
      }
      particles(scr, parts, dt);
      return null;
    });
    return c;
  }

  // A tiny Earth with drifting continents, drawn per pixel so it can turn.
  function makeEarth() {
    const rnd = seeded(42);
    const Wt = 48, Ht = 24;
    const land = new Uint8Array(Wt * Ht);
    const cloud = new Uint8Array(Wt * Ht);
    const blob = (mask, n, rMin, rMax) => {
      for (let b = 0; b < n; b++) {
        const cx = rnd() * Wt, cy = 3 + rnd() * (Ht - 6), r = rMin + rnd() * (rMax - rMin);
        for (let y = 0; y < Ht; y++) for (let x = 0; x < Wt; x++) {
          const dx = Math.min(Math.abs(x - cx), Wt - Math.abs(x - cx));
          if (dx * dx + (y - cy) * (y - cy) * 2 < r * r) mask[y * Wt + x] = 1;
        }
      }
    };
    blob(land, 9, 2, 6);
    blob(cloud, 10, 1, 3);
    return (scr, cx, cy, r, rot) => {
      R.disc(scr, cx, cy, r + 1, P.black);
      for (let dy = -r; dy <= r; dy++) {
        const half = Math.sqrt(Math.max(0, r * r - dy * dy));
        for (let dx = -Math.floor(half); dx <= Math.floor(half); dx++) {
          const lon = Math.asin(clamp(dx / (half || 1), -1, 1));
          const u = Math.floor(((lon / Math.PI + 0.5) * (Wt / 2) + rot) % Wt + Wt) % Wt;
          const v = clamp(Math.floor(((dy / r + 1) / 2) * Ht), 0, Ht - 1);
          const uc = Math.floor(u + rot * 0.6) % Wt;
          const night = dx > r * 0.45 - dy * 0.1;
          let col = land[v * Wt + u] ? (night ? P.forest : P.green) : (night ? P.navy : P.blue);
          if (cloud[v * Wt + uc]) col = night ? P.lavender : P.white;
          R.rect(scr, cx + dx, cy + dy, 1, 1, col);
        }
      }
    };
  }

  // The payoff: out on the moon, then the view back home, then THE END.
  function finale(ctx) {
    const { scr, sprites } = ctx;
    const c = controller();
    const stars = R.makeStars(80, 4, 120);
    const drawEarth = makeEarth();
    const parts = [];
    let phase = 'arrive', phaseT = 0, readyFired = false, endFired = false, shoot = null;
    const horizon = (x) => 112 + Math.round(Math.sin(x * 0.05) * 2 + (x - W / 2) * (x - W / 2) * 0.0009);

    R.loop((dt, t) => {
      if (c.stopped) return true;
      while (c.cues.length) if (c.cues.shift() === 'view' && phase === 'arrive') { phase = 'wipe'; phaseT = 0; }
      phaseT += dt;

      if (phase === 'arrive') {
        R.bands(scr, 0, H, [P.black, P.black, P.navy, P.black]);
        R.drawStars(scr, stars, t);
        R.rect(scr, 0, 104, W, H - 104, P.black);
        R.rect(scr, 0, 105, W, H - 105, P.silver);
        for (let x = 0; x < W; x += 2) R.rect(scr, x, 112 + ((x * 7) % 5), 2, 1, P.slate);
        R.oval(scr, 40, 124, 12, 3, P.lavender); R.oval(scr, 150, 132, 9, 2, P.lavender);
        drawLander(scr, 156, 91, null, false, 0, t);
        const k = clamp((phaseT - 0.4) / 2, 0, 1);
        const x = lerp(152, 96, k);
        const hop = k < 1 ? Math.abs(Math.sin(k * Math.PI * 4)) * 10 : 0;
        for (let fx = 150; fx > x + 6; fx -= 9) R.rect(scr, fx, 121 + (((fx / 9) | 0) % 2) * 2, 3, 1, P.slate);
        R.oval(scr, x, 122, 12, 2, P.slate);
        R.sprite(scr, sprites.main, x, 122 - hop, { scale: k < 1 ? 1 + k : 2 });
        if (!readyFired && phaseT > 2.6) { readyFired = true; c.resolveReady(); }
      } else if (phase === 'wipe' && phaseT < 0.5) {
        for (let y = 0; y < H; y += 8) R.rect(scr, 0, y, W, Math.ceil((phaseT / 0.5) * 8), P.black);
      } else {
        if (phase === 'wipe') { phase = 'view'; phaseT = 0; }
        // the view from the moon: Earth rising over the grey horizon
        R.bands(scr, 0, H, [P.black, P.black, P.black, P.navy]);
        R.drawStars(scr, stars, t);
        const rise = 1 - Math.pow(1 - clamp(phaseT / 4.5, 0, 1), 3);
        drawEarth(scr, 108, lerp(150, 58, rise), 30, t * 3);
        if (!shoot && Math.random() < dt * 0.5) shoot = { x: 20 + Math.random() * 120, y: 10 + Math.random() * 30, life: 0.6 };
        if (shoot) {
          shoot.life -= dt; shoot.x += 160 * dt; shoot.y += 50 * dt;
          R.line(scr, shoot.x, shoot.y, shoot.x - 8, shoot.y - 3, P.white);
          if (shoot.life <= 0) shoot = null;
        }
        const ground = [{ x: 0, y: H }];
        for (let x = 0; x <= W; x += 2) ground.push({ x, y: horizon(x) });
        ground.push({ x: W, y: H });
        R.poly(scr, ground.map((p) => ({ x: p.x, y: p.y - 1 })), P.black);
        R.poly(scr, ground, P.silver);
        for (let x = 0; x < W; x += 3) R.rect(scr, x, horizon(x) + 4 + ((x * 5) % 7), 2, 1, P.slate);
        R.rect(scr, 0, 132, W, H - 132, P.slate);
        // the character, small now, sitting on the edge and looking home
        R.sprite(scr, sprites.main, 46, horizon(46) + 1 + Math.round(Math.sin(t * 2) * 0.6));
        THEMES.icon(scr, (ctx.world || THEMES.DEFAULT_WORLD).keepsake, 66, horizon(66) - 4, 4, t);
        if (phaseT > 4.6) {
          const msg = 'THE END';
          const shown = Math.min(msg.length, Math.floor((phaseT - 4.6) / 0.18) + 1);
          R.text(scr, msg.slice(0, shown), W / 2, 12, P.white, { align: 'center', scale: 3, shadow: P.pink });
          if (!endFired && shown === msg.length && phaseT > 6.2) { endFired = true; c.resolveEnd(); }
        }
      }
      particles(scr, parts, dt);
      return null;
    });
    return c;
  }

  // Out of HP: the doodle drifts, a little dazed, among the stars.
  function lost(ctx) {
    const { scr, sprites } = ctx;
    const c = controller();
    const stars = R.makeStars(80, 0, H);
    R.loop((dt, t) => {
      if (c.stopped) return true;
      if (t > 1.2) c.resolveReady();
      R.bands(scr, 0, H, [P.black, P.black, P.navy, P.black]);
      R.drawStars(scr, stars, t, t * 6);
      moonDisc(scr, 164, 26, 8);
      const x = W / 2 + Math.sin(t * 0.6) * 20, y = 96 + Math.sin(t * 1.1) * 6;
      R.sprite(scr, sprites.main, x, y, { scale: 2, flipX: Math.sin(t * 0.6) < 0 });
      if (((t * 1.5) | 0) % 3 === 0) R.bubble(scr, x, y - 66, '...');
      return null;
    });
    return c;
  }

  // Only one classic arcade game remains: the space duet. The other two
  // challenges use balance and freehand route drawing.
  global.MINIGAMES = { wobble, orbit, whale };
  global.CUTSCENES = { alive, finale, lost };
})(window);
