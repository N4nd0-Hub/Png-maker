const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const E = require("../engine.js");

test("interactive worker sends positive and negative prompts to the model, reuses the image and removes unrelated islands", async () => {
  const w = 64,
    h = 48,
    calls = [],
    messages = [];
  const probability = new Float32Array(w * h);
  for (let y = 8; y < 40; y++)
    for (let x = 8; x < 36; x++) probability[y * w + x] = 1;
  for (let y = 35; y < 43; y++)
    for (let x = 52; x < 60; x++) probability[y * w + x] = 1;
  class Canvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext() {
      return {
        fillRect() {},
        drawImage() {},
        getImageData: () => {
          const data = new Uint8ClampedArray(this.width * this.height * 4);
          data.fill(128);
          for (let i = 3; i < data.length; i += 4) data[i] = 255;
          return { data };
        },
      };
    }
  }
  const fixtureAI = {
    setImage() {
      calls.push("image");
    },
    segment(strokes) {
      calls.push(strokes);
      return {
        width: w,
        height: h,
        getAsFloat32Array: () => probability,
        close() {},
      };
    },
  };
  const sandbox = vm.createContext({
    RecortaEngine: E,
    OffscreenCanvas: Canvas,
    fixtureAI,
    importScripts() {},
    postMessage: (m) => messages.push(m),
  });
  vm.runInContext(
    fs.readFileSync(require.resolve("../segment-worker.js"), "utf8"),
    sandbox,
  );
  vm.runInContext("segmenter = fixtureAI;", sandbox);
  const strokes = [
    { mode: "positive", points: [{ x: 20 / 63, y: 20 / 47 }] },
    { mode: "negative", points: [{ x: 50 / 63, y: 15 / 47 }] },
  ];
  await sandbox.onmessage({
    data: {
      id: 1,
      type: "segment",
      key: "poster",
      strokes,
      bitmap: { width: w, height: h, close() {} },
    },
  });
  const result = messages.find((m) => m.type === "result");
  assert.ok(result, JSON.stringify(messages));
  assert.equal(calls[0], "image");
  assert.equal(calls[1][0].brushMode, 1);
  assert.equal(calls[1][1].brushMode, 2);
  assert.equal(calls[1][1].point[0].x, strokes[1].points[0].x);
  assert.equal(result.alpha[20 * w + 20], 255);
  assert.equal(result.alpha[39 * w + 55], 0);
  assert.equal(result.width, w);
  assert.equal(result.height, h);
  await sandbox.onmessage({
    data: { id: 2, type: "segment", key: "poster", strokes },
  });
  assert.equal(calls.filter((v) => v === "image").length, 1);
  assert.ok(messages.some((m) => m.id === 2 && m.type === "result"));
});
