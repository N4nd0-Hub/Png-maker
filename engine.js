/* Recorta PNG — deterministic mask operations, shared by the editor and worker. */
(function (root) {
  "use strict";
  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }
  function smooth(x) {
    x = clamp(x, 0, 1);
    return x * x * (3 - 2 * x);
  }
  function luminance(data, n) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++)
      out[i] =
        (data[i * 4] * 0.299 +
          data[i * 4 + 1] * 0.587 +
          data[i * 4 + 2] * 0.114) /
        255;
    return out;
  }
  // A separable sliding box average has linear cost, independent of radius.
  function boxMean(src, w, h, radius) {
    const tmp = new Float32Array(src.length),
      out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = 0; x <= Math.min(radius, w - 1); x++) sum += src[y * w + x];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] =
          sum / (Math.min(w - 1, x + radius) - Math.max(0, x - radius) + 1);
        if (x - radius >= 0) sum -= src[y * w + x - radius];
        if (x + radius + 1 < w) sum += src[y * w + x + radius + 1];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = 0; y <= Math.min(radius, h - 1); y++) sum += tmp[y * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] =
          sum / (Math.min(h - 1, y + radius) - Math.max(0, y - radius) + 1);
        if (y - radius >= 0) sum -= tmp[(y - radius) * w + x];
        if (y + radius + 1 < h) sum += tmp[(y + radius + 1) * w + x];
      }
    }
    return out;
  }
  function sample(a, w, h, x, y) {
    x = clamp(x, 0, w - 1);
    y = clamp(y, 0, h - 1);
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      x1 = Math.min(w - 1, x0 + 1),
      y1 = Math.min(h - 1, y0 + 1),
      fx = x - x0,
      fy = y - y0;
    return (
      (a[y0 * w + x0] * (1 - fx) + a[y0 * w + x1] * fx) * (1 - fy) +
      (a[y1 * w + x0] * (1 - fx) + a[y1 * w + x1] * fx) * fy
    );
  }
  // Guided reconstruction aligns uncertain alpha with original-resolution edges.
  // Confident areas remain untouched; this never classifies foreground by color.
  function refineAlpha(probability, lowRGBA, mw, mh, rgba, w, h) {
    const n = mw * mh,
      gray = luminance(lowRGBA, n),
      meanI = boxMean(gray, mw, mh, 3),
      meanP = boxMean(probability, mw, mh, 3);
    const ii = new Float32Array(n),
      ip = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      ii[i] = gray[i] * gray[i];
      ip[i] = gray[i] * probability[i];
    }
    const corrI = boxMean(ii, mw, mh, 3),
      corrIP = boxMean(ip, mw, mh, 3),
      a = new Float32Array(n),
      b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      a[i] =
        (corrIP[i] - meanI[i] * meanP[i]) /
        (Math.max(0, corrI[i] - meanI[i] * meanI[i]) + 0.0008);
      b[i] = meanP[i] - a[i] * meanI[i];
    }
    const ma = boxMean(a, mw, mh, 3),
      mb = boxMean(b, mw, mh, 3),
      out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x,
          sx = ((x + 0.5) * mw) / w - 0.5,
          sy = ((y + 0.5) * mh) / h - 0.5,
          base = sample(probability, mw, mh, sx, sy);
        let value = base;
        if (base > 0.015 && base < 0.985) {
          const lum =
            (rgba[p * 4] * 0.299 +
              rgba[p * 4 + 1] * 0.587 +
              rgba[p * 4 + 2] * 0.114) /
            255;
          const guided = clamp(
            sample(ma, mw, mh, sx, sy) * lum + sample(mb, mw, mh, sx, sy),
            0,
            1,
          );
          value = base * 0.28 + guided * 0.72;
        }
        out[p] = Math.round(255 * smooth((value - 0.025) / 0.95));
      }
    return out;
  }
  function cleanComponents(alpha, w, h, options = {}) {
    const out = new Uint8ClampedArray(alpha),
      labels = new Int32Array(w * h),
      queue = new Int32Array(w * h),
      parts = [null];
    const strength = options.strength ?? 35,
      preserve = options.preserveDetached !== false;
    const protectedPixels = new Set(
      (options.points || [])
        .filter((p) => p.mode !== "negative")
        .flatMap((p) => p.points || [p])
        .map(
          (p) =>
            clamp(Math.round(p.y * (h - 1)), 0, h - 1) * w +
            clamp(Math.round(p.x * (w - 1)), 0, w - 1),
        ),
    );
    let count = 0,
      largest = 0;
    for (let i = 0; i < out.length; i++) {
      if (labels[i] || out[i] < 12) continue;
      count++;
      let head = 0,
        tail = 1,
        protectedPart = false;
      queue[0] = i;
      labels[i] = count;
      while (head < tail) {
        const p = queue[head++],
          x = p % w,
          y = (p / w) | 0;
        if (protectedPixels.has(p)) protectedPart = true;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++)
          for (
            let xx = Math.max(0, x - 1);
            xx <= Math.min(w - 1, x + 1);
            xx++
          ) {
            const q = yy * w + xx;
            if (!labels[q] && out[q] >= 12) {
              labels[q] = count;
              queue[tail++] = q;
            }
          }
      }
      parts.push({ area: tail, protected: protectedPart });
      if (!largest || tail > parts[largest].area) largest = count;
    }
    // Only tiny islands qualify as dust. Never silently keep just the largest body.
    const limit =
      strength === 0
        ? 0
        : Math.max(
            2,
            Math.round(
              w * h * (0.000001 + strength * 0.0000008) * (preserve ? 0.12 : 1),
            ),
          );
    const discard = new Set();
    let removed = 0,
      pixels = 0;
    for (let i = 1; i < parts.length; i++)
      if (i !== largest && !parts[i].protected && parts[i].area < limit) {
        discard.add(i);
        removed++;
        pixels += parts[i].area;
      }
    for (let i = 0; i < out.length; i++) if (discard.has(labels[i])) out[i] = 0;
    if (strength > 0)
      for (let i = 0; i < out.length; i++) {
        if (!out[i] || labels[i]) continue;
        const x = i % w,
          y = (i / w) | 0;
        let near = false;
        for (
          let yy = Math.max(0, y - 2);
          yy <= Math.min(h - 1, y + 2) && !near;
          yy++
        )
          for (
            let xx = Math.max(0, x - 2);
            xx <= Math.min(w - 1, x + 2);
            xx++
          ) {
            const label = labels[yy * w + xx];
            if (label && !discard.has(label)) {
              near = true;
              break;
            }
          }
        if (!near) {
          out[i] = 0;
          pixels++;
        }
      }
    return { alpha: out, removed, pixels, kept: count - removed };
  }
  // Border-connected color removal is reserved for simple, nearly uniform backdrops.
  function flatBackground(rgba, w, h, tolerance = 35) {
    const samples = [],
      step = Math.max(1, Math.floor(Math.min(w, h) / 40));
    for (let x = 0; x < w; x += step) {
      samples.push(x, (h - 1) * w + x);
    }
    for (let y = 0; y < h; y += step) {
      samples.push(y * w, y * w + w - 1);
    }
    const buckets = new Map();
    for (const p of samples) {
      if (rgba[p * 4 + 3] < 12) continue;
      const key = [0, 1, 2].map((k) => rgba[p * 4 + k] >> 4).join(",");
      let b = buckets.get(key);
      if (!b) {
        b = { n: 0, r: 0, g: 0, b: 0 };
        buckets.set(key, b);
      }
      b.n++;
      b.r += rgba[p * 4];
      b.g += rgba[p * 4 + 1];
      b.b += rgba[p * 4 + 2];
    }
    let best = null;
    for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
    const color = best
      ? [best.r / best.n, best.g / best.n, best.b / best.n]
      : [0, 0, 0];
    const seen = new Uint8Array(w * h),
      queue = new Int32Array(w * h);
    let head = 0,
      tail = 0;
    function push(p) {
      if (seen[p]) return;
      const k = p * 4,
        d = Math.hypot(
          rgba[k] - color[0],
          rgba[k + 1] - color[1],
          rgba[k + 2] - color[2],
        );
      if (rgba[k + 3] < 12 || d < tolerance) {
        seen[p] = 1;
        queue[tail++] = p;
      }
    }
    for (let x = 0; x < w; x++) {
      push(x);
      push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      push(y * w);
      push(y * w + w - 1);
    }
    while (head < tail) {
      const p = queue[head++],
        x = p % w,
        y = (p / w) | 0;
      if (x) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y) push(p - w);
      if (y < h - 1) push(p + w);
    }
    const alpha = new Uint8ClampedArray(w * h);
    for (let p = 0; p < alpha.length; p++) alpha[p] = seen[p] ? 0 : 255;
    return { alpha, color, removed: tail };
  }
  function reduceWhiteHalo(rgba, w, h, amount = 0.5) {
    const original = new Uint8ClampedArray(rgba);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4,
          alpha = original[k + 3] / 255;
        if (alpha < 0.02 || alpha > 0.97) continue;
        let best = -1,
          dist = Infinity;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const xx = x + dx,
              yy = y + dy,
              d = dx * dx + dy * dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || d >= dist) continue;
            const q = (yy * w + xx) * 4;
            if (original[q + 3] > 248) {
              best = q;
              dist = d;
            }
          }
        if (best < 0) continue;
        const lum = (original[k] + original[k + 1] + original[k + 2]) / 3,
          inner =
            (original[best] + original[best + 1] + original[best + 2]) / 3;
        const neutral =
          1 -
          (Math.max(original[k], original[k + 1], original[k + 2]) -
            Math.min(original[k], original[k + 1], original[k + 2])) /
            255;
        const weight =
          clamp((lum - inner) / 65, 0, 1) * neutral * (1 - alpha) * amount;
        for (let c = 0; c < 3; c++)
          rgba[k + c] = Math.round(
            original[k + c] + (original[best + c] - original[k + c]) * weight,
          );
      }
    return rgba;
  }
  function floodRegion(rgba, w, h, points, tolerance = 85, constraint = null) {
    const refs = [],
      seeds = [];
    for (const point of points) {
      const x = clamp(Math.round(point.x * (w - 1)), 0, w - 1),
        y = clamp(Math.round(point.y * (h - 1)), 0, h - 1),
        p = y * w + x,
        k = p * 4;
      if (rgba[k + 3] < 8) continue;
      seeds.push(p);
      // A narrow texture line under the cursor should not become the backdrop color.
      const buckets = new Map();
      let dominant = null;
      for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++)
        for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
          const q = (yy * w + xx) * 4;
          if (rgba[q + 3] < 8) continue;
          const key = [rgba[q] >> 4, rgba[q + 1] >> 4, rgba[q + 2] >> 4].join(
            ",",
          );
          let b = buckets.get(key);
          if (!b) {
            b = { n: 0, r: 0, g: 0, b: 0 };
            buckets.set(key, b);
          }
          b.n++;
          b.r += rgba[q];
          b.g += rgba[q + 1];
          b.b += rgba[q + 2];
          if (!dominant || b.n > dominant.n) dominant = b;
        }
      const color = dominant
        ? [
            dominant.r / dominant.n,
            dominant.g / dominant.n,
            dominant.b / dominant.n,
          ]
        : [rgba[k], rgba[k + 1], rgba[k + 2]];
      if (
        !refs.some(
          (c) =>
            Math.hypot(c[0] - color[0], c[1] - color[1], c[2] - color[2]) < 25,
        )
      )
        refs.push(color);
    }
    const region = new Uint8Array(w * h),
      seen = new Uint8Array(w * h),
      queue = new Int32Array(w * h);
    let head = 0,
      tail = 0;
    function push(p) {
      if (seen[p]) return;
      seen[p] = 1;
      if (
        constraint &&
        (constraint.negative
          ? constraint.alpha[p] === 0
          : constraint.alpha[p] > 240)
      )
        return;
      const k = p * 4;
      if (rgba[k + 3] < 8) return;
      for (const c of refs) {
        const dr = rgba[k] - c[0],
          dg = rgba[k + 1] - c[1],
          db = rgba[k + 2] - c[2];
        if (dr * dr + dg * dg + db * db <= tolerance * tolerance) {
          region[p] = 255;
          queue[tail++] = p;
          return;
        }
      }
    }
    for (const p of seeds) push(p);
    while (head < tail) {
      const p = queue[head++],
        x = p % w,
        y = (p / w) | 0;
      if (x) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y) push(p - w);
      if (y < h - 1) push(p + w);
    }
    return { alpha: region, pixels: tail };
  }
  // IS-Net does not retain the identity of a subject. If the first correction is
  // an exclusion, start the interactive model inside the current silhouette,
  // away from the excluded area. The user can replace this seed by marking the
  // character explicitly. Work on a bounded grid even for very large images.
  function interiorSeed(alpha, w, h, strokes = []) {
    const scale = Math.min(1, 320 / Math.max(w, h)),
      sw = Math.max(2, Math.round(w * scale)),
      sh = Math.max(2, Math.round(h * scale)),
      distance = new Float32Array(sw * sh),
      excluded = strokes
        .filter((s) => s.mode === "negative")
        .flatMap((s) => s.points || []);
    for (let y = 1; y < sh - 1; y++)
      for (let x = 1; x < sw - 1; x++) {
        const nx = x / (sw - 1),
          ny = y / (sh - 1),
          p = Math.round(ny * (h - 1)) * w + Math.round(nx * (w - 1));
        if (
          alpha[p] >= 160 &&
          !excluded.some(
            (q) =>
              Math.hypot((nx - q.x) * sw, (ny - q.y) * sh) <
              Math.min(sw, sh) * 0.06,
          )
        )
          distance[y * sw + x] = sw + sh;
      }
    for (let y = 1; y < sh - 1; y++)
      for (let x = 1; x < sw - 1; x++) {
        const p = y * sw + x;
        if (distance[p])
          distance[p] = Math.min(
            distance[p],
            distance[p - 1] + 1,
            distance[p - sw] + 1,
            distance[p - sw - 1] + Math.SQRT2,
            distance[p - sw + 1] + Math.SQRT2,
          );
      }
    let best = -1,
      score = 1;
    for (let y = sh - 2; y > 0; y--)
      for (let x = sw - 2; x > 0; x--) {
        const p = y * sw + x;
        if (!distance[p]) continue;
        distance[p] = Math.min(
          distance[p],
          distance[p + 1] + 1,
          distance[p + sw] + 1,
          distance[p + sw + 1] + Math.SQRT2,
          distance[p + sw - 1] + Math.SQRT2,
        );
        const centrality = 1 - 0.25 * Math.hypot(x / sw - 0.5, y / sh - 0.5),
          value = distance[p] * centrality;
        if (value > score) {
          score = value;
          best = p;
        }
      }
    return best < 0
      ? null
      : {
          x: (best % sw) / (sw - 1),
          y: Math.floor(best / sw) / (sh - 1),
        };
  }
  function objectProbabilities(probability) {
    const out = new Float32Array(probability.length);
    for (let p = 0; p < out.length; p++)
      out[p] = smooth((probability[p] - 0.35) / 0.3);
    return out;
  }
  // Let interactive inference decide which object to retain, using the previous
  // detailed silhouette to avoid making its feathers, feet or thin lines ghostly.
  // Keep is additive and remove is subtractive, even when the neural decoder
  // changes its opinion about another part of the image.
  function mergeGuidedDetail(previous, guided, mode) {
    if (previous.length !== guided.length) return guided;
    const out = new Uint8ClampedArray(guided.length);
    for (let p = 0; p < out.length; p++)
      out[p] =
        mode === "positive"
          ? Math.max(previous[p], guided[p])
          : Math.min(
              previous[p],
              Math.max(guided[p], previous[p] * smooth((guided[p] - 6) / 32)),
            );
    return out;
  }
  // Retain every component actually indicated by a positive prompt. This is
  // object selection, unlike the optional dust cleaner which preserves islands.
  // A scanline fill avoids allocating a full-resolution integer label map/queue.
  function markedComponents(alpha, w, h, strokes = []) {
    const points = strokes
      .filter((s) => s.mode === "positive")
      .flatMap((s) => s.points || []);
    if (!points.length) return alpha;
    const out = new Uint8ClampedArray(alpha.length),
      stack = [];
    for (const point of points) {
      const cx = clamp(Math.round(point.x * (w - 1)), 0, w - 1),
        cy = clamp(Math.round(point.y * (h - 1)), 0, h - 1);
      let seed = -1,
        nearest = Infinity;
      for (let y = Math.max(0, cy - 4); y <= Math.min(h - 1, cy + 4); y++)
        for (let x = Math.max(0, cx - 4); x <= Math.min(w - 1, cx + 4); x++) {
          const d = (cx - x) ** 2 + (cy - y) ** 2;
          if (alpha[y * w + x] >= 12 && d < nearest) {
            nearest = d;
            seed = y * w + x;
          }
        }
      if (seed >= 0) stack.push(seed);
    }
    // A failed/ambiguous prompt must not erase the previous decoder result.
    if (!stack.length) return alpha;
    while (stack.length) {
      const p = stack.pop();
      if (out[p] || alpha[p] < 12) continue;
      const y = Math.floor(p / w);
      let left = p % w,
        right = left;
      while (
        left > 0 &&
        alpha[y * w + left - 1] >= 12 &&
        !out[y * w + left - 1]
      )
        left--;
      while (
        right < w - 1 &&
        alpha[y * w + right + 1] >= 12 &&
        !out[y * w + right + 1]
      )
        right++;
      for (let x = left; x <= right; x++) out[y * w + x] = alpha[y * w + x];
      for (const row of [y - 1, y + 1]) {
        if (row < 0 || row >= h) continue;
        let inRun = false;
        for (
          let x = Math.max(0, left - 1);
          x <= Math.min(w - 1, right + 1);
          x++
        ) {
          const q = row * w + x,
            valid = alpha[q] >= 12 && !out[q];
          if (valid && !inRun) stack.push(q);
          inRun = valid;
        }
      }
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!alpha[p] || alpha[p] >= 12) continue;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++)
          for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++)
            if (out[yy * w + xx] >= 12) out[p] = alpha[p];
      }
    return out;
  }
  // Measure the composed image, including source transparency. Near-invisible
  // alpha left by segmentation must not keep an otherwise empty canvas frame.
  // If the entire artwork is faint, retain it instead of treating it as empty.
  function rgbaBounds(rgba, w, h, minAlpha = 8) {
    function measure(threshold) {
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (rgba[(y * w + x) * 4 + 3] < threshold) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      return maxX < 0 ? null : {
        x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
      };
    }
    return measure(minAlpha) || (minAlpha > 1 ? measure(1) : null);
  }
  const api = {
    rgbaBounds,
    boxMean,
    refineAlpha,
    cleanComponents,
    flatBackground,
    reduceWhiteHalo,
    floodRegion,
    interiorSeed,
    markedComponents,
    mergeGuidedDetail,
    objectProbabilities,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RecortaEngine = api;
})(typeof self !== "undefined" ? self : globalThis);

