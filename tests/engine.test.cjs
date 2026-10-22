const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine.js");
test("optional cleanup removes faint remote dust while preserving soft edges", () => {
  const w = 30,
    h = 30,
    a = new Uint8ClampedArray(w * h);
  for (let y = 10; y < 20; y++)
    for (let x = 10; x < 20; x++) a[y * w + x] = 255;
  a[9 * w + 15] = 8;
  a[1] = 8;
  const clean = E.cleanComponents(a, w, h, { strength: 50 });
  assert.equal(clean.alpha[9 * w + 15], 8);
  assert.equal(clean.alpha[1], 0);
  const unchanged = E.cleanComponents(a, w, h, { strength: 0 });
  assert.deepEqual(unchanged.alpha, a);
});
test("box averages agree with an independent neighborhood calculation", () => {
  const w = 7,
    h = 5,
    a = Float32Array.from({ length: w * h }, (_, i) => ((i * 17) % 29) / 29);
  for (const radius of [1, 3, 9]) {
    const b = E.boxMean(a, w, h, radius);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let sum = 0,
          n = 0;
        for (
          let yy = Math.max(0, y - radius);
          yy <= Math.min(h - 1, y + radius);
          yy++
        )
          for (
            let xx = Math.max(0, x - radius);
            xx <= Math.min(w - 1, x + radius);
            xx++
          ) {
            sum += a[yy * w + xx];
            n++;
          }
        assert.ok(Math.abs(b[y * w + x] - sum / n) < 1e-6);
      }
  }
});
test("cleanup preserves separate character details and explicitly marked islands", () => {
  const w = 200,
    h = 100,
    a = new Uint8ClampedArray(w * h);
  for (let y = 20; y < 80; y++)
    for (let x = 25; x < 100; x++) a[y * w + x] = 255;
  for (let y = 25; y < 30; y++)
    for (let x = 140; x < 145; x++) a[y * w + x] = 255;
  a[180] = 255;
  a[190] = 255;
  const r = E.cleanComponents(a, w, h, {
    strength: 100,
    preserveDetached: true,
    points: [{ mode: "positive", points: [{ x: 190 / (w - 1), y: 0 }] }],
  });
  assert.equal(r.alpha[25 * w + 140], 255);
  assert.equal(r.alpha[190], 255);
  assert.equal(r.alpha[180], 0);
  assert.equal(r.removed, 1);
  assert.equal(a[180], 255);
});
test("strong cleanup never silently reduces the image to its largest component", () => {
  const w = 100,
    h = 100,
    a = new Uint8ClampedArray(w * h);
  for (let y = 10; y < 80; y++)
    for (let x = 10; x < 45; x++) a[y * w + x] = 255;
  for (let y = 20; y < 70; y++)
    for (let x = 60; x < 90; x++) a[y * w + x] = 255;
  const r = E.cleanComponents(a, w, h, {
    strength: 100,
    preserveDetached: false,
  });
  assert.equal(r.kept, 2);
  assert.equal(r.alpha[30 * w + 70], 255);
});
test("guided reconstruction retains confident thin detail and output resolution", () => {
  const mw = 8,
    mh = 8,
    w = 32,
    h = 32,
    p = new Float32Array(mw * mh),
    low = new Uint8ClampedArray(mw * mh * 4),
    full = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < mh; y++)
    for (let x = 0; x < mw; x++) {
      const i = y * mw + x;
      p[i] = x === 4 ? 1 : 0;
      low[i * 4] = low[i * 4 + 1] = low[i * 4 + 2] = x === 4 ? 20 : 230;
      low[i * 4 + 3] = 255;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      full[i * 4] =
        full[i * 4 + 1] =
        full[i * 4 + 2] =
          x >= 16 && x < 20 ? 20 : 230;
      full[i * 4 + 3] = 255;
    }
  const out = E.refineAlpha(p, low, mw, mh, full, w, h);
  assert.equal(out.length, w * h);
  assert.ok(out[16 * w + 18] > 150);
  assert.equal(out[0], 0);
});
test("uniform background flood preserves enclosed white details", () => {
  const w = 25,
    h = 25,
    a = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 5; y < 20; y++)
    for (let x = 5; x < 20; x++) {
      const k = (y * w + x) * 4;
      a[k] = 20;
      a[k + 1] = 30;
      a[k + 2] = 40;
    }
  a[(12 * w + 12) * 4] =
    a[(12 * w + 12) * 4 + 1] =
    a[(12 * w + 12) * 4 + 2] =
      255;
  const out = E.flatBackground(a, w, h, 30).alpha;
  assert.equal(out[0], 0);
  assert.equal(out[6 * w + 6], 255);
  assert.equal(out[12 * w + 12], 255);
});
test("halo reduction preserves alpha and opaque artwork", () => {
  const w = 10,
    h = 10,
    a = new Uint8ClampedArray(w * h * 4);
  for (let y = 2; y < 8; y++)
    for (let x = 2; x < 8; x++) {
      const k = (y * w + x) * 4;
      a[k] = a[k + 1] = a[k + 2] = x === 2 ? 240 : 30;
      a[k + 3] = x === 2 ? 100 : 255;
    }
  const before = new Uint8ClampedArray(a);
  E.reduceWhiteHalo(a, w, h, 0.8);
  for (let i = 0; i < w * h; i++) {
    assert.equal(a[i * 4 + 3], before[i * 4 + 3]);
    if (before[i * 4 + 3] === 255)
      assert.deepEqual(
        a.slice(i * 4, i * 4 + 4),
        before.slice(i * 4, i * 4 + 4),
      );
  }
  assert.ok(a[(4 * w + 2) * 4] < 240);
});
