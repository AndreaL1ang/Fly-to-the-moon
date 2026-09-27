// A tiny retro renderer. Every scene is drawn onto a 192x144 canvas using only
// the 16 colours below and whole-pixel rectangles, then CSS blows it up with
// `image-rendering: pixelated`. No anti-aliasing ever reaches the screen, so
// the palette stays exact and every edge is a crisp stair-step.
//
// It also turns the player's doodle into a pixel sprite: the drawing is sampled
// down, snapped to the palette, backed with paper and outlined in black, so it
// reads clearly against any background.

(function (global) {
  const W = 192;
  const H = 144;
  const F = 110; // focal length for the behind-the-character 3D levels

  // PICO-8's palette: loud, high contrast, instantly retro.
  const P = {
    black: '#000000', navy: '#1D2B53', plum: '#7E2553', forest: '#008751',
    brown: '#AB5236', slate: '#5F574F', silver: '#C2C3C7', white: '#FFF1E8',
    red: '#FF004D', orange: '#FFA300', yellow: '#FFEC27', green: '#00E436',
    blue: '#29ADFF', lavender: '#83769C', pink: '#FF77A8', peach: '#FFCCAA',
  };
  const rgbOf = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const packedCache = {};
  const pack = (hex) => {
    if (packedCache[hex] === undefined) {
      const [r, g, b] = rgbOf(hex);
      packedCache[hex] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
    return packedCache[hex];
  };

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- screen ----------

  function makeScreen(canvas, w, h) {
    canvas.width = w || W;
    canvas.height = h || H;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    return { canvas, g, w: canvas.width, h: canvas.height, ox: 0, oy: 0 };
  }

  function shake(s, amount) {
    s.ox = amount ? Math.round((Math.random() - 0.5) * amount * 2) : 0;
    s.oy = amount ? Math.round((Math.random() - 0.5) * amount * 2) : 0;
  }

  // ---------- pixel primitives ----------

  function rect(s, x, y, w, h, c) {
    const x0 = Math.round(x + s.ox), y0 = Math.round(y + s.oy);
    const x1 = Math.round(x + w + s.ox), y1 = Math.round(y + h + s.oy);
    if (x1 <= x0 || y1 <= y0) return;
    s.g.fillStyle = c;
    s.g.fillRect(x0, y0, x1 - x0, y1 - y0);
  }

  const px = (s, x, y, c) => rect(s, Math.round(x), Math.round(y), 1, 1, c);

  function line(s, x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    s.g.fillStyle = c;
    for (let i = 0; i < 2000; i++) {
      s.g.fillRect(x0 + s.ox, y0 + s.oy, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // Filled ellipse, one scanline at a time.
  function oval(s, cx, cy, rx, ry, c) {
    cx = Math.round(cx); cy = Math.round(cy);
    if (rx < 0.5 || ry < 0.5) { rect(s, cx, cy, 1, 1, c); return; }
    const rows = Math.ceil(ry);
    s.g.fillStyle = c;
    for (let dy = -rows; dy <= rows; dy++) {
      const k = 1 - (dy * dy) / (ry * ry);
      if (k < 0) continue;
      const hw = Math.floor(rx * Math.sqrt(k));
      s.g.fillRect(cx - hw + s.ox, cy + dy + s.oy, hw * 2 + 1, 1);
    }
  }
  const disc = (s, cx, cy, r, c) => oval(s, cx, cy, r, r, c);

  function ring(s, cx, cy, rx, ry, c) {
    const steps = Math.max(12, Math.ceil(Math.PI * 2 * Math.max(rx, ry)));
    s.g.fillStyle = c;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      s.g.fillRect(Math.round(cx + Math.cos(a) * rx) + s.ox, Math.round(cy + Math.sin(a) * ry) + s.oy, 1, 1);
    }
  }

  // Filled polygon via scanlines. pts = [{x, y}, ...]
  function poly(s, pts, c) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    s.g.fillStyle = c;
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.round(xs[k]), x1 = Math.round(xs[k + 1]);
        if (x1 > x0) s.g.fillRect(x0 + s.ox, y + s.oy, x1 - x0, 1);
      }
    }
  }

  // Horizontal colour bands: the classic arcade sky.
  function bands(s, y0, y1, colors) {
    const h = (y1 - y0) / colors.length;
    colors.forEach((c, i) => rect(s, 0, Math.round(y0 + i * h), s.w, Math.round(y0 + (i + 1) * h) - Math.round(y0 + i * h), c));
  }

  // ---------- 3x5 bitmap font ----------

  const GLYPHS = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
    E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
    I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
    M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
    Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
    Y: '101101010010010', Z: '111001010100111',
    0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
    4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
    8: '111101111101111', 9: '111101111001110',
    '.': '000000000000010', ',': '000000000010100', '!': '010010010000010', '?': '110001010000010',
    "'": '010010000000000', '-': '000000111000000', ':': '000010000010000', '/': '001001010100100',
    '+': '000010111010000', '%': '101001010100101', '(': '001010010010001', ')': '100010010010100',
    '*': '000101010101000', ' ': '000000000000000',
  };

  const textWidth = (str, scale) => Math.max(0, String(str).length * 4 * (scale || 1) - (scale || 1));

  function text(s, str, x, y, c, o) {
    o = o || {};
    const sc = o.scale || 1;
    str = String(str).toUpperCase();
    let x0 = o.align === 'center' ? x - textWidth(str, sc) / 2 : o.align === 'right' ? x - textWidth(str, sc) : x;
    x0 = Math.round(x0);
    y = Math.round(y);
    if (o.shadow) text(s, str, x0 + sc, y + sc, o.shadow, { scale: sc });
    s.g.fillStyle = c;
    for (const ch of str) {
      const glyph = GLYPHS[ch] || GLYPHS[' '];
      for (let i = 0; i < 15; i++) {
        if (glyph[i] === '1') s.g.fillRect(x0 + (i % 3) * sc + s.ox, y + Math.floor(i / 3) * sc + s.oy, sc, sc);
      }
      x0 += 4 * sc;
    }
  }

  // A pixel speech bubble whose tail points at (x, y).
  function bubble(s, x, y, str, o) {
    o = o || {};
    const tw = textWidth(str, 1);
    const bw = tw + 6, bh = 9;
    const bx = clamp(Math.round(x - bw / 2), 1, s.w - bw - 1);
    const by = Math.max(12, Math.round(y - bh - 4)); // stay clear of the HUD bar
    rect(s, bx - 1, by - 1, bw + 2, bh + 2, P.black);
    rect(s, bx, by, bw, bh, o.fill || P.white);
    rect(s, Math.round(x) - 1, by + bh, 3, 3, P.black);
    rect(s, Math.round(x), by + bh, 1, 2, o.fill || P.white);
    text(s, str, bx + 3, by + 2, o.ink || P.black);
  }

  // ---------- sprites ----------

  // Draw a sprite by its bottom-centre point. sx/sy stretch it for squash and stretch.
  function sprite(s, spr, x, y, o) {
    if (!spr) return;
    o = o || {};
    const sc = o.scale || 1;
    const w = Math.max(1, Math.round(spr.width * sc * (o.sx || 1)));
    const h = Math.max(1, Math.round(spr.height * sc * (o.sy || 1)));
    const dx = Math.round(x - w / 2 + s.ox), dy = Math.round(y - h + s.oy);
    const img = o.flash && spr.flash ? spr.flash : spr;
    if (o.flipX) {
      s.g.save();
      s.g.translate(dx + w, dy);
      s.g.scale(-1, 1);
      s.g.drawImage(img, 0, 0, w, h);
      s.g.restore();
    } else {
      s.g.drawImage(img, dx, dy, w, h);
    }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Ink colours a doodle can snap to. Dark navy is left out on purpose so dark
  // ink becomes true black, which is what gives the sprite its punch.
  const INK = ['black', 'plum', 'forest', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'lavender', 'pink', 'slate']
    .map((k) => ({ hex: P[k], rgb: rgbOf(P[k]) }));

  function nearestInk(r, g, b) {
    let best = INK[0], bestD = Infinity;
    for (const c of INK) {
      const d = (r - c.rgb[0]) ** 2 * 0.3 + (g - c.rgb[1]) ** 2 * 0.59 + (b - c.rgb[2]) ** 2 * 0.11;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best.hex;
  }

  // Turn a doodle into a pixel sprite `size` pixels across (plus a 2px border).
  async function makeSprite(dataUrl, size) {
    const img = await loadImage(dataUrl);
    const src = document.createElement('canvas');
    src.width = img.width; src.height = img.height;
    const sg = src.getContext('2d');
    sg.fillStyle = '#fff';
    sg.fillRect(0, 0, src.width, src.height);
    sg.drawImage(img, 0, 0);
    const data = sg.getImageData(0, 0, src.width, src.height).data;
    const lumAt = (i) => data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;

    // Crop to what was actually drawn, padded to a square.
    let minX = src.width, minY = src.height, maxX = -1, maxY = -1;
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        if (lumAt((y * src.width + x) * 4) < 200) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) { minX = 0; minY = 0; maxX = src.width - 1; maxY = src.height - 1; }
    const side = Math.max(maxX - minX, maxY - minY) + 1;
    const pad = Math.ceil(side * 0.04);
    const box = side + pad * 2;
    const ox = minX - pad - Math.floor((box - (maxX - minX + 1) - pad * 2) / 2);
    const oy = minY - pad - (box - (maxY - minY + 1) - pad * 2); // sit the drawing on the floor

    // Darkest-pixel sampling keeps thin pen lines alive when shrinking.
    const N = size;
    const ink = new Array(N * N).fill(null);
    const cell = box / N;
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        let best = 255, bi = -1;
        const x0 = Math.floor(ox + gx * cell), x1 = Math.floor(ox + (gx + 1) * cell);
        const y0 = Math.floor(oy + gy * cell), y1 = Math.floor(oy + (gy + 1) * cell);
        for (let y = Math.max(0, y0); y < Math.min(src.height, Math.max(y1, y0 + 1)); y++) {
          for (let x = Math.max(0, x0); x < Math.min(src.width, Math.max(x1, x0 + 1)); x++) {
            const i = (y * src.width + x) * 4;
            const l = lumAt(i);
            if (l < best) { best = l; bi = i; }
          }
        }
        if (bi >= 0 && best < 200) ink[gy * N + gx] = nearestInk(data[bi], data[bi + 1], data[bi + 2]);
      }
    }

    // Work on a grid with a 2px margin for the paper halo and the outline.
    const M = N + 4;
    const at = (x, y) => y * M + x;
    const inkG = new Array(M * M).fill(null);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) inkG[at(x + 2, y + 2)] = ink[y * N + x];
    const dilate = (mask) => {
      const out = mask.slice();
      for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
        if (mask[at(x, y)]) continue;
        for (let dy = -1; dy <= 1 && !out[at(x, y)]; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < M && ny < M && mask[at(nx, ny)]) { out[at(x, y)] = 1; break; }
        }
      }
      return out;
    };
    const inkMask = inkG.map((c) => (c ? 1 : 0));
    const grown = dilate(inkMask);
    // Anything the outside can't reach is inside the drawing: fill it with paper.
    const outside = new Uint8Array(M * M);
    const stack = [];
    for (let i = 0; i < M; i++) stack.push(at(i, 0), at(i, M - 1), at(0, i), at(M - 1, i));
    while (stack.length) {
      const i = stack.pop();
      if (outside[i] || grown[i]) continue;
      outside[i] = 1;
      const x = i % M, y = (i / M) | 0;
      if (x > 0) stack.push(i - 1); if (x < M - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - M); if (y < M - 1) stack.push(i + M);
    }
    const body = Array.from({ length: M * M }, (_, i) => (outside[i] ? 0 : 1));
    const edge = dilate(body);

    const out = document.createElement('canvas');
    out.width = M; out.height = M;
    const og = out.getContext('2d');
    const flash = document.createElement('canvas');
    flash.width = M; flash.height = M;
    const fg = flash.getContext('2d');
    for (let i = 0; i < M * M; i++) {
      const x = i % M, y = (i / M) | 0;
      let c = null;
      if (inkG[i]) c = inkG[i];
      else if (body[i]) c = P.white;
      else if (edge[i]) c = P.black;
      if (!c) continue;
      og.fillStyle = c; og.fillRect(x, y, 1, 1);
      fg.fillStyle = edge[i] && !body[i] ? P.black : P.white; fg.fillRect(x, y, 1, 1);
    }
    out.flash = flash;
    return out;
  }

  // ---------- backdrops ----------

  function makeStars(count, top, bottom) {
    return Array.from({ length: count }, () => ({
      x: Math.random() * W,
      y: top + Math.random() * (bottom - top),
      c: Math.random() > 0.8 ? P.yellow : Math.random() > 0.5 ? P.white : P.silver,
      phase: Math.random() * 10,
    }));
  }

  function drawStars(s, stars, t, dy) {
    for (const st of stars) {
      const y = ((st.y + (dy || 0)) % s.h + s.h) % s.h;
      px(s, st.x, y, st.c);
      if (Math.sin(t * 3 + st.phase) > 0.93) {
        px(s, st.x - 1, y, st.c); px(s, st.x + 1, y, st.c);
        px(s, st.x, y - 1, st.c); px(s, st.x, y + 1, st.c);
      }
    }
  }

  // The arcade floor: a checkerboard (or neon grid) receding to the horizon,
  // computed per pixel so it scrolls smoothly toward the player.
  function floor(s, o) {
    const rows = s.h - o.horizon;
    if (rows <= 0) return;
    if (!s._floor || s._floor.height !== rows) s._floor = s.g.createImageData(s.w, rows);
    const buf = new Uint32Array(s._floor.data.buffer);
    const A = pack(o.a), B = pack(o.b), HAZE = o.haze ? pack(o.haze) : null;
    const height = o.height || 40, tile = o.tile || 24, camX = o.camX || 0, camZ = o.camZ || 0;
    for (let row = 0; row < rows; row++) {
      const z = (height * F) / (row + 0.5);
      const wz = z + camZ;
      const scale = z / F;
      const zBand = Math.floor(wz / tile) & 1;
      const zLine = ((wz % tile) + tile) % tile < Math.max(1.2, scale * 1.2);
      // Near the horizon a tile is only a pixel or two wide and would shimmer
      // into noise, so those rows become a flat haze band instead.
      if (HAZE && tile / scale < 12) { buf.fill(HAZE, row * s.w, (row + 1) * s.w); continue; }
      for (let x = 0; x < s.w; x++) {
        const wx = (x - s.w / 2) * scale + camX;
        let color;
        if (o.grid) {
          const xLine = ((wx % tile) + tile) % tile < Math.max(1, scale);
          color = xLine || zLine ? A : B;
        } else {
          color = (Math.floor(wx / tile) & 1) ^ zBand ? A : B;
        }
        buf[row * s.w + x] = color;
      }
    }
    s.g.putImageData(s._floor, 0, o.horizon);
  }

  // Behind-the-character projection. Positive y is down; the floor sits at y = height.
  function project(x, y, z, horizon) {
    const k = F / Math.max(1, z);
    return { x: W / 2 + x * k, y: horizon + y * k, s: k };
  }

  // ---------- input ----------

  function makeInput(canvas) {
    // keys = held right now; presses = every key pressed since the last frame, so a
    // tap too quick to still be held when the frame runs is never lost.
    const input = { nx: 0, ny: 0, x: W / 2, y: H / 2, down: false, tapped: false, keys: new Set(), presses: [], taps: [] };
    const read = (e) => {
      const r = canvas.getBoundingClientRect();
      input.nx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      input.ny = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
      input.x = ((input.nx + 1) / 2) * canvas.width;
      input.y = ((input.ny + 1) / 2) * canvas.height;
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
      read(e);
      input.down = true;
      input.tapped = true;
      input.taps.push({ nx: input.nx, ny: input.ny, x: input.x, y: input.y });
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', read);
    ['pointerup', 'pointercancel'].forEach((evt) => canvas.addEventListener(evt, () => { input.down = false; }));
    // Ignore the keyboard while the player is typing into a form.
    const typing = (e) => e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    global.addEventListener('keydown', (e) => {
      if (e.repeat || typing(e)) return;
      input.keys.add(e.key);
      input.presses.push(e.key);
      if (e.key === ' ') { input.tapped = true; input.down = true; e.preventDefault(); }
    });
    global.addEventListener('keyup', (e) => {
      input.keys.delete(e.key);
      if (e.key === ' ') input.down = false;
    });
    input.axis = () => {
      let x = input.nx, y = input.ny;
      if (input.keys.has('ArrowLeft') || input.keys.has('a')) x = -1;
      if (input.keys.has('ArrowRight') || input.keys.has('d')) x = 1;
      if (input.keys.has('ArrowUp') || input.keys.has('w')) y = -1;
      if (input.keys.has('ArrowDown') || input.keys.has('s')) y = 1;
      return { x, y };
    };
    input.clear = () => { input.tapped = false; input.taps.length = 0; input.presses.length = 0; };
    return input;
  }

  // ---------- loop ----------

  // Runs frames until `step` returns a value, then resolves with it.
  function loop(step) {
    return new Promise((resolve) => {
      let last = performance.now();
      let t = 0;
      const frame = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        t += dt;
        const out = step(dt, t);
        if (out !== undefined && out !== null) return resolve(out);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  global.R = {
    W, H, F, P, clamp, lerp, makeScreen, shake, rect, px, line, oval, disc, ring, poly, bands,
    text, textWidth, bubble, sprite, makeSprite, makeStars, drawStars, floor, project, makeInput, loop,
  };
})(window);
