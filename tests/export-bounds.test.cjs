const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine.js");

function pixels(w, h) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  return { rgba, paint(x, y, width, height, alpha = 255) {
    for (let yy = y; yy < y + height; yy++)
      for (let xx = x; xx < x + width; xx++)
        rgba.set([125, 80, 50, alpha], (yy * w + xx) * 4);
  } };
}

test("PNG bounds follow the visible character, not the original square", () => {
  const p = pixels(100, 100);
  p.paint(35, 12, 22, 68);
  assert.deepEqual(E.rgbaBounds(p.rgba, 100, 100), { x: 35, y: 12, w: 22, h: 68 });
});

test("invisible RGB and faint remote segmentation residue do not retain the frame", () => {
  const p = pixels(100, 90);
  p.paint(0, 0, 100, 90, 0); // RGB exists but all those pixels are transparent
  p.paint(20, 15, 12, 30);
  p.paint(0, 0, 1, 1, 1);
  p.paint(99, 89, 1, 1, 7);
  p.paint(19, 20, 1, 3, 8); // visible soft edge must be retained
  assert.deepEqual(E.rgbaBounds(p.rgba, 100, 90), { x: 19, y: 15, w: 13, h: 30 });
});

test("separate visible details and artwork touching image borders are preserved", () => {
  const p = pixels(80, 70);
  p.paint(20, 10, 12, 30);
  p.paint(60, 0, 3, 3);
  p.paint(0, 68, 2, 2);
  assert.deepEqual(E.rgbaBounds(p.rgba, 80, 70), { x: 0, y: 0, w: 63, h: 70 });
});

test("entirely faint intentional artwork is cropped without being deleted", () => {
  const p = pixels(80, 70);
  p.paint(12, 20, 5, 8, 4);
  assert.deepEqual(E.rgbaBounds(p.rgba, 80, 70), { x: 12, y: 20, w: 5, h: 8 });
});

test("empty images are reported as empty and a single visible pixel is valid", () => {
  const p = pixels(10, 10);
  assert.equal(E.rgbaBounds(p.rgba, 10, 10), null);
  p.paint(9, 9, 1, 1);
  assert.deepEqual(E.rgbaBounds(p.rgba, 10, 10), { x: 9, y: 9, w: 1, h: 1 });
});
