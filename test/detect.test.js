import { test } from 'node:test';
import assert from 'node:assert/strict';
import { luminance, thresholdMask } from '../detect.js';

// 全画素黒 (alpha 255) のフレームを作り、pixels の [x, y, value] を白系の値にする
export function makeFrame(width, height, pixels = []) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const [x, y, value = 255] of pixels) {
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = value;
  }
  return { data, width, height };
}

test('luminance は R, G, B の最大値を返す', () => {
  const data = new Uint8ClampedArray([250, 0, 0, 255, 0, 10, 200, 255]);
  assert.equal(luminance(data, 0), 250);
  assert.equal(luminance(data, 4), 200);
});

test('thresholdMask はしきい値以上の画素だけ 1 にする', () => {
  const frame = makeFrame(3, 1, [[0, 0, 240], [1, 0, 230]]);
  const mask = thresholdMask(frame, 235);
  assert.deepEqual(Array.from(mask), [1, 0, 0]);
});

test('thresholdMask はしきい値ちょうどを 1 にする', () => {
  const frame = makeFrame(1, 1, [[0, 0, 235]]);
  assert.deepEqual(Array.from(thresholdMask(frame, 235)), [1]);
});
