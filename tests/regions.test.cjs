const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine.js");
test("a mark restores a colored wing enclosed by its outline without adding similar background", () => {
  const w = 70,
    h = 50,
    a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      const inside = x > 15 && x < 55 && y > 10 && y < 40,
        edge = x === 15 || x === 55 || y === 10 || y === 40;
      const rgb = edge
        ? [200, 125, 40]
        : inside
          ? [40, 150, 180]
          : [45, 120, 155];
      a.set([...rgb, 255], k);
    }
  const r = E.floodRegion(a, w, h, [{ x: 30 / (w - 1), y: 25 / (h - 1) }], 85);
  assert.equal(r.alpha[25 * w + 30], 255);
  assert.equal(r.alpha[0], 0);
  assert.equal(r.alpha[25 * w + 60], 0);
  assert.equal(r.alpha[25 * w + 15], 0);
});
test("negative region selection includes texture but stays in its disconnected background object", () => {
  const w = 60,
    h = 40,
    a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      let rgb = [35, 70, 85];
      if (x > 5 && x < 25 && y > 5 && y < 35)
        rgb = (x + y) % 5 === 0 ? [96, 106, 116] : [147, 112, 163];
      if (x > 40) rgb = [147, 112, 163];
      a.set([...rgb, 255], k);
    }
  const r = E.floodRegion(a, w, h, [{ x: 15 / 59, y: 15 / 39 }], 85);
  assert.equal(r.alpha[15 * w + 15], 255);
  assert.equal(r.alpha[15 * w + 16], 255);
  assert.equal(r.alpha[15 * w + 45], 0);
});
test("existing foreground outlines block restoration from leaking into a matching backdrop", () => {
  const w = 40,
    h = 30,
    a = new Uint8ClampedArray(w * h * 4),
    mask = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      a.set([40, 130, 160, 255], (y * w + x) * 4);
      if (x === 8 || x === 32 || y === 6 || y === 24) mask[y * w + x] = 255;
    }
  const r = E.floodRegion(a, w, h, [{ x: 20 / 39, y: 15 / 29 }], 120, {
    alpha: mask,
    negative: false,
  });
  assert.equal(r.alpha[15 * w + 20], 255);
  assert.equal(r.alpha[0], 0);
  assert.equal(r.alpha[15 * w + 8], 0);
});
