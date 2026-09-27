// The art library that lets every character get their own trip.
//
// The AI never draws anything. It picks from the named pieces below: icons for
// obstacles and pickups, a creature that sings, a vehicle to ride, and presets
// for the sky and the ground. It gives each a name and a colour that fit the
// character. The same mechanics then play out in a world that belongs to them.
// Keep these names in sync with WORLD_VOCAB in server.js.

(function (global) {
  const { P } = R;
  const TAU = Math.PI * 2;

  const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'pink', 'lavender', 'brown', 'silver', 'white', 'plum', 'forest', 'slate', 'peach'];
  const col = (name, fallback) => P[name] || P[fallback] || P.white;

  // ---------- small helpers ----------

  const od = (s, x, y, r, c) => { R.disc(s, x, y, r + 1, P.black); R.disc(s, x, y, r, c); };
  const oo = (s, x, y, rx, ry, c) => { R.oval(s, x, y, rx + 1, ry + 1, P.black); R.oval(s, x, y, rx, ry, c); };
  const orect = (s, x, y, w, h, c) => { R.rect(s, x - 1, y - 1, w + 2, h + 2, P.black); R.rect(s, x, y, w, h, c); };
  const opoly = (s, pts, c) => {
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    R.poly(s, pts.map((p) => ({ x: p.x + Math.sign(p.x - cx), y: p.y + Math.sign(p.y - cy) })), P.black);
    R.poly(s, pts, c);
  };

  // ---------- icons: obstacles and pickups, drawn around (x, y) at radius r ----------

  const ICONS = {
    cloud(s, x, y, r, c, t, seed) {
      const lumps = [[-0.6, 0.15, 0.62], [0.05, -0.2, 0.85], [0.62, 0.12, 0.58]];
      for (const l of lumps) R.disc(s, x + l[0] * r, y + l[1] * r, l[2] * r + 1, P.black);
      for (const l of lumps) R.disc(s, x + l[0] * r, y + l[1] * r, l[2] * r, c);
      R.disc(s, x - r * 0.1, y - r * 0.35, r * 0.3, P.white);
      if (((t * 6 + (seed || 0)) | 0) % 7 === 0) {
        R.line(s, x, y + r * 0.5, x + r * 0.3, y + r * 1.1, P.yellow);
        R.line(s, x + r * 0.3, y + r * 1.1, x, y + r * 1.4, P.yellow);
      }
    },
    rock(s, x, y, r, c) {
      od(s, x, y, r, c);
      R.disc(s, x - r * 0.3, y - r * 0.25, r * 0.28, P.slate);
      R.disc(s, x + r * 0.35, y + r * 0.3, r * 0.2, P.slate);
    },
    star(s, x, y, r, c) {
      const k = Math.max(1, Math.round(r)), w = Math.max(1, Math.round(k / 2));
      R.rect(s, x - k - 1, y - w / 2 - 1, k * 2 + 3, w + 2, P.black);
      R.rect(s, x - w / 2 - 1, y - k - 1, w + 2, k * 2 + 3, P.black);
      R.rect(s, x - k, y - w / 2, k * 2 + 1, w, c);
      R.rect(s, x - w / 2, y - k, w, k * 2 + 1, c);
      R.px(s, x, y, P.white);
    },
    heart(s, x, y, r, c) {
      const pts = [{ x: x - r, y: y - r * 0.1 }, { x: x + r, y: y - r * 0.1 }, { x, y: y + r }];
      R.disc(s, x - r * 0.5, y - r * 0.35, r * 0.55 + 1, P.black);
      R.disc(s, x + r * 0.5, y - r * 0.35, r * 0.55 + 1, P.black);
      opoly(s, pts, c);
      R.disc(s, x - r * 0.5, y - r * 0.35, r * 0.55, c);
      R.disc(s, x + r * 0.5, y - r * 0.35, r * 0.55, c);
      R.px(s, x - r * 0.55, y - r * 0.5, P.white);
    },
    bone(s, x, y, r, c) {
      for (const dx of [-1, 1]) for (const dy of [-1, 1]) R.disc(s, x + dx * r * 0.8, y + dy * r * 0.3, r * 0.35 + 1, P.black);
      orect(s, x - r * 0.8, y - r * 0.25, r * 1.6, r * 0.5, c);
      for (const dx of [-1, 1]) for (const dy of [-1, 1]) R.disc(s, x + dx * r * 0.8, y + dy * r * 0.3, r * 0.35, c);
    },
    fish(s, x, y, r, c, t) {
      const wag = Math.sin(t * 10) * r * 0.2;
      opoly(s, [{ x: x + r * 0.6, y }, { x: x + r * 1.2, y: y - r * 0.6 + wag }, { x: x + r * 1.2, y: y + r * 0.6 + wag }], c);
      oo(s, x, y, r * 0.8, r * 0.55, c);
      R.px(s, x - r * 0.45, y - r * 0.15, P.black);
    },
    bird(s, x, y, r, c, t) {
      const flap = Math.sin(t * 14) > 0 ? -1 : 1;
      opoly(s, [{ x: x - r * 0.2, y }, { x: x - r * 1.1, y: y + flap * r * 0.8 }, { x: x - r * 0.4, y: y + r * 0.2 }], c);
      opoly(s, [{ x: x + r * 0.2, y }, { x: x + r * 1.1, y: y + flap * r * 0.8 }, { x: x + r * 0.4, y: y + r * 0.2 }], c);
      od(s, x, y, r * 0.45, c);
      R.px(s, x, y - r * 0.1, P.black);
      R.rect(s, x - 0.5, y + r * 0.3, 1, 1, P.orange);
    },
    ghost(s, x, y, r, c, t) {
      const b = y + r * 0.8 + Math.sin(t * 5) * 0.8;
      R.disc(s, x, y - r * 0.2, r * 0.8 + 1, P.black);
      R.rect(s, x - r * 0.8 - 1, y - r * 0.2, r * 1.6 + 2, b - y + r * 0.2 + 1, P.black);
      R.disc(s, x, y - r * 0.2, r * 0.8, c);
      R.rect(s, x - r * 0.8, y - r * 0.2, r * 1.6, b - y + r * 0.2, c);
      R.disc(s, x - r * 0.3, y - r * 0.25, Math.max(0.5, r * 0.15), P.black);
      R.disc(s, x + r * 0.3, y - r * 0.25, Math.max(0.5, r * 0.15), P.black);
    },
    bubble(s, x, y, r, c) {
      R.ring(s, x, y, r + 1, r + 1, P.black);
      R.ring(s, x, y, r, r, c);
      R.px(s, x - r * 0.4, y - r * 0.4, P.white);
      R.px(s, x - r * 0.5, y - r * 0.2, P.white);
    },
    gear(s, x, y, r, c, t) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + t * 2;
        R.disc(s, x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85, r * 0.28 + 1, P.black);
        R.disc(s, x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85, r * 0.28, c);
      }
      od(s, x, y, r * 0.75, c);
      R.disc(s, x, y, r * 0.25, P.black);
    },
    sock(s, x, y, r, c) {
      opoly(s, [{ x: x - r * 0.4, y: y - r }, { x: x + r * 0.3, y: y - r }, { x: x + r * 0.3, y: y + r * 0.2 },
        { x: x + r, y: y + r * 0.4 }, { x: x + r, y: y + r }, { x: x - r * 0.4, y: y + r }], c);
      R.rect(s, x - r * 0.4, y - r * 0.6, r * 0.7, Math.max(1, r * 0.2), P.white);
    },
    book(s, x, y, r, c) {
      orect(s, x - r * 0.8, y - r, r * 1.6, r * 2, c);
      R.rect(s, x - r * 0.8, y - r, Math.max(1, r * 0.25), r * 2, P.black);
      R.rect(s, x - r * 0.3, y - r * 0.5, r * 0.9, Math.max(1, r * 0.2), P.white);
    },
    candy(s, x, y, r, c) {
      opoly(s, [{ x: x - r * 0.5, y }, { x: x - r * 1.2, y: y - r * 0.6 }, { x: x - r * 1.2, y: y + r * 0.6 }], c);
      opoly(s, [{ x: x + r * 0.5, y }, { x: x + r * 1.2, y: y - r * 0.6 }, { x: x + r * 1.2, y: y + r * 0.6 }], c);
      od(s, x, y, r * 0.65, c);
      R.rect(s, x - r * 0.1, y - r * 0.6, Math.max(1, r * 0.25), r * 1.2, P.white);
    },
    flower(s, x, y, r, c) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        od(s, x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.42, c);
      }
      R.disc(s, x, y, r * 0.35, P.yellow);
    },
    note(s, x, y, r, c) {
      od(s, x - r * 0.3, y + r * 0.5, r * 0.45, c);
      orect(s, x + r * 0.05, y - r, Math.max(1, r * 0.2), r * 1.5, c);
      orect(s, x + r * 0.05, y - r, r * 0.6, Math.max(1, r * 0.25), c);
    },
    crystal(s, x, y, r, c) {
      opoly(s, [{ x, y: y - r * 1.1 }, { x: x + r * 0.8, y }, { x, y: y + r * 1.1 }, { x: x - r * 0.8, y }], c);
      R.rect(s, x - 1, y - r * 0.5, 1, Math.max(1, r * 0.4), P.white);
    },
    can(s, x, y, r, c) {
      orect(s, x - r * 0.7, y - r, r * 1.4, r * 2, c);
      R.rect(s, x - r * 0.3, y - r - 1.5, r * 0.6, 1.5, P.silver);
      R.rect(s, x - r * 0.7, y - r * 0.2, r * 1.4, Math.max(1, r * 0.3), P.white);
    },
    wrench(s, x, y, r, c) {
      orect(s, x - r, y - r * 0.2, r * 2, Math.max(1, r * 0.45), c);
      od(s, x - r, y, r * 0.4, c);
      od(s, x + r, y, r * 0.4, c);
      R.disc(s, x + r * 1.1, y, r * 0.15, P.black);
    },
    cookie(s, x, y, r, c) {
      od(s, x, y, r, c);
      for (const [dx, dy] of [[-0.4, -0.3], [0.3, -0.4], [0.1, 0.35], [-0.35, 0.35], [0.45, 0.15]]) {
        R.rect(s, x + dx * r, y + dy * r, Math.max(1, r * 0.2), Math.max(1, r * 0.2), P.brown);
      }
    },
    balloon(s, x, y, r, c) {
      R.line(s, x, y + r, x + 1, y + r * 1.8, P.white);
      oo(s, x, y, r * 0.75, r, c);
      R.px(s, x - r * 0.35, y - r * 0.45, P.white);
    },
    leaf(s, x, y, r, c) {
      opoly(s, [{ x: x - r, y: y + r * 0.6 }, { x: x - r * 0.1, y: y - r }, { x: x + r, y: y - r * 0.6 }, { x: x + r * 0.1, y: y + r }], c);
      R.line(s, x - r * 0.8, y + r * 0.6, x + r * 0.7, y - r * 0.5, P.forest);
    },
    coin(s, x, y, r, c) {
      od(s, x, y, r, c);
      R.ring(s, x, y, r * 0.65, r * 0.65, P.orange);
      R.rect(s, x - 0.5, y - r * 0.4, 1, r * 0.8, P.white);
    },
  };
  const ICON_NAMES = Object.keys(ICONS);

  function icon(s, spec, x, y, r, t, seed) {
    const draw = ICONS[spec.icon] || ICONS.star;
    const c = col(spec.color, 'yellow');
    if (r < 2) { od(s, x, y, Math.max(0.5, r), c); return; }
    draw(s, x, y, r, c, t || 0, seed);
  }

  // ---------- singers: the big creature in the rhythm level ----------

  const SINGERS = {
    whale(s, x, y, c, open) {
      opoly(s, [{ x: x + 38, y }, { x: x + 54, y: y - 11 }, { x: x + 50, y: y + 1 }, { x: x + 55, y: y + 11 }], c);
      oo(s, x, y, 44, 13, c);
      R.oval(s, x - 4, y + 6, 32, 5, P.white);
      R.disc(s, x - 30, y - 4, 2, P.black); R.px(s, x - 31, y - 5, P.white);
      R.oval(s, x - 40, y + 4, 4, open ? 3 : 1, P.black);
    },
    jellyfish(s, x, y, c, open, t) {
      for (let i = -3; i <= 3; i++) {
        const tx = x + i * 7;
        for (let k = 0; k < 14; k++) R.px(s, tx + Math.round(Math.sin(t * 4 + k * 0.6 + i) * 2), y + 6 + k, c);
      }
      oo(s, x, y, 28, 14, c);
      R.rect(s, x - 28, y + 1, 58, 14, P.black);
      R.oval(s, x - 10, y - 6, 8, 3, P.white);
      R.disc(s, x - 8, y - 1, 2, P.black); R.disc(s, x + 8, y - 1, 2, P.black);
      R.oval(s, x, y + 5, 3, open ? 3 : 1, P.black);
    },
    dog(s, x, y, c, open) {
      oo(s, x - 22, y + 2, 7, 14, P.brown); oo(s, x + 22, y + 2, 7, 14, P.brown);
      od(s, x, y, 22, c);
      oo(s, x, y + 9, 11, 8, P.white);
      R.disc(s, x - 8, y - 6, 3, P.black); R.disc(s, x + 8, y - 6, 3, P.black);
      R.px(s, x - 9, y - 7, P.white); R.px(s, x + 7, y - 7, P.white);
      R.oval(s, x, y + 4, 4, 3, P.black);
      if (open) { R.oval(s, x, y + 13, 5, 4, P.black); R.rect(s, x - 2, y + 15, 4, 3, P.pink); }
    },
    cat(s, x, y, c, open) {
      opoly(s, [{ x: x - 20, y: y - 8 }, { x: x - 16, y: y - 30 }, { x: x - 4, y: y - 17 }], c);
      opoly(s, [{ x: x + 20, y: y - 8 }, { x: x + 16, y: y - 30 }, { x: x + 4, y: y - 17 }], c);
      od(s, x, y, 21, c);
      R.oval(s, x - 8, y - 4, 3, 4, P.green); R.oval(s, x + 8, y - 4, 3, 4, P.green);
      R.rect(s, x - 8, y - 6, 1, 4, P.black); R.rect(s, x + 8, y - 6, 1, 4, P.black);
      R.rect(s, x - 1, y + 4, 3, 2, P.pink);
      for (const d of [-1, 1]) { R.line(s, x + d * 6, y + 6, x + d * 26, y + 3, P.white); R.line(s, x + d * 6, y + 8, x + d * 26, y + 10, P.white); }
      if (open) R.oval(s, x, y + 11, 4, 3, P.black);
    },
    owl(s, x, y, c, open) {
      opoly(s, [{ x: x - 20, y: y - 12 }, { x: x - 16, y: y - 26 }, { x: x - 8, y: y - 16 }], c);
      opoly(s, [{ x: x + 20, y: y - 12 }, { x: x + 16, y: y - 26 }, { x: x + 8, y: y - 16 }], c);
      oo(s, x, y, 22, 20, c);
      od(s, x - 9, y - 4, 8, P.white); od(s, x + 9, y - 4, 8, P.white);
      R.disc(s, x - 9, y - 4, 3, P.black); R.disc(s, x + 9, y - 4, 3, P.black);
      opoly(s, [{ x: x - 3, y: y + 4 }, { x: x + 3, y: y + 4 }, { x, y: y + (open ? 12 : 9) }], P.orange);
    },
    robot(s, x, y, c, open, t) {
      R.line(s, x, y - 20, x, y - 28, P.silver);
      R.disc(s, x, y - 29, 2, ((t * 3) | 0) % 2 ? P.red : P.yellow);
      orect(s, x - 24, y - 20, 48, 36, c);
      orect(s, x - 17, y - 12, 34, 12, P.navy);
      R.rect(s, x - 12, y - 9, 6, 6, P.green); R.rect(s, x + 6, y - 9, 6, 6, P.green);
      for (let i = 0; i < 5; i++) R.rect(s, x - 11 + i * 5, y + 5, 3, open ? 6 : 3, P.black);
    },
  };
  const SINGER_NAMES = Object.keys(SINGERS);

  function singer(s, spec, x, y, open, t) {
    (SINGERS[spec.kind] || SINGERS.whale)(s, x, y, col(spec.color, 'blue'), open, t || 0);
  }

  // ---------- vehicles: what the character rides off the pad ----------
  // Each draws with its base at `bottom` and returns the y where the character sits.

  function flame(s, x, y, lit, wide) {
    if (lit <= 0) return;
    const len = 6 + lit * 5 + Math.random() * 5;
    R.poly(s, [{ x: x - wide, y }, { x: x + wide, y }, { x, y: y + len }], P.orange);
    R.poly(s, [{ x: x - wide / 2, y }, { x: x + wide / 2, y }, { x, y: y + len * 0.6 }], P.yellow);
  }

  function stageLights(s, x, y, lit) {
    for (let i = 0; i < 3; i++) R.rect(s, x - 8 + i * 6, y, 4, 4, i < lit ? P.green : P.slate);
  }

  const VEHICLES = {
    rocket(s, x, bottom, c, lit) {
      const top = bottom - 60;
      R.rect(s, x - 13, top - 1, 26, 62, P.black);
      R.poly(s, [{ x: x - 14, y: top + 1 }, { x, y: top - 21 }, { x: x + 14, y: top + 1 }], P.black);
      R.poly(s, [{ x: x - 12, y: top }, { x, y: top - 19 }, { x: x + 12, y: top }], c);
      R.rect(s, x - 12, top, 24, 60, P.white);
      R.rect(s, x - 12, top + 40, 24, 4, c);
      for (const side of [-1, 1]) {
        const pts = [{ x: x + side * 12, y: bottom - 18 }, { x: x + side * 24, y: bottom + 1 }, { x: x + side * 12, y: bottom + 1 }];
        R.poly(s, pts.map((p) => ({ x: p.x + side, y: p.y + 1 })), P.black);
        R.poly(s, pts, c);
      }
      R.rect(s, x - 6, bottom, 12, 4, P.slate);
      stageLights(s, x, top + 48, lit);
      flame(s, x, bottom + 4, lit, 7);
      return bottom - 22;
    },
    teapot(s, x, bottom, c, lit) {
      opoly(s, [{ x: x + 20, y: bottom - 22 }, { x: x + 38, y: bottom - 40 }, { x: x + 40, y: bottom - 36 }, { x: x + 24, y: bottom - 12 }], c);
      R.ring(s, x - 26, bottom - 24, 9, 11, P.black); R.ring(s, x - 26, bottom - 24, 8, 10, c); R.ring(s, x - 26, bottom - 24, 7, 9, c);
      oo(s, x, bottom - 22, 27, 21, c);
      R.rect(s, x - 20, bottom - 30, 40, 3, P.white);
      oo(s, x, bottom - 44, 12, 4, c);
      od(s, x, bottom - 50, 3, P.white);
      stageLights(s, x, bottom - 16, lit);
      flame(s, x - 10, bottom, lit, 5); flame(s, x + 10, bottom, lit, 5);
      if (lit > 0) for (let i = 0; i < 3; i++) R.rect(s, x + 40 + i * 3, bottom - 44 - i * 4 - Math.random() * 3, 2, 2, P.white);
      return bottom - 38;
    },
    bathtub(s, x, bottom, c, lit) {
      for (const dx of [-22, 18]) orect(s, x + dx, bottom - 6, 4, 6, P.silver);
      orect(s, x - 30, bottom - 30, 60, 24, P.white);
      R.rect(s, x - 32, bottom - 32, 64, 4, c);
      R.rect(s, x - 32, bottom - 33, 64, 1, P.black);
      orect(s, x + 26, bottom - 44, 3, 12, P.silver);
      orect(s, x + 20, bottom - 45, 9, 3, P.silver);
      for (let i = 0; i < 5; i++) od(s, x - 24 + i * 11, bottom - 34 - (i % 2) * 3, 3, P.white);
      stageLights(s, x, bottom - 20, lit);
      flame(s, x - 14, bottom, lit, 5); flame(s, x + 14, bottom, lit, 5);
      return bottom - 30;
    },
    box(s, x, bottom, c, lit) {
      orect(s, x - 20, bottom - 40, 40, 40, P.brown);
      opoly(s, [{ x: x - 20, y: bottom - 40 }, { x: x - 30, y: bottom - 50 }, { x: x - 12, y: bottom - 50 }, { x: x - 4, y: bottom - 40 }], P.orange);
      opoly(s, [{ x: x + 20, y: bottom - 40 }, { x: x + 30, y: bottom - 50 }, { x: x + 12, y: bottom - 50 }, { x: x + 4, y: bottom - 40 }], P.orange);
      R.rect(s, x - 20, bottom - 24, 40, 3, c);
      for (const side of [-1, 1]) opoly(s, [{ x: x + side * 20, y: bottom - 16 }, { x: x + side * 30, y: bottom }, { x: x + side * 20, y: bottom }], c);
      stageLights(s, x, bottom - 14, lit);
      flame(s, x, bottom, lit, 7);
      return bottom - 36;
    },
    balloon(s, x, bottom, c, lit) {
      R.line(s, x - 12, bottom - 20, x - 22, bottom - 52, P.black);
      R.line(s, x + 12, bottom - 20, x + 22, bottom - 52, P.black);
      oo(s, x, bottom - 78, 30, 34, c);
      for (const dx of [-15, 15]) R.oval(s, x + dx, bottom - 78, 3, 30, P.white);
      orect(s, x - 14, bottom - 20, 28, 20, P.brown);
      for (let y = bottom - 16; y < bottom; y += 5) R.rect(s, x - 14, y, 28, 1, P.orange);
      stageLights(s, x, bottom - 10, lit);
      if (lit > 0) flame(s, x, bottom - 36, lit, 4);
      return bottom - 14;
    },
  };
  const VEHICLE_NAMES = Object.keys(VEHICLES);

  function vehicle(s, spec, x, bottom, lit) {
    return (VEHICLES[spec.kind] || VEHICLES.rocket)(s, x, bottom, col(spec.color, 'red'), lit);
  }

  // ---------- sky and ground presets for the behind-the-character levels ----------

  const SKIES = {
    day: [P.navy, P.blue, P.blue, P.peach],
    dawn: [P.navy, P.plum, P.pink, P.peach],
    sunset: [P.plum, P.red, P.orange, P.yellow],
    night: [P.black, P.navy, P.navy, P.plum],
    space: [P.black, P.black, P.navy, P.plum],
    candy: [P.pink, P.peach, P.pink, P.white],
    sea: [P.navy, P.navy, P.blue, P.blue],
    forest: [P.navy, P.forest, P.green, P.peach],
  };
  const FLOORS = {
    clouds: { a: P.white, b: P.silver, haze: P.silver },
    grass: { a: P.green, b: P.forest, haze: P.forest },
    sand: { a: P.peach, b: P.orange, haze: P.orange },
    water: { a: P.blue, b: P.navy, haze: P.navy },
    neon: { a: P.pink, b: P.black, haze: P.plum, grid: true },
    circuit: { a: P.green, b: P.black, haze: P.forest, grid: true },
    candy: { a: P.pink, b: P.white, haze: P.peach },
    ice: { a: P.white, b: P.blue, haze: P.blue },
    lava: { a: P.red, b: P.plum, haze: P.plum },
  };

  // ---------- the generic trip, used until (or unless) a themed one arrives ----------

  const DEFAULT_WORLD = {
    voice: { ouch: 'OUCH!', yay: 'YAY!' },
    liftoff: { title: 'Light the rocket', line: "Okay, I'm holding on! Light the engines for me. Tap when the spark hits the gold!", vehicle: { name: 'the rocket', kind: 'rocket', color: 'red' } },
    sky: { title: 'Up through the clouds', line: 'Whoa, clouds! The dark ones zap. Steer me around them, and grab every star!', sky: 'day', floor: 'clouds',
      bad: { name: 'storm clouds', icon: 'cloud', color: 'slate' }, good: { name: 'stars', icon: 'star', color: 'yellow' } },
    whale: { title: 'Sing with the whale', line: 'Is that... a WHALE? It is singing to us! Help me sing back. Hit every note!',
      singer: { name: 'the space whale', kind: 'whale', color: 'blue' }, sound: 'LA' },
    refuel: { title: 'Catch the fuel', line: 'A space station! They are tossing us fuel! Move me under the cans. Not the junk!', station: 'the halfway station',
      good: { name: 'fuel cans', icon: 'can', color: 'green' }, bad: { name: 'bits of junk', icon: 'wrench', color: 'slate' } },
    rocks: { title: 'Zap through the rocks', line: 'Rocks. So many rocks. Tap to zap them before they bonk me!', sky: 'space', floor: 'neon',
      bad: { name: 'asteroids', icon: 'rock', color: 'brown' }, good: { name: 'ice crystals', icon: 'crystal', color: 'blue' } },
    lander: { title: 'Land on the moon', line: 'There it is, the MOON! Hold to slow us down, and put me on the flashing pad. Gently!' },
    keepsake: { icon: 'star', color: 'yellow' },
  };

  // Fill any gaps, so a partial or odd world from the server still plays.
  function normalize(raw) {
    const w = JSON.parse(JSON.stringify(DEFAULT_WORLD));
    if (!raw || typeof raw !== 'object') return w;
    const str = (v, max, fb) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fb);
    const pick = (v, list, fb) => (list.includes(v) ? v : fb);
    const thing = (src, base) => ({
      name: str(src?.name, 40, base.name),
      icon: pick(src?.icon, ICON_NAMES, base.icon),
      color: pick(src?.color, COLORS, base.color),
    });
    const word = (v, fb) => (str(v, 10, fb) || fb).toUpperCase().replace(/[^A-Z0-9 !?'.-]/g, '') || fb;
    w.voice = { ouch: word(raw.voice?.ouch, w.voice.ouch), yay: word(raw.voice?.yay, w.voice.yay) };
    for (const id of ['liftoff', 'sky', 'whale', 'refuel', 'rocks', 'lander']) {
      const src = raw[id] || {};
      w[id].title = str(src.title, 40, w[id].title);
      w[id].line = str(src.line, 160, w[id].line);
    }
    const lv = raw.liftoff?.vehicle || {};
    w.liftoff.vehicle = { name: str(lv.name, 40, w.liftoff.vehicle.name), kind: pick(lv.kind, VEHICLE_NAMES, 'rocket'), color: pick(lv.color, COLORS, 'red') };
    for (const id of ['sky', 'rocks']) {
      const src = raw[id] || {};
      w[id].sky = pick(src.sky, Object.keys(SKIES), w[id].sky);
      w[id].floor = pick(src.floor, Object.keys(FLOORS), w[id].floor);
      w[id].bad = thing(src.bad, w[id].bad);
      w[id].good = thing(src.good, w[id].good);
    }
    const sg = raw.whale?.singer || {};
    w.whale.singer = { name: str(sg.name, 40, w.whale.singer.name), kind: pick(sg.kind, SINGER_NAMES, 'whale'), color: pick(sg.color, COLORS, 'blue') };
    w.whale.sound = word(raw.whale?.sound, 'LA');
    w.refuel.station = str(raw.refuel?.station, 40, w.refuel.station);
    w.refuel.good = thing(raw.refuel?.good, w.refuel.good);
    w.refuel.bad = thing(raw.refuel?.bad, w.refuel.bad);
    w.keepsake = { icon: pick(raw.keepsake?.icon, ICON_NAMES, 'star'), color: pick(raw.keepsake?.color, COLORS, 'yellow') };
    return w;
  }

  global.THEMES = { ICONS, SINGERS, VEHICLES, SKIES, FLOORS, DEFAULT_WORLD, icon, singer, vehicle, normalize };
})(window);

