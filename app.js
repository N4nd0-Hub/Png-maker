(function () {
  "use strict";
  var $ = function (s) {
      return document.querySelector(s);
    },
    $$ = function (s) {
      return Array.from(document.querySelectorAll(s));
    };
  var canvas = $("#canvas"),
    ctx = canvas.getContext("2d"),
    wrap = $("#wrap"),
    preview = $("#preview");
  var S = {
    image: null,
    baseCanvas: null,
    editCanvas: null,
    editVersion: 0,
    name: "",
    tool: "lasso",
    selection: null,
    draft: null,
    history: [
      { selection: null, mask: null, strokes: [], edits: [], seed: null },
    ],
    hi: 0,
    zoom: 1,
    ox: 0,
    oy: 0,
    down: false,
    pid: null,
    start: null,
    pan: null,
    space: false,
    drag: 0,
    feather: 0,
    padding: 0,
    dpr: 1,
    timer: null,
    mask: null,
    maskOverlay: null,
    maskTint: null,
    maskBounds: null,
    maskHistory: [],
    maskHi: -1,
    brush: 36,
    painting: false,
    brushLast: null,
    brushPointer: null,
    cleanupStrength: 35,
    preserveDetached: true,
    maskView: "cutout",
    illustrationMode: false,
    illustrationGuide: null,
    ai: null,
    aiModule: null,
    aiImageKey: "",
    aiBusy: false,
    aiStrokes: [],
    aiSeed: null,
    colorSample: null,
    colorHistory: [],
    colorTolerance: 70,
    colorStrength: 100,
    maskRevision: 0,
    processed: null,
    exportCache: null,
    halo: 0,
    compare: 50,
    manualEdits: [],
    currentEdit: null,
    guiding: null,
    job: 0,
    loadId: 0,
    maskOrigin: null,
  };
  var names = {
    lasso: "Livre",
    polygon: "Pontos",
    rect: "Retângulo",
    ellipse: "Elipse",
    pan: "Mover",
    mask: "Seleção inteligente",
  };
  var hints = {
    lasso: "Clique e arraste ao redor do que deseja manter",
    polygon: "Clique para criar pontos · Enter para concluir",
    rect: "Clique e arraste · Shift cria um quadrado",
    ellipse: "Clique e arraste · Shift cria um círculo",
    pan: "Arraste para reposicionar a imagem",
    aiLasso: "Contorne o personagem e solte para a IA ajustar a borda",
    aiPick: "Clique ou risque dentro do personagem que deseja manter",
    aiKeep: "Clique numa parte do objeto que faltou",
    aiRemove: "Clique num pedaço de fundo que a IA manteve",
    maskAdd: "Pinte sobre partes que a IA deve manter",
    maskErase: "Pinte sobre partes que deseja apagar",
    colorPick: "Clique na cor que deseja transformar",
  };
  function clone(v) {
    return v ? JSON.parse(JSON.stringify(v)) : null;
  }
  function say(t, type) {
    var e = $("#toast");
    e.textContent = t;
    e.className = "toast show " + (type || "");
    clearTimeout(S.timer);
    S.timer = setTimeout(function () {
      e.className = "toast";
    }, 2500);
  }
  function copyCanvas(c) {
    if (!c) return null;
    var n = document.createElement("canvas");
    n.width = c.width;
    n.height = c.height;
    n.getContext("2d").drawImage(c, 0, 0);
    return n;
  }
  function source() {
    return S.editCanvas || S.baseCanvas || S.image;
  }
  function sourceKey() {
    return S.image ? (S.image.src || S.name) + "|" + S.editVersion : "";
  }
  function refreshMask() {
    S.maskRevision++;
    S.processed = null;
    S.exportCache = null;
    S.maskBounds = null;
    if (!S.mask) {
      S.maskOverlay = null;
      S.maskTint = null;
      return;
    }
    var w = S.mask.width,
      h = S.mask.height,
      o = S.maskOverlay || document.createElement("canvas"),
      t = S.maskTint || document.createElement("canvas");
    o.width = t.width = w;
    o.height = t.height = h;
    var oc = o.getContext("2d");
    oc.fillStyle = "rgba(2,5,8,.64)";
    oc.fillRect(0, 0, w, h);
    oc.globalCompositeOperation = "destination-out";
    oc.drawImage(S.mask, 0, 0);
    var tc = t.getContext("2d");
    tc.fillStyle = "rgba(183,223,186,.36)";
    tc.fillRect(0, 0, w, h);
    tc.globalCompositeOperation = "destination-in";
    tc.drawImage(S.mask, 0, 0);
    S.maskOverlay = o;
    S.maskTint = t;
  }
  function alphaCanvas(alpha, w, h) {
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var x = c.getContext("2d"),
      im = x.createImageData(w, h);
    for (var i = 0; i < alpha.length; i++) {
      im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255;
      im.data[i * 4 + 3] = alpha[i];
    }
    x.putImageData(im, 0, 0);
    return c;
  }
  function maskAlpha(c) {
    var d = c
        .getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, c.width, c.height).data,
      a = new Uint8ClampedArray(c.width * c.height);
    for (var i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    return a;
  }
  function snapshot() {
    return {
      selection: clone(S.selection),
      mask:
        S.selection && S.selection.type === "mask" ? copyCanvas(S.mask) : null,
      strokes: clone(S.aiStrokes),
      edits: clone(S.manualEdits),
      seed: clone(S.aiSeed),
      origin: S.maskOrigin,
    };
  }
  function remember() {
    S.history = S.history.slice(0, S.hi + 1);
    S.history.push(snapshot());
    var pixels = S.history.reduce(function (n, e) {
      return n + (e.mask ? e.mask.width * e.mask.height : 0);
    }, 0);
    while (
      S.history.length > 2 &&
      (S.history.length > 14 || pixels > 24000000)
    ) {
      var old = S.history.shift();
      if (old.mask) pixels -= old.mask.width * old.mask.height;
    }
    S.hi = S.history.length - 1;
  }
  function restore(i) {
    if (i < 0 || i >= S.history.length) return;
    S.hi = i;
    var e = S.history[i];
    S.selection = clone(e.selection);
    S.mask = copyCanvas(e.mask);
    S.aiStrokes = clone(e.strokes) || [];
    S.manualEdits = clone(e.edits) || [];
    S.aiSeed = clone(e.seed);
    S.maskOrigin = e.origin;
    S.draft = null;
    refreshMask();
    ui();
    draw();
  }

  function maskBounds() {
    if (!S.mask || !S.image) return null;
    if (S.maskBounds) return S.maskBounds;
    var w = S.mask.width,
      h = S.mask.height,
      d = S.mask
        .getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, w, h).data,
      minX = w,
      minY = h,
      maxX = -1,
      maxY = -1;
    for (var y = 0; y < h; y++)
      for (var x = 0; x < w; x++)
        if (d[(y * w + x) * 4 + 3] > 1) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
    if (maxX < 0) return null;
    var sx = S.image.naturalWidth / w,
      sy = S.image.naturalHeight / h;
    S.maskBounds = {
      x: minX * sx,
      y: minY * sy,
      w: (maxX - minX + 1) * sx,
      h: (maxY - minY + 1) * sy,
    };
    return S.maskBounds;
  }
  function cleanMaskCanvas(c) {
    var r = RecortaEngine.cleanComponents(maskAlpha(c), c.width, c.height, {
      strength: S.cleanupStrength,
      preserveDetached: S.preserveDetached,
      points: S.aiStrokes,
    });
    r.canvas = alphaCanvas(r.alpha, c.width, c.height);
    return r;
  }
  function cleanupText(r) {
    $("#cleanupReport").textContent =
      r && r.pixels
        ? r.pixels.toLocaleString("pt-BR") + " pixels de resíduos removidos."
        : "Nenhum resíduo pequeno encontrado. Os detalhes foram preservados.";
  }
  function cleanCurrentMask() {
    if (!S.mask || S.aiBusy) return;
    var r = cleanMaskCanvas(S.mask);
    S.mask = r.canvas;
    refreshMask();
    remember();
    ui();
    draw();
    cleanupText(r);
    say(
      r.pixels
        ? "Pequenos resíduos removidos"
        : "Os detalhes do recorte foram preservados",
      "ok",
    );
  }
  function pushMaskHistory() {
    remember();
  }
  function setMask(c, method) {
    S.mask = c;
    S.maskOrigin = method;
    refreshMask();
    S.selection = { type: "mask" };
    S.draft = null;
    remember();
    setMaskView("cutout");
    choose("pan");
    ui();
    draw();
    var a = maskAlpha(c),
      visible = 0;
    for (var i = 0; i < a.length; i++) if (a[i] > 12) visible++;
    $("#selectionReport").textContent =
      visible / a.length > 0.96
        ? "Quase toda a imagem foi mantida. Marque o fundo para refinar."
        : "Recorte pronto. Compare com o original e marque o que faltou.";
    say(
      method === "flat"
        ? "Fundo liso removido. Confira as bordas."
        : "Seleção concluída. Você pode continuar guiando a IA.",
      "ok",
    );
  }
  var worker = null,
    pending = null,
    requestId = 0,
    workerEngine = null;
  function discardWorker() {
    if (worker) worker.terminate();
    worker = null;
    workerEngine = null;
    S.aiImageKey = "";
    S.ai = false;
  }
  function getWorker() {
    if (worker) return worker;
    worker = new Worker("./segment-worker.js?v=20261022b");
    worker.onmessage = function (event) {
      var d = event.data;
      if (d.type === "status") {
        if (!pending) return;
        $("#aiWaitTitle").textContent = d.text;
        var bar = $("#aiProgress");
        if (typeof d.progress === "number") bar.value = d.progress;
        else bar.removeAttribute("value");
        return;
      }
      if (!pending || d.id !== pending.id) return;
      var p = pending;
      pending = null;
      clearTimeout(p.timer);
      if (d.type === "error") p.reject(new Error(d.message));
      else p.resolve(d);
    };
    worker.onerror = function (event) {
      var p = pending;
      pending = null;
      discardWorker();
      if (p) {
        clearTimeout(p.timer);
        p.reject(
          new Error(
            event.message || "Não foi possível iniciar a IA neste navegador.",
          ),
        );
      }
    };
    return worker;
  }
  function askWorker(payload, bitmap) {
    return new Promise(function (resolve, reject) {
      var engine =
        payload.type === "complex"
          ? "complex"
          : payload.type === "segment"
            ? "segment"
            : "local";
      if (worker && workerEngine !== engine) discardWorker();
      workerEngine = engine;
      var id = ++requestId;
      payload.id = id;
      if (bitmap) payload.bitmap = bitmap;
      pending = {
        id: id,
        resolve: resolve,
        reject: reject,
        timer: setTimeout(function () {
          pending = null;
          discardWorker();
          reject(
            new Error(
              "A IA demorou além do esperado. Tente novamente ou use as ferramentas manuais.",
            ),
          );
        }, 180000),
      };
      try {
        getWorker().postMessage(payload, bitmap ? [bitmap] : []);
      } catch (e) {
        clearTimeout(pending.timer);
        pending = null;
        reject(e);
      }
    });
  }
  function cancelJob() {
    S.job++;
    var p = pending;
    pending = null;
    if (p) {
      clearTimeout(p.timer);
      var error = new Error("Cancelado");
      error.name = "AbortError";
      p.reject(error);
    }
    discardWorker();
    S.aiBusy = false;
    aiWait(false);
    aiState("Sob demanda");
    ui();
  }
  function aiState(text, kind) {
    var e = $("#aiState");
    e.textContent = text;
    e.className = "ai-state " + (kind || "");
  }
  function aiWait(show, title, text) {
    $("#aiWait").classList.toggle("hidden", !show);
    if (title) $("#aiWaitTitle").textContent = title;
    if (text) $("#aiWaitText").textContent = text;
    if (show) $("#aiProgress").removeAttribute("value");
  }
  function setMaskView(view) {
    S.maskView = view;
    $$("[data-mask-view]").forEach(function (b) {
      b.classList.toggle("active", b.dataset.maskView === view);
    });
    $("#compareControl").classList.toggle("hidden", view !== "compare");
    draw();
  }
  function replayEdits(mask, edits) {
    var x = mask.getContext("2d");
    edits.forEach(function (edit) {
      if (edit.spans) {
        var im = x.getImageData(0, 0, mask.width, mask.height);
        for (var i = 0; i < edit.spans.length; i += 2)
          for (
            var p = edit.spans[i];
            p < edit.spans[i] + edit.spans[i + 1];
            p++
          ) {
            im.data[p * 4] = im.data[p * 4 + 1] = im.data[p * 4 + 2] = 255;
            im.data[p * 4 + 3] = edit.mode === "erase" ? 0 : 255;
          }
        x.putImageData(im, 0, 0);
        return;
      }
      x.save();
      x.globalCompositeOperation =
        edit.mode === "erase" ? "destination-out" : "source-over";
      x.fillStyle = x.strokeStyle = "white";
      x.lineWidth = edit.radius;
      x.lineCap = x.lineJoin = "round";
      x.beginPath();
      edit.points.forEach(function (p, i) {
        if (i) x.lineTo(p.x, p.y);
        else x.moveTo(p.x, p.y);
      });
      if (edit.points.length === 1) {
        var p = edit.points[0];
        x.arc(p.x, p.y, edit.radius / 2, 0, Math.PI * 2);
        x.fill();
      } else x.stroke();
      x.restore();
    });
  }
  async function runAI(nx, ny, mode, reset, smart, stroke) {
    if (!S.image || S.aiBusy) return;
    if (reset === false && $("#regionMethod").value === "color")
      return runRegional(stroke || { mode: mode, points: [{ x: nx, y: ny }] });
    var job = ++S.job,
      previous = S.tool,
      detail = $("#detailMode").checked;
    var candidate = reset === false ? clone(S.aiStrokes) : [];
    candidate.push(
      stroke || { mode: mode || "positive", points: [{ x: nx, y: ny }] },
    );
    // IS-Net has no prompts. A correction must switch to the interactive model,
    // carrying an interior foreground seed as well as the user's exclusion.
    if (
      reset === false &&
      !candidate.some(function (s) {
        return s.mode === "positive" || s.mode === "lasso";
      })
    ) {
      var seed = RecortaEngine.interiorSeed(
        maskAlpha(S.mask),
        S.mask.width,
        S.mask.height,
        candidate,
      );
      if (!seed) {
        choose("aiPick");
        return say(
          "Marque dentro do personagem antes de remover o fundo.",
          "bad",
        );
      }
      candidate.unshift({ mode: "positive", points: [seed], inferred: true });
    }
    var requestStrokes = candidate;
    var edits = reset === false ? clone(S.manualEdits) : [],
      key = sourceKey() + "|" + detail;
    S.aiBusy = true;
    aiState("Processando…");
    ui();
    aiWait(
      true,
      "Preparando a seleção…",
      "O reconhecimento acontece no seu navegador. A primeira carga pode demorar.",
    );
    try {
      var bitmap =
        S.aiImageKey !== key ? await createImageBitmap(source()) : null;
      if (job !== S.job) {
        if (bitmap) bitmap.close();
        return;
      }
      var result = await askWorker(
        {
          type: "segment",
          key: key,
          strokes: requestStrokes,
          detail: detail,
          correction: reset === false ? mode : null,
          detailAlpha: reset === false && S.mask ? maskAlpha(S.mask) : null,
        },
        bitmap,
      );
      if (job !== S.job) return;
      var mask = alphaCanvas(result.alpha, result.width, result.height),
        nonzero = 0;
      for (var i = 0; i < result.alpha.length; i++)
        if (result.alpha[i] > 12) nonzero++;
      if (nonzero < 4)
        throw new Error(
          "A IA não encontrou o personagem. Faça um traço maior dentro dele ou use Contorno assistido.",
        );
      S.aiImageKey = key;
      S.ai = true;
      S.aiStrokes = candidate;
      S.manualEdits = edits;
      var foreground = candidate.find(function (s) {
        return s.mode === "positive";
      });
      S.aiSeed = foreground ? clone(foreground.points[0]) : null;
      replayEdits(mask, edits);
      S.aiBusy = false;
      setMask(mask, "ai");
      $("#selectionReport").textContent =
        "A IA refez o recorte com suas marcações. Sobrou cartaz? Marque para remover. Inclua partes separadas com Manter região.";
      aiState("Pronta", "ready");
    } catch (error) {
      if (job !== S.job || error.name === "AbortError") return;
      console.warn("Recorta PNG:", error.message);
      S.aiImageKey = "";
      aiState("Tentar novamente", "error");
      $("#selectionReport").textContent =
        error.message + " O recorte anterior foi preservado.";
      say(error.message, "bad");
      S.tool = previous;
    } finally {
      if (job === S.job) {
        S.aiBusy = false;
        aiWait(false);
        ui();
        draw();
      }
    }
  }
  async function runRegional(stroke) {
    if (!S.mask || S.aiBusy) return;
    var job = ++S.job;
    S.aiBusy = true;
    ui();
    aiWait(
      true,
      "Ajustando a região marcada…",
      "O editor acompanha as cores conectadas ao traço e preserva o restante do recorte.",
    );
    try {
      var bitmap = await createImageBitmap(source());
      if (job !== S.job) {
        bitmap.close();
        return;
      }
      var r = await askWorker(
        {
          type: "region",
          points: stroke.points,
          alpha: maskAlpha(S.mask),
          mode: stroke.mode,
          tolerance: +$("#regionTolerance").value,
        },
        bitmap,
      );
      if (job !== S.job) return;
      if (r.pixels > r.width * r.height * 0.8)
        throw new Error(
          "A marcação alcançou quase toda a imagem. Use um traço menor ou diminua a tolerância em Ajustar.",
        );
      var a = maskAlpha(S.mask),
        b = r.alpha,
        negative = stroke.mode === "negative";
      for (var i = 0; i < a.length; i++)
        a[i] = negative ? Math.min(a[i], 255 - b[i]) : Math.max(a[i], b[i]);
      var spans = [];
      for (var p = 0; p < b.length; ) {
        if (!b[p]) {
          p++;
          continue;
        }
        var start = p;
        while (p < b.length && b[p]) p++;
        spans.push(start, p - start);
      }
      S.manualEdits.push({ mode: negative ? "erase" : "add", spans: spans });
      S.aiBusy = false;
      // Color fills are edits, not semantic prompts for later neural inference.
      setMask(alphaCanvas(a, r.width, r.height), S.maskOrigin);
      $("#selectionReport").textContent =
        "Região ajustada pelas cores e pelo contorno. O restante do recorte foi preservado.";
      aiState("Região ajustada", "ready");
    } catch (error) {
      if (job === S.job && error.name !== "AbortError")
        say(error.message, "bad");
    } finally {
      if (job === S.job) {
        S.aiBusy = false;
        aiWait(false);
        ui();
      }
    }
  }
  async function flatBackgroundMask() {
    if (!S.image || S.aiBusy) return;
    var job = ++S.job;
    S.aiBusy = true;
    ui();
    aiWait(
      true,
      "Removendo o fundo uniforme…",
      "Apenas regiões da cor do fundo conectadas às bordas serão removidas.",
    );
    try {
      var bitmap = await createImageBitmap(source());
      if (job !== S.job) {
        bitmap.close();
        return;
      }
      var r = await askWorker(
        { type: "flat", tolerance: +$("#flatTolerance").value },
        bitmap,
      );
      if (job !== S.job) return;
      S.aiImageKey = "";
      S.aiStrokes = [];
      S.manualEdits = [];
      S.aiSeed = null;
      S.aiBusy = false;
      setMask(alphaCanvas(r.alpha, r.width, r.height), "flat");
    } catch (error) {
      if (job === S.job && error.name !== "AbortError")
        say(error.message, "bad");
    } finally {
      if (job === S.job) {
        S.aiBusy = false;
        aiWait(false);
        ui();
      }
    }
  }
  async function complexBackgroundMask() {
    if (!S.image || S.aiBusy) return;
    var job = ++S.job;
    S.aiBusy = true;
    aiState("Processando…");
    ui();
    aiWait(
      true,
      "Preparando a IA detalhada…",
      "Na primeira vez, este modo baixa um modelo de cerca de 45 MB. Depois, o navegador pode reutilizar o modelo.",
    );
    try {
      var bitmap = await createImageBitmap(source());
      if (job !== S.job) {
        bitmap.close();
        return;
      }
      var r = await askWorker({ type: "complex" }, bitmap);
      if (job !== S.job) return;
      var count = 0;
      for (var i = 0; i < r.alpha.length; i++) if (r.alpha[i] > 12) count++;
      if (count < 4)
        throw new Error(
          "A IA detalhada não encontrou o personagem. Use as marcações guiadas.",
        );
      S.aiImageKey = "";
      S.aiStrokes = [];
      S.manualEdits = [];
      S.aiSeed = null;
      S.aiBusy = false;
      setMask(alphaCanvas(r.alpha, r.width, r.height), "complex");
      aiState("IA detalhada", "ready");
    } catch (error) {
      if (job === S.job && error.name !== "AbortError") {
        discardWorker();
        aiState("Tentar novamente", "error");
        $("#selectionReport").textContent =
          "A IA detalhada não pôde concluir neste dispositivo. Seu recorte anterior foi preservado. Experimente Marcar personagem ou os pincéis.";
        say(
          "A IA detalhada não concluiu. Use as marcações guiadas ou os pincéis.",
          "bad",
        );
        console.warn("IA detalhada:", error.message);
      }
    } finally {
      if (job === S.job) {
        S.aiBusy = false;
        aiWait(false);
        ui();
      }
    }
  }
  function processedCanvas() {
    var key = [S.maskRevision, S.editVersion, S.feather, S.halo].join("|");
    if (S.processed && S.processed.key === key) return S.processed.canvas;
    var c = copyCanvas(source()),
      x = c.getContext("2d"),
      m = copyCanvas(S.mask);
    if (S.feather) {
      var blurred = document.createElement("canvas");
      blurred.width = m.width;
      blurred.height = m.height;
      var bx = blurred.getContext("2d");
      bx.filter = "blur(" + S.feather + "px)";
      bx.drawImage(m, 0, 0);
      m = blurred;
    }
    x.globalCompositeOperation = "destination-in";
    x.drawImage(m, 0, 0, c.width, c.height);
    x.globalCompositeOperation = "source-over";
    if (S.halo) {
      var im = x.getImageData(0, 0, c.width, c.height);
      RecortaEngine.reduceWhiteHalo(im.data, c.width, c.height, S.halo / 100);
      x.putImageData(im, 0, 0);
    }
    S.processed = { key: key, canvas: c };
    return c;
  }
  function drawGuides() {
    if (S.maskView !== "mask" && S.maskView !== "original" && !S.guiding)
      return;
    var strokes = S.aiStrokes.slice();
    if (S.guiding) strokes.push(S.guiding);
    strokes.forEach(function (s) {
      var pts = s.points || [{ x: s.x, y: s.y }];
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle =
        s.mode === "negative" ? "#ff7e96" : "#b7efbf";
      ctx.lineWidth = 4;
      ctx.lineJoin = ctx.lineCap = "round";
      ctx.beginPath();
      pts.forEach(function (p, i) {
        var x = S.ox + p.x * S.image.naturalWidth * S.zoom,
          y = S.oy + p.y * S.image.naturalHeight * S.zoom;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      if (pts.length === 1) {
        var p = pts[0];
        ctx.arc(
          S.ox + p.x * S.image.naturalWidth * S.zoom,
          S.oy + p.y * S.image.naturalHeight * S.zoom,
          5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      } else {
        if (s.mode === "lasso") ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  function csize() {
    return { w: canvas.width / S.dpr, h: canvas.height / S.dpr };
  }
  function resize() {
    var r = wrap.getBoundingClientRect(),
      d = Math.min(devicePixelRatio || 1, 2),
      w = Math.max(1, Math.round(r.width * d)),
      h = Math.max(1, Math.round(r.height * d));
    S.dpr = d;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      draw();
    }
  }
  function pos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function toImage(p, clamp) {
    var x = (p.x - S.ox) / S.zoom,
      y = (p.y - S.oy) / S.zoom;
    if (clamp !== false && S.image) {
      x = Math.max(0, Math.min(S.image.naturalWidth, x));
      y = Math.max(0, Math.min(S.image.naturalHeight, y));
    }
    return { x: x, y: y };
  }
  function toScreen(p) {
    return { x: S.ox + p.x * S.zoom, y: S.oy + p.y * S.zoom };
  }
  function overImage(p) {
    if (!S.image) return false;
    var q = toImage(p, false);
    return (
      q.x >= 0 &&
      q.y >= 0 &&
      q.x <= S.image.naturalWidth &&
      q.y <= S.image.naturalHeight
    );
  }
  function box(sh) {
    return {
      x: sh.w < 0 ? sh.x + sh.w : sh.x,
      y: sh.h < 0 ? sh.y + sh.h : sh.y,
      w: Math.abs(sh.w),
      h: Math.abs(sh.h),
    };
  }
  function path(c, sh, screen) {
    if (!sh) return;
    if (sh.type === "rect" || sh.type === "ellipse") {
      var b = box(sh),
        a = screen ? toScreen({ x: b.x, y: b.y }) : { x: b.x, y: b.y },
        z = screen
          ? toScreen({ x: b.x + b.w, y: b.y + b.h })
          : { x: b.x + b.w, y: b.y + b.h },
        w = z.x - a.x,
        h = z.y - a.y;
      if (sh.type === "rect") c.rect(a.x, a.y, w, h);
      else
        c.ellipse(
          a.x + w / 2,
          a.y + h / 2,
          Math.abs(w / 2),
          Math.abs(h / 2),
          0,
          0,
          Math.PI * 2,
        );
      return;
    }
    var pts = sh.points || [];
    if (!pts.length) return;
    var p = screen ? toScreen(pts[0]) : pts[0];
    c.moveTo(p.x, p.y);
    for (var i = 1; i < pts.length; i++) {
      p = screen ? toScreen(pts[i]) : pts[i];
      c.lineTo(p.x, p.y);
    }
    if (sh.closed !== false) c.closePath();
  }
  function draw() {
    var z = csize();
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.clearRect(0, 0, z.w, z.h);
    if (!S.image) return;
    var iw = S.image.naturalWidth * S.zoom,
      ih = S.image.naturalHeight * S.zoom,
      sh = S.draft || S.selection,
      isMask = !!(sh && sh.type === "mask" && S.mask);
    if (isMask && (S.maskView === "cutout" || S.maskView === "compare")) {
      ctx.drawImage(processedCanvas(), S.ox, S.oy, iw, ih);
      if (S.maskView === "compare") {
        var split = S.ox + (iw * S.compare) / 100;
        ctx.save();
        ctx.beginPath();
        ctx.rect(S.ox, S.oy, (iw * S.compare) / 100, ih);
        ctx.clip();
        ctx.drawImage(source(), S.ox, S.oy, iw, ih);
        ctx.restore();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(split, S.oy);
        ctx.lineTo(split, S.oy + ih);
        ctx.stroke();
      }
    } else ctx.drawImage(source(), S.ox, S.oy, iw, ih);
    ctx.strokeStyle = "rgba(255,255,255,.16)";
    ctx.strokeRect(S.ox - 0.5, S.oy - 0.5, iw + 1, ih + 1);
    if (isMask) {
      if (S.maskView === "mask") {
        if (S.maskOverlay) ctx.drawImage(S.maskOverlay, S.ox, S.oy, iw, ih);
        if (S.maskTint) ctx.drawImage(S.maskTint, S.ox, S.oy, iw, ih);
      }
      if (S.brushPointer && (S.tool === "maskAdd" || S.tool === "maskErase")) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(
          S.brushPointer.x,
          S.brushPointer.y,
          (S.brush * S.zoom) / 2,
          0,
          Math.PI * 2,
        );
        ctx.strokeStyle = S.tool === "maskAdd" ? "#b7efbf" : "#ff7e96";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.restore();
      }
      drawGuides();
      return;
    }
    drawGuides();
    if (!sh || (!sh.w && !sh.h && (!sh.points || sh.points.length < 2))) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, z.w, z.h);
    path(ctx, sh, true);
    ctx.fillStyle = "rgba(2,5,8,.58)";
    ctx.fill("evenodd");
    ctx.beginPath();
    path(ctx, sh, true);
    ctx.strokeStyle = "#ffb296";
    ctx.lineWidth = 2;
    ctx.setLineDash(sh.closed === false ? [7, 5] : []);
    ctx.stroke();
    if (sh.type === "polygon")
      sh.points.forEach(function (v, i) {
        var p = toScreen(v);
        ctx.beginPath();
        ctx.arc(p.x, p.y, i ? 3.5 : 5, 0, Math.PI * 2);
        ctx.fillStyle = i ? "white" : "#b7dfba";
        ctx.fill();
      });
    ctx.restore();
  }

  function fit() {
    if (!S.image) return;
    var z = csize(),
      m = Math.min(60, Math.max(24, z.w * 0.05));
    S.zoom = Math.min(
      (z.w - m * 2) / S.image.naturalWidth,
      (z.h - m * 2) / S.image.naturalHeight,
    );
    S.zoom = Math.max(0.05, Math.min(8, S.zoom));
    S.ox = (z.w - S.image.naturalWidth * S.zoom) / 2;
    S.oy = (z.h - S.image.naturalHeight * S.zoom) / 2;
    zoomUI();
    draw();
  }
  function setZoom(v, anchor) {
    if (!S.image) return;
    var z = csize(),
      p = anchor || { x: z.w / 2, y: z.h / 2 },
      ip = toImage(p, false);
    S.zoom = Math.max(0.05, Math.min(8, v));
    S.ox = p.x - ip.x * S.zoom;
    S.oy = p.y - ip.y * S.zoom;
    zoomUI();
    draw();
  }
  function zoomUI() {
    var v = Math.round(S.zoom * 100);
    $("#zoomRange").value = Math.max(5, Math.min(800, v));
    $("#zoomVal").textContent = v + "%";
  }
  function bounds(sh) {
    if (!sh || !S.image) return null;
    if (sh.type === "mask") return maskBounds();
    var b;
    if (sh.type === "rect" || sh.type === "ellipse") b = box(sh);
    else {
      var xs = sh.points.map(function (p) {
          return p.x;
        }),
        ys = sh.points.map(function (p) {
          return p.y;
        });
      b = {
        x: Math.min.apply(null, xs),
        y: Math.min.apply(null, ys),
        w: Math.max.apply(null, xs) - Math.min.apply(null, xs),
        h: Math.max.apply(null, ys) - Math.min.apply(null, ys),
      };
    }
    var x1 = Math.max(0, Math.min(S.image.naturalWidth, b.x)),
      y1 = Math.max(0, Math.min(S.image.naturalHeight, b.y)),
      x2 = Math.max(0, Math.min(S.image.naturalWidth, b.x + b.w)),
      y2 = Math.max(0, Math.min(S.image.naturalHeight, b.y + b.h));
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  }
  function valid(sh) {
    var b = bounds(sh);
    return !!(
      b &&
      b.w >= 2 &&
      b.h >= 2 &&
      (sh.type !== "mask" || S.mask) &&
      (!(sh.type === "lasso" || sh.type === "polygon") || sh.points.length >= 3)
    );
  }
  function select(sh, hist) {
    S.selection = clone(sh);
    S.draft = null;
    if (hist !== false) remember();
    ui();
    draw();
  }
  function undo() {
    if (!S.aiBusy && S.hi > 0) restore(S.hi - 1);
  }
  function redo() {
    if (!S.aiBusy && S.hi < S.history.length - 1) restore(S.hi + 1);
  }
  function clearCut() {
    if (S.aiBusy || (!S.selection && !S.draft)) return;
    S.mask = null;
    S.aiStrokes = [];
    S.manualEdits = [];
    refreshMask();
    select(null);
    say("Recorte removido");
  }
  function showPanel(panel) {
    $$("[data-panel]").forEach(function (b) {
      var active = b.dataset.panel === panel;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
      b.tabIndex = active ? 0 : -1;
    });
    $$(".editor-panel").forEach(function (e) {
      e.classList.toggle("hidden", e.id !== "panel-" + panel);
    });
  }

  function choose(t) {
    if (!S.image || S.aiBusy) return;
    if (
      (t === "maskAdd" ||
        t === "maskErase" ||
        t === "aiKeep" ||
        t === "aiRemove") &&
      (!S.mask || !S.selection || S.selection.type !== "mask")
    )
      return say("Faça uma seleção inteligente antes de refinar", "bad");
    S.draft = null;
    S.tool = t;
    if (t === "colorPick") showPanel("color");
    else if (t === "maskAdd" || t === "maskErase") showPanel("adjust");
    else if (t.indexOf("ai") === 0) showPanel("cut");
    if (
      t === "maskAdd" ||
      t === "maskErase" ||
      t === "aiKeep" ||
      t === "aiRemove"
    )
      setMaskView("mask");
    $$("[data-tool]").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tool === t);
    });
    $("#keepBtn").classList.toggle("active", t === "maskAdd");
    $("#eraseBtn").classList.toggle("active", t === "maskErase");
    $("#hint").textContent = hints[t] || "Confira o recorte sobre o xadrez";
    canvas.style.cursor =
      t === "pan"
        ? "grab"
        : t === "aiPick" ||
            t === "aiKeep" ||
            t === "aiRemove" ||
            t === "aiLasso"
          ? "cell"
          : t === "colorPick"
            ? "copy"
            : "crosshair";
    $("#finishBtn").classList.add("hidden");
    updateGuideHint();
    draw();
  }
  function finish() {
    if (!S.draft || S.draft.type !== "polygon") return;
    if (S.draft.points.length < 3)
      return say("Adicione pelo menos 3 pontos", "bad");
    S.draft.closed = true;
    select(S.draft);
    say("Recorte por pontos concluído", "ok");
  }
  function updateGuideHint() {
    var guide = $("#guideHint"),
      show = S.image && S.tool.indexOf("ai") === 0 && !S.aiBusy;
    guide.classList.toggle("hidden", !show);
    guide.textContent = hints[S.tool] || "Marque o personagem";
  }
  function ui() {
    var img = !!S.image,
      hasMask = !!(S.mask && S.selection && S.selection.type === "mask"),
      hasSelection = img && valid(S.selection),
      ready = img && (hasSelection || !!S.editCanvas),
      busy = S.aiBusy,
      rendered = ready ? output() : null;
    ready = ready && !!rendered;
    $$(".tool").forEach(function (b) {
      b.disabled =
        !img || busy || (b.hasAttribute("data-requires-mask") && !hasMask);
    });
    ["zoomRange", "zoomOut", "zoomIn", "fit"].forEach(function (id) {
      $("#" + id).disabled = !img;
    });
    [
      "aiCenter2",
      "aiPick2",
      "fakemonMode",
      "complexMode",
      "flatBg",
      "colorPickBtn",
    ].forEach(function (id) {
      $("#" + id).disabled = !img || busy;
    });
    ["aiKeep2", "aiRemove2", "keepBtn", "eraseBtn", "cleanMask"].forEach(
      function (id) {
        $("#" + id).disabled = !hasMask || busy;
      },
    );
    $$("[data-mask-view]").forEach(function (b) {
      b.disabled = !hasMask;
    });
    $("#stageControls").classList.toggle("hidden", !hasMask);
    $("#applyColor").disabled = !img || !S.colorSample || busy;
    $("#undoColor").disabled = !S.colorHistory.length || busy;
    $("#resetColor").disabled = !S.editCanvas || busy;
    $("#clear").disabled = !img || busy || (!S.selection && !S.draft);
    $("#undo").disabled = !img || busy || S.hi < 1;
    $("#redo").disabled = !img || busy || S.hi >= S.history.length - 1;
    ["download", "previewBtn", "copy"].forEach(function (id) {
      $("#" + id).disabled = !ready || busy;
    });
    $("#empty").classList.toggle("hidden", img);
    $("#dot").classList.toggle("ready", img);
    $("#shapeType").textContent = hasSelection
      ? names[S.selection.type]
      : S.editCanvas
        ? "Imagem inteira"
        : "—";
    $("#outW").textContent = rendered ? rendered.width + " px" : "—";
    $("#outH").textContent = rendered ? rendered.height + " px" : "—";
    $("#cutStatus").textContent = hasSelection && rendered
      ? rendered.width + " × " + rendered.height + " px"
      : S.editCanvas
        ? "Cores editadas"
        : "Sem recorte";
    $("#exportHint").textContent = !rendered && (hasSelection || S.editCanvas)
      ? "A imagem não contém pixels visíveis. Marque uma parte para manter."
      : rendered
      ? (S.padding ? "PNG ajustado ao personagem com a margem escolhida."
        : "PNG ajustado ao personagem, sem espaço transparente sobrando.")
        : "Seu PNG aparece aqui quando o recorte estiver pronto.";
    $("#s1").className = img ? "step done" : "step active";
    $("#s2").className = ready ? "step done" : img ? "step active" : "step";
    $("#s3").className = ready ? "step active" : "step";
    $("#finishBtn").classList.toggle(
      "hidden",
      !(S.draft && S.draft.type === "polygon" && S.draft.points.length >= 2),
    );
    updateGuideHint();
  }

  function load(file) {
    if (!file || !file.type.startsWith("image/"))
      return say("Escolha um arquivo de imagem válido", "bad");
    if (file.size > 80 * 1024 * 1024)
      return say("Use uma imagem de até 80 MB", "bad");
    if (S.aiBusy) cancelJob();
    var loadId = ++S.loadId,
      url = URL.createObjectURL(file),
      img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      if (loadId !== S.loadId) return;
      if (
        img.naturalWidth * img.naturalHeight > 24000000 ||
        Math.max(img.naturalWidth, img.naturalHeight) > 8192
      )
        return say(
          "Use uma imagem de até 24 megapixels e 8192 px por lado para editar neste navegador.",
          "bad",
        );
      S.image = img;
      S.baseCanvas = document.createElement("canvas");
      S.baseCanvas.width = img.naturalWidth;
      S.baseCanvas.height = img.naturalHeight;
      S.baseCanvas.getContext("2d").drawImage(img, 0, 0);
      S.editCanvas = null;
      S.editVersion = 0;
      S.colorHistory = [];
      S.colorSample = null;
      S.name = file.name || "imagem";
      S.selection = null;
      S.draft = null;
      S.history = [
        { selection: null, mask: null, strokes: [], edits: [], seed: null },
      ];
      S.hi = 0;
      S.mask = null;
      S.maskOverlay = null;
      S.maskTint = null;
      S.maskBounds = null;
      S.maskHistory = [];
      S.maskHi = -1;
      S.maskView = "cutout";
      S.illustrationMode = false;
      S.illustrationGuide = null;
      S.aiImageKey = "";
      S.aiStrokes = [];
      S.aiSeed = null;
      S.manualEdits = [];
      S.guiding = null;
      S.down = false;
      S.processed = null;
      S.exportCache = null;
      S.maskRevision++;
      S.tool = "aiPick";
      $$("[data-tool]").forEach(function (b) {
        b.classList.toggle("active", b.dataset.tool === "aiPick");
      });
      $$("[data-mask-view]").forEach(function (b) {
        b.classList.toggle("active", b.dataset.maskView === "cutout");
      });
      $("#keepBtn").classList.remove("active");
      $("#eraseBtn").classList.remove("active");
      $("#sourceColor").style.setProperty("--picked", "transparent");
      $("#colorState").textContent = "Escolha uma cor";
      $("#cleanupReport").textContent =
        "A limpeza é opcional. Detalhes separados do corpo são preservados.";
      $("#fileStatus").textContent = S.name;
      $("#imageStatus").textContent =
        img.naturalWidth + " × " + img.naturalHeight + " px";
      $("#hint").textContent = hints.aiPick;
      ui();
      requestAnimationFrame(function () {
        resize();
        fit();
      });
      showPanel("cut");
      $("#selectionReport").textContent =
        "Clique ou risque dentro do personagem para começar.";
      say("Imagem pronta. Marque o personagem que deseja manter.", "ok");
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      say("Não foi possível abrir esta imagem", "bad");
    };
    img.src = url;
  }
  function demo() {
    var c = document.createElement("canvas");
    c.width = 1200;
    c.height = 800;
    var d = c.getContext("2d"),
      g = d.createLinearGradient(0, 0, 1200, 800);
    g.addColorStop(0, "#293545");
    g.addColorStop(1, "#101720");
    d.fillStyle = g;
    d.fillRect(0, 0, 1200, 800);
    d.save();
    d.translate(600, 390);
    d.fillStyle = "rgba(0,0,0,.28)";
    d.beginPath();
    d.ellipse(0, 270, 285, 46, 0, 0, Math.PI * 2);
    d.fill();
    g = d.createLinearGradient(-230, -250, 250, 250);
    g.addColorStop(0, "#ffb274");
    g.addColorStop(0.5, "#ff7867");
    g.addColorStop(1, "#bd5cff");
    d.fillStyle = g;
    d.beginPath();
    d.moveTo(0, -275);
    d.bezierCurveTo(180, -255, 275, -90, 235, 80);
    d.bezierCurveTo(200, 230, 65, 285, 0, 300);
    d.bezierCurveTo(-65, 285, -200, 230, -235, 80);
    d.bezierCurveTo(-275, -90, -180, -255, 0, -275);
    d.closePath();
    d.fill();
    d.fillStyle = "rgba(255,255,255,.18)";
    d.beginPath();
    d.ellipse(-72, -95, 85, 150, -0.55, 0, Math.PI * 2);
    d.fill();
    d.fillStyle = "white";
    d.font = "800 76px system-ui";
    d.textAlign = "center";
    d.fillText("PNG", 0, 40);
    d.restore();
    d.fillStyle = "rgba(255,255,255,.72)";
    d.font = "600 26px system-ui";
    d.textAlign = "center";
    d.fillText("Contorne a forma colorida", 600, 750);
    c.toBlob(function (b) {
      load(new File([b], "imagem-de-exemplo.png", { type: "image/png" }));
    }, "image/png");
  }
  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    var max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      h = 0,
      s = 0,
      l = (max + min) / 2,
      d = max - min;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
      if (h < 0) h += 360;
    }
    return { h: h, s: s, l: l };
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s,
      x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
      m = l - c / 2,
      r = 0,
      g = 0,
      b = 0;
    if (h < 60) {
      r = c;
      g = x;
    } else if (h < 120) {
      r = x;
      g = c;
    } else if (h < 180) {
      g = c;
      b = x;
    } else if (h < 240) {
      g = x;
      b = c;
    } else if (h < 300) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255),
    ];
  }
  function hueDiff(a, b) {
    return ((a - b + 540) % 360) - 180;
  }
  function hexRgb(v) {
    v = v.replace("#", "");
    return {
      r: parseInt(v.slice(0, 2), 16),
      g: parseInt(v.slice(2, 4), 16),
      b: parseInt(v.slice(4, 6), 16),
    };
  }
  function rgbHex(r, g, b) {
    return (
      "#" +
      [r, g, b]
        .map(function (v) {
          return Math.round(v).toString(16).padStart(2, "0");
        })
        .join("")
    );
  }
  function pickColor(p) {
    if (!S.image) return;
    var x = Math.max(0, Math.min(S.image.naturalWidth - 1, Math.floor(p.x))),
      y = Math.max(0, Math.min(S.image.naturalHeight - 1, Math.floor(p.y))),
      d = source()
        .getContext("2d", { willReadFrequently: true })
        .getImageData(x, y, 1, 1).data;
    if (d[3] < 8) return say("Escolha um ponto visível da imagem", "bad");
    S.colorSample = { r: d[0], g: d[1], b: d[2], x: x, y: y };
    var hex = rgbHex(d[0], d[1], d[2]);
    $("#sourceColor").style.setProperty("--picked", hex);
    $("#colorState").textContent = hex.toUpperCase();
    ui();
    say("Cor escolhida. Selecione a nova cor e aplique.", "ok");
  }
  function selectionMaskCanvas() {
    if (!valid(S.selection)) return null;
    var c = document.createElement("canvas");
    c.width = S.image.naturalWidth;
    c.height = S.image.naturalHeight;
    var x = c.getContext("2d"),
      sh = S.selection;
    if (sh.type === "mask") x.drawImage(S.mask, 0, 0, c.width, c.height);
    else {
      x.fillStyle = "white";
      x.beginPath();
      path(x, sh, false);
      x.fill();
    }
    return c;
  }
  function applyColor() {
    if (!S.colorSample) return say("Primeiro escolha uma cor na imagem", "bad");
    var src = source(),
      out = copyCanvas(src),
      x = out.getContext("2d", { willReadFrequently: true }),
      im = x.getImageData(0, 0, out.width, out.height),
      d = im.data,
      sample = rgbToHsl(S.colorSample.r, S.colorSample.g, S.colorSample.b),
      tr = hexRgb($("#targetColor").value),
      target = rgbToHsl(tr.r, tr.g, tr.b),
      tol = S.colorTolerance,
      strength = S.colorStrength / 100,
      preserve = $("#preserveSpectrum").checked,
      mask = null;
    if ($("#colorOnlyMask").checked && valid(S.selection)) {
      var mc = selectionMaskCanvas();
      mask = mc
        .getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, mc.width, mc.height).data;
    }
    var shift = hueDiff(target.h, sample.h),
      changed = 0;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      var mw = mask ? mask[i + 3] / 255 : 1;
      if (mw <= 0) continue;
      var hsl = rgbToHsl(d[i], d[i + 1], d[i + 2]),
        w;
      if (sample.s > 0.08 && hsl.s > 0.035) {
        w = Math.max(0, 1 - Math.abs(hueDiff(hsl.h, sample.h)) / tol);
        w *= Math.min(1, hsl.s * 4);
      } else {
        var dr = d[i] - S.colorSample.r,
          dg = d[i + 1] - S.colorSample.g,
          db = d[i + 2] - S.colorSample.b,
          dist = Math.sqrt(dr * dr + dg * dg + db * db);
        w = Math.max(0, 1 - dist / (tol * 2.25));
      }
      w = w * w * (3 - 2 * w) * strength * mw;
      if (w < 0.005) continue;
      var nh = preserve ? hsl.h + shift : hsl.h + hueDiff(target.h, hsl.h) * w,
        ns = Math.max(0, Math.min(1, hsl.s + (target.s - sample.s) * w * 0.72)),
        rgb = hslToRgb(nh, ns, hsl.l);
      d[i] = Math.round(d[i] + (rgb[0] - d[i]) * w);
      d[i + 1] = Math.round(d[i + 1] + (rgb[1] - d[i + 1]) * w);
      d[i + 2] = Math.round(d[i + 2] + (rgb[2] - d[i + 2]) * w);
      changed++;
    }
    if (!changed)
      return say(
        "Nenhum tom entrou nessa faixa. Aumente a Faixa de tons.",
        "bad",
      );
    S.colorHistory.push(copyCanvas(src));
    var colorPixels = S.colorHistory.reduce(function (n, c) {
      return n + c.width * c.height;
    }, 0);
    while (
      S.colorHistory.length > 1 &&
      (S.colorHistory.length > 7 || colorPixels > 16000000)
    ) {
      var oldest = S.colorHistory.shift();
      colorPixels -= oldest.width * oldest.height;
    }
    x.putImageData(im, 0, 0);
    S.editCanvas = out;
    S.editVersion++;
    S.aiImageKey = "";
    S.processed = null;
    ui();
    draw();
    say(
      changed.toLocaleString("pt-BR") +
        " pixels recoloridos, com luz e sombra preservadas.",
      "ok",
    );
  }
  function undoColor() {
    if (!S.colorHistory.length) return;
    S.editCanvas = S.colorHistory.pop();
    S.editVersion++;
    S.aiImageKey = "";
    S.processed = null;
    ui();
    draw();
    say("Última alteração de cor desfeita", "ok");
  }
  function resetColor() {
    if (!S.editCanvas) return;
    S.editCanvas = null;
    S.colorHistory = [];
    S.editVersion++;
    S.aiImageKey = "";
    S.processed = null;
    ui();
    draw();
    say("Cores originais restauradas", "ok");
  }
  function trimOutput(out) {
    var pixels = out.getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, out.width, out.height).data,
      b = RecortaEngine.rgbaBounds(pixels, out.width, out.height);
    if (!b) return null;
    var padding = Math.max(0, Math.round(S.padding)),
      width = b.w + padding * 2, height = b.h + padding * 2;
    if (b.x === 0 && b.y === 0 && width === out.width && height === out.height && !padding)
      return out;
    var cropped = document.createElement("canvas");
    cropped.width = width;
    cropped.height = height;
    var cx = cropped.getContext("2d");
    cx.imageSmoothingEnabled = false;
    cx.drawImage(out, b.x, b.y, b.w, b.h,
      padding, padding, b.w, b.h);
    return cropped;
  }
  function output() {
    var hasSelection = valid(S.selection);
    if (!hasSelection && !S.editCanvas) return null;
    var key = [S.loadId, S.maskRevision, S.editVersion, S.feather,
      S.padding, JSON.stringify(S.selection)].join("|");
    if (S.exportCache && S.exportCache.key === key) return S.exportCache.canvas;
    function finish(out) {
      var cropped = trimOutput(out);
      S.exportCache = { key: key, canvas: cropped };
      return cropped;
    }
    var b = hasSelection
        ? bounds(S.selection)
        : { x: 0, y: 0, w: S.image.naturalWidth, h: S.image.naturalHeight },
      fp = hasSelection ? Math.ceil(S.feather * 2) : 0,
      e = hasSelection ? S.padding + fp : 0,
      out = document.createElement("canvas");
    out.width = Math.max(1, Math.ceil(b.w + e * 2));
    out.height = Math.max(1, Math.ceil(b.h + e * 2));
    var o = out.getContext("2d");
    o.imageSmoothingEnabled = false;
    if (hasSelection && S.selection.type === "mask") {
      o.drawImage(processedCanvas(), -b.x + e, -b.y + e);
      return finish(out);
    }
    o.drawImage(source(), -b.x + e, -b.y + e);
    if (!hasSelection) return finish(out);
    var mcan = document.createElement("canvas");
    mcan.width = out.width;
    mcan.height = out.height;
    var m = mcan.getContext("2d");
    m.imageSmoothingEnabled = true;
    m.imageSmoothingQuality = "high";
    if (S.feather) m.filter = "blur(" + S.feather + "px)";
    var sh = S.selection;
    if (sh.type === "mask") {
      m.drawImage(
        S.mask,
        -b.x + e,
        -b.y + e,
        S.image.naturalWidth,
        S.image.naturalHeight,
      );
    } else {
      m.fillStyle = "white";
      m.beginPath();
      if (sh.type === "rect" || sh.type === "ellipse") {
        var q = box(sh),
          x = q.x - b.x + e,
          y = q.y - b.y + e;
        if (sh.type === "rect") m.rect(x, y, q.w, q.h);
        else
          m.ellipse(
            x + q.w / 2,
            y + q.h / 2,
            q.w / 2,
            q.h / 2,
            0,
            0,
            Math.PI * 2,
          );
      } else {
        var pts = sh.points.map(function (p) {
          return { x: p.x - b.x + e, y: p.y - b.y + e };
        });
        m.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach(function (p) {
          m.lineTo(p.x, p.y);
        });
        m.closePath();
      }
      m.fill();
    }
    o.globalCompositeOperation = "destination-in";
    o.drawImage(mcan, 0, 0);
    return finish(out);
  }
  function filename() {
    var n =
      (S.name || "imagem")
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9À-ÿ_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "imagem";
    return n + (valid(S.selection) ? "-recorte.png" : "-recolorida.png");
  }
  function download() {
    var o = output();
    if (!o) return say("Faça um recorte primeiro", "bad");
    o.toBlob(function (blob) {
      if (!blob) return say("Não foi possível gerar o PNG", "bad");
      var u = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = u;
      a.download = filename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(u);
      }, 1200);
      say("PNG baixado com transparência", "ok");
    }, "image/png");
  }
  function copy() {
    var o = output();
    if (!o) return say("Faça um recorte primeiro", "bad");
    if (!navigator.clipboard || typeof ClipboardItem === "undefined")
      return say("Seu navegador não permite copiar. Use Baixar.", "bad");
    o.toBlob(async function (blob) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        say("PNG copiado", "ok");
      } catch (e) {
        say("Não foi possível copiar. Use Baixar.", "bad");
      }
    }, "image/png");
  }
  function showPreview() {
    var o = output();
    if (!o) return;
    preview.width = o.width;
    preview.height = o.height;
    preview.getContext("2d").drawImage(o, 0, 0);
    $("#previewMeta").textContent =
      o.width + " × " + o.height + " px · PNG transparente";
    $("#previewDialog").showModal();
  }
  function dragShape(type, a, p, lock) {
    var w = p.x - a.x,
      h = p.y - a.y;
    if (lock) {
      var z = Math.min(Math.abs(w), Math.abs(h));
      w = (w < 0 ? -1 : 1) * z;
      h = (h < 0 ? -1 : 1) * z;
    }
    return { type: type, x: a.x, y: a.y, w: w, h: h, closed: true };
  }
  function paintMask(p) {
    if (!S.mask) return;
    if (S.currentEdit) S.currentEdit.points.push({ x: p.x, y: p.y });
    var mx = (p.x / S.image.naturalWidth) * S.mask.width,
      my = (p.y / S.image.naturalHeight) * S.mask.height,
      scale =
        (S.mask.width / S.image.naturalWidth +
          S.mask.height / S.image.naturalHeight) /
        2,
      m = S.mask.getContext("2d");
    m.save();
    m.lineCap = "round";
    m.lineJoin = "round";
    m.lineWidth = Math.max(1, S.brush * scale);
    m.globalCompositeOperation =
      S.tool === "maskErase" ? "destination-out" : "source-over";
    m.strokeStyle = "white";
    m.fillStyle = "white";
    if (S.brushLast) {
      m.beginPath();
      m.moveTo(S.brushLast.x, S.brushLast.y);
      m.lineTo(mx, my);
      m.stroke();
    } else {
      m.beginPath();
      m.arc(mx, my, m.lineWidth / 2, 0, Math.PI * 2);
      m.fill();
    }
    m.restore();
    S.brushLast = { x: mx, y: my };
    S.maskBounds = null;
  }
  canvas.addEventListener("pointerdown", function (e) {
    if (!S.image || S.aiBusy || (e.button !== 0 && e.pointerType === "mouse"))
      return;
    var sp = pos(e),
      tool = S.space ? "pan" : S.tool;
    if (tool !== "pan" && !overImage(sp)) return;
    if (
      tool === "aiPick" ||
      tool === "aiKeep" ||
      tool === "aiRemove" ||
      tool === "aiLasso"
    ) {
      var pick = toImage(sp);
      S.down = true;
      S.pid = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      S.guiding = {
        mode:
          tool === "aiRemove"
            ? "negative"
            : tool === "aiLasso"
              ? "lasso"
              : "positive",
        points: [
          {
            x: pick.x / S.image.naturalWidth,
            y: pick.y / S.image.naturalHeight,
          },
        ],
        reset: tool === "aiPick" || tool === "aiLasso",
      };
      draw();
      return;
    }
    if (tool === "colorPick") {
      pickColor(toImage(sp));
      return;
    }
    S.down = true;
    S.pid = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    if (tool === "pan") {
      S.pan = { p: sp, x: S.ox, y: S.oy };
      canvas.style.cursor = "grabbing";
      return;
    }
    if (tool === "maskAdd" || tool === "maskErase") {
      S.painting = true;
      S.currentEdit = {
        mode: tool === "maskErase" ? "erase" : "keep",
        radius: S.brush,
        points: [],
      };
      S.brushLast = null;
      S.brushPointer = sp;
      paintMask(toImage(sp));
      refreshMask();
      draw();
      return;
    }
    var p = toImage(sp);
    if (S.tool === "polygon") {
      if (!S.draft || S.draft.type !== "polygon")
        S.draft = { type: "polygon", points: [], closed: false };
      var first = S.draft.points[0];
      if (first && S.draft.points.length >= 3) {
        var fs = toScreen(first);
        if (Math.hypot(fs.x - sp.x, fs.y - sp.y) <= 12) {
          S.down = false;
          finish();
          return;
        }
      }
      S.draft.points.push(p);
      ui();
      draw();
      return;
    }
    S.start = p;
    S.draft =
      S.tool === "lasso"
        ? { type: "lasso", points: [p], closed: false }
        : dragShape(S.tool, p, p, false);
    ui();
    draw();
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!S.image) return;
    var sp = pos(e);
    if (S.guiding && S.down && e.pointerId === S.pid) {
      var gp = toImage(sp),
        last = S.guiding.points[S.guiding.points.length - 1],
        np = {
          x: gp.x / S.image.naturalWidth,
          y: gp.y / S.image.naturalHeight,
        };
      if (
        Math.hypot(
          (np.x - last.x) * S.image.naturalWidth,
          (np.y - last.y) * S.image.naturalHeight,
        ) *
          S.zoom >
        3
      )
        S.guiding.points.push(np);
      draw();
      return;
    }
    if (S.tool === "maskAdd" || S.tool === "maskErase") {
      S.brushPointer = sp;
      if (S.down && e.pointerId === S.pid && S.painting) {
        paintMask(toImage(sp));
        refreshMask();
      }
      draw();
      if (!S.down) return;
    }
    if (!S.down || e.pointerId !== S.pid) return;
    if (S.pan) {
      S.ox = S.pan.x + sp.x - S.pan.p.x;
      S.oy = S.pan.y + sp.y - S.pan.p.y;
      draw();
      return;
    }
    var p = toImage(sp);
    if (S.tool === "lasso" && S.draft) {
      var last = S.draft.points[S.draft.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) * S.zoom > 2.2)
        S.draft.points.push(p);
    } else if ((S.tool === "rect" || S.tool === "ellipse") && S.start)
      S.draft = dragShape(S.tool, S.start, p, e.shiftKey);
    draw();
  });
  function pointerEnd(e) {
    if (!S.down || e.pointerId !== S.pid) return;
    S.down = false;
    S.pid = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (x) {}
    if (S.guiding) {
      var stroke = S.guiding;
      S.guiding = null;
      if (e.type === "pointercancel") {
        draw();
        return;
      }
      var first = stroke.points[0];
      if (stroke.mode === "lasso" && stroke.points.length < 4) {
        say("Contorne o personagem arrastando antes de soltar.", "bad");
        draw();
        return;
      }
      runAI(first.x, first.y, stroke.mode, stroke.reset, false, stroke);
      return;
    }
    if (S.painting) {
      S.painting = false;
      S.brushLast = null;
      if (S.currentEdit) S.manualEdits.push(S.currentEdit);
      S.currentEdit = null;
      refreshMask();
      pushMaskHistory();
      ui();
      draw();
      return;
    }
    if (S.pan) {
      S.pan = null;
      canvas.style.cursor = S.tool === "pan" ? "grab" : "crosshair";
      return;
    }
    if (S.tool === "polygon") return;
    if (S.draft) {
      S.draft.closed = true;
      if (valid(S.draft)) select(S.draft);
      else {
        S.draft = null;
        ui();
        draw();
      }
    }
    S.start = null;
  }
  canvas.addEventListener("pointerup", pointerEnd);
  canvas.addEventListener("pointercancel", pointerEnd);
  canvas.addEventListener(
    "wheel",
    function (e) {
      if (!S.image) return;
      e.preventDefault();
      setZoom(S.zoom * (e.deltaY > 0 ? 0.9 : 1.1), pos(e));
    },
    { passive: false },
  );
  canvas.addEventListener("pointerleave", function () {
    if (!S.down) {
      S.brushPointer = null;
      draw();
    }
  });
  $$("[data-tool]").forEach(function (b) {
    b.addEventListener("click", function () {
      choose(b.dataset.tool);
    });
  });
  $("#aiCenter").onclick = complexBackgroundMask;
  $("#aiCenter2").onclick = function () {
    runAI(0.5, 0.5, "positive", true);
  };
  $("#complexMode").onclick = complexBackgroundMask;
  $("#aiPick2").onclick = function () {
    choose("aiPick");
  };
  $("#fakemonMode").onclick = function () {
    choose("aiLasso");
  };
  $("#aiKeep2").onclick = function () {
    choose("aiKeep");
  };
  $("#aiRemove2").onclick = function () {
    choose("aiRemove");
  };
  $("#keepBtn").onclick = function () {
    choose("maskAdd");
  };
  $("#eraseBtn").onclick = function () {
    choose("maskErase");
  };
  $("#brush").oninput = function (e) {
    S.brush = +e.target.value;
    $("#brushVal").textContent = S.brush + " px";
    draw();
  };
  $("#cleanStrength").oninput = function (e) {
    S.cleanupStrength = +e.target.value;
    $("#cleanVal").textContent = S.cleanupStrength + "%";
  };
  $("#preserveDetached").onchange = function (e) {
    S.preserveDetached = e.target.checked;
  };
  $("#cleanMask").onclick = cleanCurrentMask;
  $("#flatBg").onclick = flatBackgroundMask;
  $("#regionTolerance").oninput = function (e) {
    $("#regionToleranceVal").textContent = e.target.value;
  };
  $("#flatTolerance").oninput = function (e) {
    $("#flatToleranceVal").textContent = e.target.value;
  };
  $("#halo").oninput = function (e) {
    S.halo = +e.target.value;
    $("#haloVal").textContent = S.halo + "%";
    S.processed = null;
    draw();
  };
  $("#compareRange").oninput = function (e) {
    S.compare = +e.target.value;
    draw();
  };
  $("#cancelAI").onclick = function () {
    cancelJob();
    say("Seleção cancelada");
  };
  $$("[data-panel]").forEach(function (b) {
    b.onclick = function () {
      showPanel(b.dataset.panel);
    };
    b.onkeydown = function (e) {
      var tabs = $$("[data-panel]"),
        i = tabs.indexOf(b);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        var next = tabs[(i + (e.key === "ArrowRight" ? 1 : 2)) % 3];
        showPanel(next.dataset.panel);
        next.focus();
      }
    };
  });
  $("#colorPickBtn").onclick = function () {
    choose("colorPick");
    say("Clique no fogo, pelo ou detalhe que deseja recolorir");
  };
  $("#colorTolerance").oninput = function (e) {
    S.colorTolerance = +e.target.value;
    $("#toleranceVal").textContent = S.colorTolerance + "°";
  };
  $("#colorStrength").oninput = function (e) {
    S.colorStrength = +e.target.value;
    $("#colorStrengthVal").textContent = S.colorStrength + "%";
  };
  $$(".swatch").forEach(function (b) {
    b.onclick = function () {
      $("#targetColor").value = b.dataset.color;
    };
  });
  $("#applyColor").onclick = applyColor;
  $("#undoColor").onclick = undoColor;
  $("#resetColor").onclick = resetColor;
  $("#open").onclick = function () {
    $("#fileInput").click();
  };
  $("#change").onclick = function () {
    $("#fileInput").click();
  };
  $("#fileInput").onchange = function (e) {
    if (e.target.files[0]) load(e.target.files[0]);
    e.target.value = "";
  };
  $("#demo").onclick = demo;
  $("#clear").onclick = clearCut;
  $("#undo").onclick = undo;
  $("#redo").onclick = redo;
  $("#fit").onclick = fit;
  $("#zoomOut").onclick = function () {
    setZoom(S.zoom / 1.18);
  };
  $("#zoomIn").onclick = function () {
    setZoom(S.zoom * 1.18);
  };
  $("#zoomRange").oninput = function (e) {
    setZoom(+e.target.value / 100);
  };
  $("#finishBtn").onclick = finish;
  $("#download").onclick = download;
  $("#download2").onclick = download;
  $("#copy").onclick = copy;
  $("#copy2").onclick = copy;
  $("#previewBtn").onclick = showPreview;
  $("#help").onclick = function () {
    $("#helpDialog").showModal();
  };
  $$("[data-close]").forEach(function (b) {
    b.onclick = function () {
      $("#" + b.dataset.close).close();
    };
  });
  $("#feather").oninput = function (e) {
    S.feather = +e.target.value;
    $("#featherVal").textContent = S.feather + " px";
    S.processed = null;
    ui();
    draw();
  };
  $("#padding").oninput = function (e) {
    S.padding = +e.target.value;
    $("#paddingVal").textContent = S.padding + " px";
    ui();
  };
  $$("button[data-board]").forEach(function (b) {
    b.onclick = function () {
      $$("button[data-board]").forEach(function (x) {
        x.classList.toggle("active", x === b);
      });
      wrap.dataset.board = b.dataset.board;
    };
  });
  $$("[data-mask-view]").forEach(function (b) {
    b.onclick = function () {
      if (!b.disabled) setMaskView(b.dataset.maskView);
    };
  });
  function hasFiles(e) {
    return Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes(
      "Files",
    );
  }
  window.addEventListener("dragenter", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    S.drag++;
    $("#drop").classList.add("show");
  });
  window.addEventListener("dragover", function (e) {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("dragleave", function (e) {
    if (!hasFiles(e)) return;
    S.drag = Math.max(0, S.drag - 1);
    if (!S.drag) $("#drop").classList.remove("show");
  });
  window.addEventListener("drop", function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    S.drag = 0;
    $("#drop").classList.remove("show");
    load(
      Array.from(e.dataTransfer.files).find(function (f) {
        return f.type.startsWith("image/");
      }),
    );
  });
  window.addEventListener("paste", function (e) {
    var i = Array.from((e.clipboardData && e.clipboardData.items) || []).find(
      function (x) {
        return x.type.startsWith("image/");
      },
    );
    if (i) load(i.getAsFile());
  });
  window.addEventListener("keydown", function (e) {
    if (
      ["INPUT", "TEXTAREA", "SELECT"].includes((e.target || {}).tagName) ||
      document.querySelector("dialog[open]")
    )
      return;
    if (e.key === "Escape" && S.aiBusy) {
      cancelJob();
      return;
    }
    if (S.aiBusy) return;
    if (e.code === "Space" && !e.repeat) {
      e.preventDefault();
      S.space = true;
      if (S.image) canvas.style.cursor = "grab";
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    }
    if (e.key === "Enter") finish();
    if (e.key === "Escape" && S.draft) {
      S.draft = null;
      ui();
      draw();
      say("Ação cancelada");
    }
    if ((e.key === "Delete" || e.key === "Backspace") && S.selection) {
      e.preventDefault();
      clearCut();
    }
    if ((e.key === "+" || e.key === "=") && S.image) setZoom(S.zoom * 1.15);
    if (e.key === "-" && S.image) setZoom(S.zoom / 1.15);
  });
  window.addEventListener("keyup", function (e) {
    if (e.code === "Space") {
      S.space = false;
      if (!S.pan) canvas.style.cursor = S.tool === "pan" ? "grab" : "crosshair";
    }
  });
  [$("#previewDialog"), $("#helpDialog")].forEach(function (d) {
    d.addEventListener("click", function (e) {
      var r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        d.close();
    });
  });
  new ResizeObserver(resize).observe(wrap);
  resize();
  ui();
})();

