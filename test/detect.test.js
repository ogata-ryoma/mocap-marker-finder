import { test } from 'node:test';
import assert from 'node:assert/strict';
import { luminance, thresholdMask, findBlobs, detect, diffFrames } from '../detect.js';

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

test('findBlobs は 2x2 の塊を 1 個として重心と面積を返す', () => {
  const frame = makeFrame(5, 5, [[1, 1], [2, 1], [1, 2], [2, 2]]);
  const blobs = findBlobs(thresholdMask(frame, 235), 5, 5, 1);
  assert.equal(blobs.length, 1);
  assert.deepEqual(blobs[0], { x: 1.5, y: 1.5, area: 4, width: 2, height: 2 });
});

test('findBlobs は離れた塊を別々に数え、面積の降順に並べる', () => {
  const frame = makeFrame(8, 3, [[0, 0], [5, 0], [6, 0], [5, 1]]);
  const blobs = findBlobs(thresholdMask(frame, 235), 8, 3, 1);
  assert.equal(blobs.length, 2);
  assert.equal(blobs[0].area, 3);
  assert.equal(blobs[1].area, 1);
});

test('findBlobs は斜めに接する画素を別の塊にする (4 近傍)', () => {
  const frame = makeFrame(3, 3, [[0, 0], [1, 1]]);
  const blobs = findBlobs(thresholdMask(frame, 235), 3, 3, 1);
  assert.equal(blobs.length, 2);
});

test('findBlobs は最小面積未満の塊を捨てる', () => {
  const frame = makeFrame(4, 1, [[0, 0], [2, 0], [3, 0]]);
  const blobs = findBlobs(thresholdMask(frame, 235), 4, 1, 2);
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].area, 2);
});

test('findBlobs は右端と次の行の左端をつなげない', () => {
  const frame = makeFrame(5, 2, [[4, 0], [0, 1]]);
  const blobs = findBlobs(thresholdMask(frame, 235), 5, 2, 1);
  assert.equal(blobs.length, 2);
});

test('findBlobs は塊が無ければ空配列を返す', () => {
  const frame = makeFrame(3, 3);
  assert.deepEqual(findBlobs(thresholdMask(frame, 235), 3, 3, 1), []);
});

test('detect はしきい値化と塊抽出をつなぐ', () => {
  const frame = makeFrame(4, 4, [[1, 1, 250], [2, 1, 250], [3, 3, 100]]);
  const blobs = detect(frame, { threshold: 235, minArea: 1 });
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].area, 2);
});

test('diffFrames は点灯側が明るい画素の差を返し、消灯側が明るい画素は 0 にする', () => {
  const on = makeFrame(2, 1, [[0, 0, 200], [1, 0, 50]]);
  const off = makeFrame(2, 1, [[0, 0, 50], [1, 0, 200]]);
  const diff = diffFrames(on, off);
  assert.equal(diff.width, 2);
  assert.equal(diff.height, 1);
  assert.deepEqual(Array.from(diff.data), [150, 150, 150, 255, 0, 0, 0, 255]);
});

test('diffFrames はサイズが違えば投げる', () => {
  assert.throws(() => diffFrames(makeFrame(2, 1), makeFrame(1, 1)), /frame size mismatch/);
});

test('diffFrames の結果はそのまま detect に渡せる', () => {
  const on = makeFrame(3, 1, [[1, 0, 255]]);
  const off = makeFrame(3, 1, [[1, 0, 100]]);
  const blobs = detect(diffFrames(on, off), { threshold: 80, minArea: 1 });
  assert.equal(blobs.length, 1);
  assert.equal(blobs[0].x, 1);
});
