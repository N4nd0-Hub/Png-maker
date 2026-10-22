/* Neural inference stays off the UI thread. No image is uploaded. */
"use strict";
importScripts("./engine.js");
const VERSION = "1.1.1";
const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@" + VERSION;
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task";
let segmenter = null,
  original = null,
  input = null,
  imageKey = "",
  loading = null;
let detailedSession = null;
const ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
const MODEL_CDN =
  "https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/";
function status(text, progress) {
  postMessage({ type: "status", text, progress });
}
async function loadDetailed() {
  if (detailedSession) return detailedSession;
  if (segmenter) {
    segmenter.close();
    segmenter = null;
    loading = null;
    imageKey = "";
  }
  status("Carregando a IA para fundos complexos…");
  if (typeof ort === "undefined") importScripts(ORT_CDN + "ort.min.js");
  ort.env.wasm.wasmPaths = ORT_CDN;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const manifestResponse = await fetch("./isnet-model.json");
  if (!manifestResponse.ok)
    throw new Error("O arquivo do modelo não foi encontrado.");
  const manifest = await manifestResponse.json(),
    bytes = new Uint8Array(manifest.size);
  let cache,
    downloaded = 0,
    next = 0;
  try {
    cache = await caches.open("recorta-isnet-v1");
  } catch (_) {}
  async function downloadChunks() {
    while (next < manifest.chunks.length) {
      const chunk = manifest.chunks[next++],
        url = MODEL_CDN + chunk.name;
      let response,
        cached = false;
      if (cache)
        try {
          response = await cache.match(url);
          cached = !!response;
        } catch (_) {}
      if (!response) response = await fetch(url);
      if (!response.ok)
        throw new Error(
          "O modelo detalhado não pôde ser baixado (" + response.status + ").",
        );
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== chunk.offsets[1] - chunk.offsets[0])
        throw new Error(
          "O download do modelo ficou incompleto. Tente novamente.",
        );
      if (self.crypto && crypto.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", buffer),
          hash = Array.from(new Uint8Array(digest), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
        if (hash !== chunk.hash)
          throw new Error(
            "Um arquivo do modelo não passou na verificação. Tente novamente.",
          );
      }
      bytes.set(new Uint8Array(buffer), chunk.offsets[0]);
      downloaded += buffer.byteLength;
      status(
        "Carregando IA detalhada · " + Math.round(downloaded / 1048576) + " MB",
        downloaded / manifest.size,
      );
      if (cache && !cached)
        try {
          await cache.put(url, new Response(buffer));
        } catch (_) {}
    }
  }
  await Promise.all([downloadChunks(), downloadChunks(), downloadChunks()]);
  status("Preparando o reconhecimento detalhado…");
  detailedSession = await ort.InferenceSession.create(bytes, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  return detailedSession;
}
async function detailedMask(data) {
  const bitmap = data.bitmap,
    c = new OffscreenCanvas(bitmap.width, bitmap.height),
    cx = c.getContext("2d", { willReadFrequently: true });
  cx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const session = await loadDetailed(),
    size = 1024,
    small = new OffscreenCanvas(size, size),
    sx = small.getContext("2d", { willReadFrequently: true });
  sx.fillStyle = "#8b8b8b";
  sx.fillRect(0, 0, size, size);
  sx.drawImage(c, 0, 0, size, size);
  const rgba = sx.getImageData(0, 0, size, size).data,
    n = size * size,
    tensor = new Float32Array(n * 3);
  for (let p = 0; p < n; p++)
    for (let channel = 0; channel < 3; channel++)
      tensor[channel * n + p] = (rgba[p * 4 + channel] - 128) / 256;
  status("Reconhecendo a silhueta no cenário…");
  const inputTensor = new ort.Tensor("float32", tensor, [1, 3, size, size]);
  let outputs;
  try {
    outputs = await session.run({ [session.inputNames[0]]: inputTensor });
  } finally {
    inputTensor.dispose();
  }
  const predicted = outputs[session.outputNames[0]];
  if (predicted.data.length !== n)
    throw new Error("O modelo detalhado retornou um formato inesperado.");
  const probability = new Float32Array(predicted.data);
  Object.values(outputs).forEach((t) => t.dispose());
  let min = Infinity,
    max = -Infinity,
    finite = 0;
  for (const v of probability)
    if (Number.isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
      finite++;
    }
  if (max - min < 0.00001 || finite !== n)
    throw new Error("O modelo detalhado retornou uma máscara inconclusiva.");
  status("Lapidando o contorno na resolução original…");
  const full = cx.getImageData(0, 0, c.width, c.height).data;
  const alpha = RecortaEngine.refineAlpha(
    probability,
    rgba,
    size,
    size,
    full,
    c.width,
    c.height,
  );
  postMessage(
    {
      type: "result",
      id: data.id,
      width: c.width,
      height: c.height,
      alpha,
      method: "complex",
    },
    [alpha.buffer],
  );
}
async function getSegmenter() {
  if (segmenter) return segmenter;
  if (loading) return loading;
  loading = (async () => {
    if (detailedSession) {
      await detailedSession.release();
      detailedSession = null;
    }
    status("Carregando o motor de seleção…");
    importScripts(CDN + "/vision_bundle.js");
    const files = await Vision.FilesetResolver.forVisionTasks(CDN + "/wasm");
    status("Baixando o modelo de IA…");
    const response = await fetch(MODEL);
    if (!response.ok)
      throw new Error(
        "Não foi possível baixar o modelo (" + response.status + ").",
      );
    let bytes;
    if (response.body) {
      const reader = response.body.getReader(),
        chunks = [],
        total = +(response.headers.get("content-length") || 0);
      let received = 0,
        last = 0;
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        chunks.push(r.value);
        received += r.value.length;
        if (received - last > 500000) {
          status(
            "Carregando IA · " + (received / 1048576).toFixed(1) + " MB",
            total ? received / total : null,
          );
          last = received;
        }
      }
      bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
    } else bytes = new Uint8Array(await response.arrayBuffer());
    status("Preparando a IA neste dispositivo…");
    segmenter = await Vision.InteractiveSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: bytes, delegate: "CPU" },
      canvas: new OffscreenCanvas(1, 1),
    });
    return segmenter;
  })();
  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}
onmessage = async function (event) {
  const data = event.data;
  try {
    if (data.type === "region") {
      const c = new OffscreenCanvas(data.bitmap.width, data.bitmap.height),
        cx = c.getContext("2d", { willReadFrequently: true });
      cx.drawImage(data.bitmap, 0, 0);
      data.bitmap.close();
      const rgba = cx.getImageData(0, 0, c.width, c.height).data,
        result = RecortaEngine.floodRegion(
          rgba,
          c.width,
          c.height,
          data.points,
          data.tolerance || 85,
          { alpha: data.alpha, negative: data.mode === "negative" },
        );
      postMessage(
        {
          type: "result",
          id: data.id,
          width: c.width,
          height: c.height,
          alpha: result.alpha,
          pixels: result.pixels,
          method: "region",
        },
        [result.alpha.buffer],
      );
      return;
    }
    if (data.type === "complex") {
      await detailedMask(data);
      return;
    }
    if (data.type === "flat") {
      const c = new OffscreenCanvas(data.bitmap.width, data.bitmap.height),
        cx = c.getContext("2d", { willReadFrequently: true });
      cx.drawImage(data.bitmap, 0, 0);
      data.bitmap.close();
      const rgba = cx.getImageData(0, 0, c.width, c.height).data,
        result = RecortaEngine.flatBackground(
          rgba,
          c.width,
          c.height,
          data.tolerance,
        );
      postMessage(
        {
          type: "result",
          id: data.id,
          width: c.width,
          height: c.height,
          alpha: result.alpha,
          method: "flat",
        },
        [result.alpha.buffer],
      );
      return;
    }
    const ai = await getSegmenter();
    if (data.bitmap) {
      const bitmap = data.bitmap;
      original = new OffscreenCanvas(bitmap.width, bitmap.height);
      original
        .getContext("2d", { willReadFrequently: true })
        .drawImage(bitmap, 0, 0);
      bitmap.close();
      const scale = Math.min(
        1,
        (data.detail ? 1920 : 1280) / Math.max(original.width, original.height),
      );
      input = new OffscreenCanvas(
        Math.max(2, Math.round(original.width * scale)),
        Math.max(2, Math.round(original.height * scale)),
      );
      const ix = input.getContext("2d", { willReadFrequently: true });
      ix.fillStyle = "#8b8b8b";
      ix.fillRect(0, 0, input.width, input.height);
      ix.drawImage(original, 0, 0, input.width, input.height);
      status("Reconhecendo o personagem e o cenário…");
      ai.setImage(input);
      imageKey = data.key;
    }
    if (!input || data.key !== imageKey)
      throw new Error("A imagem mudou. Inicie uma nova seleção.");
    status("Separando o que manter e o que remover…");
    const strokes = data.strokes.map((s) => ({
      brushMode: s.mode === "negative" ? 2 : s.mode === "lasso" ? 3 : 1,
      point: s.points || [{ x: s.x, y: s.y }],
      isCompleted: true,
    }));
    const mask = ai.segment(strokes);
    let probability,
      mw = mask.width,
      mh = mask.height;
    try {
      probability = new Float32Array(mask.getAsFloat32Array());
    } finally {
      mask.close();
    }
    status("Ajustando bordas na resolução original…");
    const low = new OffscreenCanvas(mw, mh),
      lx = low.getContext("2d", { willReadFrequently: true });
    lx.drawImage(input, 0, 0, mw, mh);
    const lowRGBA = lx.getImageData(0, 0, mw, mh).data,
      rgba = original
        .getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, original.width, original.height).data;
    const alpha = RecortaEngine.refineAlpha(
      probability,
      lowRGBA,
      mw,
      mh,
      rgba,
      original.width,
      original.height,
    );
    postMessage(
      {
        type: "result",
        id: data.id,
        width: original.width,
        height: original.height,
        alpha,
        method: "ai",
      },
      [alpha.buffer],
    );
  } catch (error) {
    if (data.bitmap)
      try {
        data.bitmap.close();
      } catch (_) {}
    postMessage({
      type: "error",
      id: data.id,
      message: error.message || String(error),
    });
  }
};
