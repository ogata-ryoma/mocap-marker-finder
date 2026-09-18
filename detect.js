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
