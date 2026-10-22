const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine.js");

test("object probabilities do not export a faint copy of the rejected poster", () => {
  const input = Float32Array.from([0, 0.05, 0.2, 0.35, 0.5, 0.65, 1]);
  const actual = E.objectProbabilities(input);
  assert.deepEqual(Array.from(actual), [0, 0, 0, 0, 0.5, 1, 1]);
  assert.ok(input[2] > 0, "model output stays immutable");
});

test("an exclusion after automatic removal still gets an interior foreground prompt", () => {
  const w = 160,
    h = 120,
    alpha = new Uint8ClampedArray(w * h);
  // The faulty prediction contains the character, an attached poster and a logo.
  for (let y = 20; y < 105; y++)
    for (let x = 20; x < 80; x++) alpha[y * w + x] = 255;
  for (let y = 20; y < 65; y++)
    for (let x = 80; x < 145; x++) alpha[y * w + x] = 255;
  for (let y = 95; y < 108; y++)
    for (let x = 130; x < 144; x++) alpha[y * w + x] = 255;
  const seed = E.interiorSeed(alpha, w, h, [
    { mode: "negative", points: [{ x: 120 / 159, y: 40 / 119 }] },
  ]);
  assert.ok(seed);
  assert.ok(seed.x * 159 > 20 && seed.x * 159 < 80);
  assert.ok(seed.y * 119 > 20 && seed.y * 119 < 105);
  assert.equal(E.interiorSeed(new Uint8ClampedArray(w * h), w, h), null);
});

test("a guided cut drops an unrelated logo while keeping every marked character", () => {
  const w = 100,
    h = 70,
    alpha = new Uint8ClampedArray(w * h);
  for (const [x0, y0, x1, y1] of [
    [10, 10, 45, 60],
    [55, 15, 75, 55],
    [85, 55, 97, 67],
  ])
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) alpha[y * w + x] = 255;
  alpha[30 * w + 9] = 7; // soft edge adjacent to the main subject
  const actual = E.markedComponents(alpha, w, h, [
    { mode: "positive", points: [{ x: 25 / 99, y: 30 / 69 }] },
    { mode: "positive", points: [{ x: 60 / 99, y: 30 / 69 }] },
    { mode: "negative", points: [{ x: 90 / 99, y: 60 / 69 }] },
  ]);
  assert.equal(actual[30 * w + 25], 255);
  assert.equal(actual[30 * w + 60], 255);
  assert.equal(actual[60 * w + 90], 0);
  assert.equal(actual[30 * w + 9], 7);
  assert.equal(alpha[60 * w + 90], 255, "does not mutate the decoder result");
});

test("component filtering preserves thin diagonal details and safely handles ambiguous prompts", () => {
  const w = 30,
    h = 30,
    alpha = new Uint8ClampedArray(w * h);
  for (let x = 5; x < 25; x++) alpha[x * w + x] = 255;
  const result = E.markedComponents(alpha, w, h, [
    { mode: "positive", points: [{ x: 5 / 29, y: 5 / 29 }] },
  ]);
  assert.deepEqual(result, alpha);
  assert.equal(
    E.markedComponents(alpha, w, h, [
      { mode: "positive", points: [{ x: 0, y: 1 }] },
    ]),
    alpha,
  );
  assert.equal(
    E.markedComponents(alpha, w, h, [
      {
        mode: "lasso",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ]),
    alpha,
  );
});

test("removing rejects a poster, preserves covered detail and never adds background", () => {
  const previous = Uint8ClampedArray.from([255, 255, 0, 128, 255]);
  const guided = Uint8ClampedArray.from([0, 50, 255, 0, 255]);
  assert.deepEqual(
    Array.from(E.mergeGuidedDetail(previous, guided, "negative")),
    [0, 255, 0, 0, 255],
  );
  assert.deepEqual(Array.from(previous), [255, 255, 0, 128, 255]);
  assert.equal(E.mergeGuidedDetail(new Uint8ClampedArray(0), guided), guided);
});

test("keeping a missing foot cannot erase feathers or any other existing selection", () => {
  const previous = Uint8ClampedArray.from([255, 180, 0, 128, 255]);
  const guided = Uint8ClampedArray.from([0, 50, 255, 0, 255]);
  assert.deepEqual(
    Array.from(E.mergeGuidedDetail(previous, guided, "positive")),
    [255, 180, 255, 128, 255],
  );
});
