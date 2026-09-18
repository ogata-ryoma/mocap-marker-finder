// detect.js — 純関数のみ。DOM やカメラ API には触れない。
// frame は { data: Uint8ClampedArray (RGBA), width: number, height: number }

export function luminance(data, i) {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const rg = r > g ? r : g;
  return rg > b ? rg : b;
}

export function thresholdMask(frame, threshold) {
  const { data, width, height } = frame;
  const n = width * height;
  const mask = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    mask[p] = luminance(data, i) >= threshold ? 1 : 0;
  }
  return mask;
}

// 4 近傍の連結成分ラベリング。スタックを使った反復版（再帰しない）。
export function findBlobs(mask, width, height, minArea) {
  const n = width * height;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const blobs = [];

  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;

    let sp = 0;
    let area = 0, sumX = 0, sumY = 0;
    let minX = width, maxX = -1, minY = height, maxY = -1;
    const push = (r) => {
      if (mask[r] && !seen[r]) { seen[r] = 1; stack[sp++] = r; }
    };

    push(start);
    while (sp > 0) {
      const q = stack[--sp];
      const x = q % width;
      const y = (q - x) / width;
      area++; sumX += x; sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0) push(q - 1);
      if (x < width - 1) push(q + 1);
      if (y > 0) push(q - width);
      if (y < height - 1) push(q + width);
    }

    if (area >= minArea) {
      blobs.push({
        x: sumX / area,
        y: sumY / area,
        area,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      });
    }
  }

  blobs.sort((a, b) => b.area - a.area);
  return blobs;
}

export function detect(frame, { threshold, minArea }) {
  const mask = thresholdMask(frame, threshold);
  return findBlobs(mask, frame.width, frame.height, minArea);
}

export function diffFrames(on, off) {
  if (on.width !== off.width || on.height !== off.height) {
    throw new Error('frame size mismatch');
  }
  const n = on.width * on.height;
  const out = new Uint8ClampedArray(n * 4);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const v = Math.max(0, luminance(on.data, i) - luminance(off.data, i));
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { data: out, width: on.width, height: on.height };
}
