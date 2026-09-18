# mocap-marker-finder 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iPhone の Safari でライト（torch）を点け、再帰反射マーカーが光る点に赤丸を付けて迷子マーカーを探す静的 Web ページを作り、GitHub Pages で配信する。

**Architecture:** ビルド無しの静的ページ 4 ファイル構成。`detect.js`（しきい値化、連結成分、差分）と `blink.js`（torch 点滅のスケジューラ）は DOM に触れない純粋なモジュールで Node のテストで固める。`camera.js` がブラウザのカメラ API を包み、`app.js` が 3 画面（待機、検出中、非対応）の状態遷移と描画ループを持つ。

**Tech Stack:** HTML / CSS / JavaScript（ES modules）、Node 24 の `node --test`、gh CLI、GitHub Pages。外部ライブラリなし。

**Spec:** `docs/superpowers/specs/2026-09-18-mocap-marker-finder-design.md`

## Global Constraints

- 外部ライブラリなし、ビルドなし。`index.html` を HTTPS で開けば動く
- `detect.js` と `blink.js` は DOM とカメラ API に依存しない（Node で import できること）
- UI の文言は日本語のみ
- 作業画像は幅 480 px（高さは比率維持）
- 輝度は `max(R, G, B)`。しきい値の初期値は通常 235、差分 80。最小面積の初期値は 2 px
- 連結成分は 4 近傍。赤丸は面積の降順に上位 50 個、半径は `max(8, sqrt(面積) × 1.6)` px
- 差分モードは torch の切り替え完了から 260 ms 待ってフレームを取る
- 非対応判定はカメラ許可の**後**、torch の点灯を試みてから行う。条件は「点灯の applyConstraints が失敗」または「成功しても capabilities に torch が無く、`getSettings().torch` も true にならない」。iOS の版番号では判定しない
- 停止、`visibilitychange`（非表示）、`pagehide` で torch を消してトラックを止める
- エラーと状態変化は画面内のログ欄に出す
- リポジトリは非公開で作り、Pages 有効化の直前に公開へ切り替える。公開への切り替えは実行前にユーザーに一言確認する
- commit メッセージに署名や attribution の行は付けない
- バグ修正が発生したら、ユーザーの CLAUDE.md に従い「修正 → ユーザー実機検証 OK → commit」の 3 step を分ける（新機能の commit は各タスク末尾で行ってよい）
- `npm test` の結果行は reporter によって `# pass N`（TAP）か `ℹ pass N`（spec）と表示される。数だけを見る
- 開発用に URL クエリ `?skipTorch` を付けると torch の門を飛ばす（PC のブラウザで検出ループを動かすため）。README には書かない

## ファイル構成

```
/
├── index.html                 3 画面の骨組み
├── style.css                  見た目
├── app.js                     状態遷移、描画ループ、ログ、UI の配線
├── camera.js                  getUserMedia、torch、zoom、停止（ブラウザ専用。純関数 hasTorch / zoomRange だけ Node でテスト）
├── detect.js                  純関数: thresholdMask / findBlobs / diffFrames / normalizeDiff
├── blink.js                   torch 点滅スケジューラ（依存注入）
├── scripts/serve.js           ローカル確認用の静的サーバー
├── test/
│   ├── detect.test.js
│   ├── blink.test.js
│   └── camera.test.js
├── package.json               "type": "module"、test / serve スクリプト
├── .nojekyll                  GitHub Pages で Jekyll を通さない
├── .gitignore
├── README.md
└── docs/
    ├── CONTEXT.md
    ├── adr/0001-web-first-with-native-fallback.md
    ├── verification.md        実機検証の記録（Task 12 で作る）
    └── superpowers/{specs,plans}/
```

---

### Task 1: リポジトリの初期 commit（docs と足場）

**Files:**
- Create: `.gitignore`
- Create: `.nojekyll`
- Create: `package.json`
- Commit: `docs/` 配下の既存ファイル（CONTEXT.md、ADR、設計書、この計画）

**Interfaces:**
- Produces: `npm test` が `node --test` を実行する package.json。以降のタスクはこれを使う

- [ ] **Step 1: 現状を確認する**

Run: `git -C D:/Repository/mocap-marker-finder status --short`
Expected: `docs/` 配下が untracked として並ぶ。他には何も無い

- [ ] **Step 2: .gitignore を書く**

```gitignore
node_modules/
.playwright-mcp/
*.log
```

- [ ] **Step 3: .nojekyll を空ファイルとして作る**

Run (Git Bash): `: > D:/Repository/mocap-marker-finder/.nojekyll`

- [ ] **Step 4: package.json を書く**

```json
{
  "name": "mocap-marker-finder",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "iPhone のライトで再帰反射マーカーを光らせて迷子マーカーを探す静的ページ",
  "scripts": {
    "test": "node --test",
    "serve": "node scripts/serve.js"
  },
  "engines": {
    "node": ">=22"
  }
}
```

- [ ] **Step 5: テストが 0 件で正常終了することを確かめる**

Run: `cd D:/Repository/mocap-marker-finder && npm test`
Expected: `tests 0` を含む出力で終了コード 0

- [ ] **Step 6: Commit**

```bash
cd D:/Repository/mocap-marker-finder
git add .gitignore .nojekyll package.json docs/
git commit -m "chore: 初期の足場と設計書、用語集、ADR を追加"
```

---

### Task 2: detect.js の thresholdMask（輝度しきい値）

**Files:**
- Create: `detect.js`
- Test: `test/detect.test.js`

**Interfaces:**
- Produces:
  - `luminance(data: Uint8ClampedArray, i: number): number` … RGBA の先頭インデックス `i` の画素の `max(R, G, B)`
  - `thresholdMask(frame: { data, width, height }, threshold: number): Uint8Array` … 画素ごとに 1 か 0。長さ `width * height`
  - テスト補助 `makeFrame(width, height, pixels)` は `test/detect.test.js` 内に定義し、以降のテストでも使う

- [ ] **Step 1: 失敗するテストを書く**

`test/detect.test.js`:

```js
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
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `cd D:/Repository/mocap-marker-finder && npm test`
Expected: FAIL。`Cannot find module` か `detect.js` が無い旨のエラー

- [ ] **Step 3: 最小実装を書く**

`detect.js`:

```js
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
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test`
Expected: PASS。`pass 3`

- [ ] **Step 5: Commit**

```bash
git add detect.js test/detect.test.js
git commit -m "feat: 輝度しきい値で 2 値マスクを作る thresholdMask を追加"
```

---

### Task 3: detect.js の findBlobs（4 近傍の連結成分）

**Files:**
- Modify: `detect.js`（末尾に追記）
- Modify: `test/detect.test.js`（末尾に追記）

**Interfaces:**
- Consumes: `thresholdMask`、`makeFrame`（Task 2）
- Produces:
  - `findBlobs(mask: Uint8Array, width: number, height: number, minArea: number): Blob[]`
  - `Blob = { x: number, y: number, area: number, width: number, height: number }`（`x`, `y` は重心。面積の降順）
  - `detect(frame, { threshold, minArea }): Blob[]`（thresholdMask と findBlobs をつなぐ）

- [ ] **Step 1: 失敗するテストを書く**

`test/detect.test.js` の import を差し替え、末尾に追記:

```js
import { luminance, thresholdMask, findBlobs, detect } from '../detect.js';
```

```js
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
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test`
Expected: FAIL。`findBlobs` / `detect` が export されていない旨のエラー

- [ ] **Step 3: 実装を書く**

`detect.js` の末尾に追記:

```js
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
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test`
Expected: PASS。`pass 10`

- [ ] **Step 5: Commit**

```bash
git add detect.js test/detect.test.js
git commit -m "feat: 4 近傍の連結成分で塊を抽出する findBlobs と detect を追加"
```

---

### Task 4: detect.js の diffFrames（点灯と消灯の差分）

**Files:**
- Modify: `detect.js`（末尾に追記）
- Modify: `test/detect.test.js`（末尾に追記）

**Interfaces:**
- Produces: `diffFrames(on: Frame, off: Frame): Frame` … 画素ごとに `max(0, lum(on) - lum(off))` をグレーで持つ RGBA フレーム。alpha は 255。サイズ不一致は `Error('frame size mismatch')`

- [ ] **Step 1: 失敗するテストを書く**

`test/detect.test.js` の import に `diffFrames` を足し、末尾に追記:

```js
import { luminance, thresholdMask, findBlobs, detect, diffFrames } from '../detect.js';
```

```js
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
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test`
Expected: FAIL。`diffFrames` が無い

- [ ] **Step 3: 実装を書く**

`detect.js` の末尾に追記:

```js
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
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test`
Expected: PASS。`pass 13`

- [ ] **Step 5: Commit**

```bash
git add detect.js test/detect.test.js
git commit -m "feat: 点灯と消灯フレームの輝度差を取る diffFrames を追加"
```

---

### Task 5: blink.js（torch 点滅スケジューラ）

**Files:**
- Create: `blink.js`
- Test: `test/blink.test.js`

**Interfaces:**
- Produces: `createBlinker({ setTorch, grabFrame, onPair, onError, settleMs = 260, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout })`
  - `setTorch(on: boolean): Promise<void>`（注入）
  - `grabFrame(): Frame`（注入）
  - `onPair(onFrame: Frame, offFrame: Frame): void`（点灯・消灯の両方が揃うたびに呼ぶ）
  - `onError(err: Error): void`（setTorch が reject したら 1 回呼び、止まる）
  - 戻り値 `{ start(): void, stop(): void, get running(): boolean }`
  - 動作: `start()` → torch ON → settleMs 待つ → grabFrame（点灯）→ torch OFF → settleMs 待つ → grabFrame（消灯）→ onPair → 繰り返し

- [ ] **Step 1: 失敗するテストを書く**

`test/blink.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlinker } from '../blink.js';

// await 中のマイクロタスクを流す
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('点灯 → 消灯の順で torch を切り替え、両方揃ったら onPair を呼ぶ', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const torchCalls = [];
  let frameNo = 0;
  const pairs = [];
  const blinker = createBlinker({
    setTorch: async (on) => { torchCalls.push(on); },
    grabFrame: () => ({ id: ++frameNo }),
    onPair: (on, off) => pairs.push([on.id, off.id]),
    settleMs: 260,
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
  });

  blinker.start();
  await flush();
  assert.deepEqual(torchCalls, [true]);
  assert.equal(pairs.length, 0);

  t.mock.timers.tick(260);
  await flush();
  assert.deepEqual(torchCalls, [true, false]);
  assert.equal(pairs.length, 0);

  t.mock.timers.tick(260);
  await flush();
  assert.deepEqual(pairs, [[1, 2]]);

  t.mock.timers.tick(260);
  await flush();
  t.mock.timers.tick(260);
  await flush();
  assert.deepEqual(pairs, [[1, 2], [3, 2], [3, 4]]);
  blinker.stop();
});

test('stop 以降は torch を切り替えず onPair も呼ばない', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const torchCalls = [];
  const pairs = [];
  const blinker = createBlinker({
    setTorch: async (on) => { torchCalls.push(on); },
    grabFrame: () => ({}),
    onPair: () => pairs.push(1),
    settleMs: 260,
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
  });
  blinker.start();
  await flush();
  blinker.stop();
  assert.equal(blinker.running, false);
  t.mock.timers.tick(1000);
  await flush();
  assert.deepEqual(torchCalls, [true]);
  assert.equal(pairs.length, 0);
});

test('setTorch が失敗したら onError を呼んで止まる', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const errors = [];
  const blinker = createBlinker({
    setTorch: async () => { throw new Error('torch failed'); },
    grabFrame: () => ({}),
    onPair: () => {},
    onError: (e) => errors.push(e.message),
    settleMs: 260,
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
  });
  blinker.start();
  await flush();
  assert.deepEqual(errors, ['torch failed']);
  assert.equal(blinker.running, false);
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test`
Expected: FAIL。`blink.js` が無い

- [ ] **Step 3: 実装を書く**

`blink.js`:

```js
// blink.js — torch を点滅させ、点灯フレームと消灯フレームの組を作る。
// 依存（torch の操作、フレーム取得、タイマー）はすべて注入する。Node のテストで差し替えるため。

export function createBlinker({
  setTorch,
  grabFrame,
  onPair,
  onError = () => {},
  settleMs = 260,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  let running = false;
  let timer = 0;
  let onFrame = null;
  let offFrame = null;

  async function step(state) {
    if (!running) return;
    try {
      await setTorch(state);
    } catch (err) {
      running = false;
      onError(err);
      return;
    }
    if (!running) return;
    timer = setTimeoutFn(() => {
      if (!running) return;
      const frame = grabFrame();
      if (state) onFrame = frame; else offFrame = frame;
      if (onFrame && offFrame) onPair(onFrame, offFrame);
      step(!state);
    }, settleMs);
  }

  return {
    start() {
      if (running) return;
      running = true;
      onFrame = null;
      offFrame = null;
      step(true);
    },
    stop() {
      running = false;
      clearTimeoutFn(timer);
    },
    get running() {
      return running;
    },
  };
}
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test`
Expected: PASS。`pass 16`

- [ ] **Step 5: Commit**

```bash
git add blink.js test/blink.test.js
git commit -m "feat: torch 点滅で点灯と消灯フレームの組を作る createBlinker を追加"
```

---

### Task 6: camera.js（カメラ API の包み）

**Files:**
- Create: `camera.js`
- Test: `test/camera.test.js`（純関数 `hasTorch` と `zoomRange` のみ）

**Interfaces:**
- Produces:
  - `openCamera(deviceId?: string): Promise<{ stream: MediaStream, track: MediaStreamTrack, caps: object }>`
  - `hasTorch(caps): boolean` … `caps.torch === true` または `[true]` を含む配列なら true
  - `zoomRange(caps): { min, max, step } | null`
  - `setTorch(track, on: boolean): Promise<void>` … `advanced` 形式で失敗したら平の形式で再試行
  - `setZoom(track, value: number): Promise<void>`
  - `closeCamera(cam): Promise<void>` … torch を消し（失敗は無視）、全トラックを stop

- [ ] **Step 1: 失敗するテストを書く**

`test/camera.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasTorch, zoomRange } from '../camera.js';

test('hasTorch は boolean true と配列 [true] を受け付ける', () => {
  assert.equal(hasTorch({ torch: true }), true);
  assert.equal(hasTorch({ torch: [true] }), true);
  assert.equal(hasTorch({ torch: [false, true] }), true);
});

test('hasTorch は無い、false、[false] を拒む', () => {
  assert.equal(hasTorch({}), false);
  assert.equal(hasTorch({ torch: false }), false);
  assert.equal(hasTorch({ torch: [false] }), false);
});

test('zoomRange は min/max/step を返し、無ければ null', () => {
  assert.deepEqual(zoomRange({ zoom: { min: 1, max: 5, step: 0.5 } }), { min: 1, max: 5, step: 0.5 });
  assert.deepEqual(zoomRange({ zoom: { max: 3 } }), { min: 1, max: 3, step: 0.1 });
  assert.equal(zoomRange({}), null);
  assert.equal(zoomRange({ zoom: {} }), null);
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test`
Expected: FAIL。`camera.js` が無い

- [ ] **Step 3: 実装を書く**

`camera.js`:

```js
// camera.js — getUserMedia、torch、zoom、停止。ブラウザ専用だが、
// hasTorch と zoomRange は純関数なので Node でもテストできる。

const VIDEO_SIZE = { width: { ideal: 1280 }, height: { ideal: 720 } };

export async function openCamera(deviceId) {
  const video = deviceId
    ? { deviceId: { exact: deviceId }, ...VIDEO_SIZE }
    : { facingMode: { ideal: 'environment' }, ...VIDEO_SIZE };
  const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  const track = stream.getVideoTracks()[0];
  const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
  return { stream, track, caps };
}

export function hasTorch(caps) {
  const t = caps.torch;
  if (t === true) return true;
  return Array.isArray(t) && t.includes(true);
}

export function zoomRange(caps) {
  const z = caps.zoom;
  if (!z || typeof z.max !== 'number') return null;
  return { min: typeof z.min === 'number' ? z.min : 1, max: z.max, step: typeof z.step === 'number' ? z.step : 0.1 };
}

export async function setTorch(track, on) {
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
  } catch {
    await track.applyConstraints({ torch: on });
  }
}

export async function setZoom(track, value) {
  await track.applyConstraints({ advanced: [{ zoom: value }] });
}

export async function closeCamera(cam) {
  if (!cam) return;
  try {
    await setTorch(cam.track, false);
  } catch {
    // トラックが既に止まっていれば失敗するが、消灯が目的なので無視する
  }
  for (const t of cam.stream.getTracks()) t.stop();
}
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test`
Expected: PASS。`pass 19`

- [ ] **Step 5: Commit**

```bash
git add camera.js test/camera.test.js
git commit -m "feat: カメラ API を包む camera.js を追加"
```

---

### Task 7: index.html、style.css、ローカル確認用サーバー

**Files:**
- Create: `index.html`
- Create: `style.css`
- Create: `scripts/serve.js`

**Interfaces:**
- Produces: `app.js`（Task 8）が参照する要素 id: `startBtn`, `permHint`, `video`, `view`, `hud`, `hitCount`, `fps`, `modeLabel`, `threshold`, `thresholdOut`, `minArea`, `minAreaOut`, `zoomRow`, `zoom`, `zoomOut`, `diffBtn`, `stopBtn`, `unsupportedReason`, `log`, `screen-idle`, `screen-detect`, `screen-unsupported`

- [ ] **Step 1: index.html を書く**

```html
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>迷子マーカー探し</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="top">
    <h1>迷子マーカー探し</h1>
    <span id="hud" class="hud" hidden>検出 <b id="hitCount">0</b> 個 · <span id="fps">0</span> fps · <span id="modeLabel">通常</span></span>
  </header>

  <section id="screen-idle" class="screen">
    <p>iPhone のライトで再帰反射マーカーを光らせて探します。立った高さから 1〜3 m 先の床を映してください。明るい部屋で背景まで拾うときは「差分」を使います。</p>
    <button id="startBtn" class="primary">開始</button>
    <p id="permHint" class="hint" hidden>カメラの許可が必要です。設定 &gt; Safari &gt; カメラ で「許可」にしてから、このページを再読み込みしてください。</p>
  </section>

  <section id="screen-detect" class="screen" hidden>
    <div class="stage">
      <video id="video" playsinline muted autoplay></video>
      <canvas id="view" width="480" height="270"></canvas>
    </div>
    <div class="controls">
      <label class="ctl">しきい値 <input id="threshold" type="range" min="10" max="255" value="235"><output id="thresholdOut">235</output></label>
      <label class="ctl">最小面積 <input id="minArea" type="range" min="1" max="60" value="2"><output id="minAreaOut">2</output></label>
      <label class="ctl" id="zoomRow" hidden>ズーム <input id="zoom" type="range" min="1" max="1" step="0.1" value="1"><output id="zoomOut">1.0</output></label>
      <div class="row">
        <button id="diffBtn">差分</button>
        <button id="stopBtn">停止</button>
      </div>
    </div>
  </section>

  <section id="screen-unsupported" class="screen" hidden>
    <h2>この端末は非対応です</h2>
    <p id="unsupportedReason"></p>
    <p>対応機種は <a href="https://github.com/ogata-ryoma/mocap-marker-finder#対応機種">README</a> を見てください。</p>
  </section>

  <section class="log-panel">
    <h2>ログ</h2>
    <pre id="log"></pre>
  </section>

  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: style.css を書く**

```css
:root {
  --bg: #0b0d10;
  --panel: #161a20;
  --line: #262c35;
  --fg: #e8ebef;
  --muted: #8a93a0;
  --accent: #35c4f0;
  --hit: #ff3b3b;
  --ok: #4cd964;
  color-scheme: dark;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 8px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  background: var(--bg);
  color: var(--fg);
  font: 15px/1.5 -apple-system, system-ui, sans-serif;
  max-width: 720px;
  margin-inline: auto;
}

.top { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
h1 { font-size: 17px; margin: 0; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 6px; }

.hud { font-variant-numeric: tabular-nums; font-size: 13px; color: var(--muted); }
.hud b { color: var(--hit); font-size: 18px; }

.screen { margin-top: 12px; }
.screen p { margin: 0 0 12px; }
.hint { color: var(--muted); font-size: 13px; }

.stage { position: relative; width: 100%; background: #000; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.stage canvas { display: block; width: 100%; height: auto; }
video { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

.controls { display: grid; gap: 10px; margin-top: 10px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }

button {
  background: var(--panel);
  color: var(--fg);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 12px 16px;
  font-size: 16px;
}
button.primary { background: var(--accent); color: #062029; border-color: var(--accent); font-weight: 600; }
button.on { border-color: var(--ok); color: var(--ok); }
button:disabled { opacity: .4; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

label.ctl { display: grid; grid-template-columns: 6em 1fr 3.5em; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
label.ctl output { text-align: right; color: var(--fg); font-variant-numeric: tabular-nums; }
input[type=range] { width: 100%; }

.log-panel { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; margin-top: 14px; }
pre { margin: 0; white-space: pre-wrap; word-break: break-all; font: 12px/1.45 ui-monospace, Menlo, monospace; max-height: 40vh; overflow: auto; }
.err { color: var(--hit); }
.ok { color: var(--ok); }

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
```

- [ ] **Step 3: scripts/serve.js を書く**

```js
// scripts/serve.js — ローカル確認用の静的サーバー。http://127.0.0.1:8080/ でリポジトリのルートを配信する。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = resolve(join(root, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(8080, '127.0.0.1', () => console.log('http://127.0.0.1:8080/'));
```

- [ ] **Step 4: 表示を確かめる**

Run (別ターミナルで): `cd D:/Repository/mocap-marker-finder && npm run serve`
ブラウザで `http://127.0.0.1:8080/` を開く。
Expected: 「迷子マーカー探し」の見出し、説明文、「開始」ボタン、ログ欄が縦に並ぶ。検出中と非対応の画面は隠れている。DevTools のコンソールに `app.js` の 404 が 1 件出る（Task 8 で解消）。

- [ ] **Step 5: Commit**

```bash
git add index.html style.css scripts/serve.js
git commit -m "feat: 3 画面の骨組みと見た目、ローカル確認用サーバーを追加"
```

---

### Task 8: app.js（通常モード: 状態遷移、torch 自動点灯、描画ループ、ログ）

**Files:**
- Create: `app.js`

**Interfaces:**
- Consumes: `camera.js` の全関数、`detect.js` の `thresholdMask` / `findBlobs`、Task 7 の要素 id
- Produces: 画面の状態 `idle` / `detect` / `unsupported`。Task 9 が `setMode` と `state.blinker` を足す

- [ ] **Step 1: app.js を書く**

```js
// app.js — 画面の状態遷移、描画ループ、ログ、UI の配線。
import { openCamera, hasTorch, setTorch, setZoom, zoomRange, closeCamera } from './camera.js';
import { thresholdMask, findBlobs } from './detect.js';

const WORK_WIDTH = 480;
const MAX_DRAWN = 50;
const DEFAULTS = { normal: 235, diff: 80, minArea: 2 };

const $ = (id) => document.getElementById(id);
const els = {
  startBtn: $('startBtn'), permHint: $('permHint'),
  video: $('video'), view: $('view'),
  hud: $('hud'), hitCount: $('hitCount'), fps: $('fps'), modeLabel: $('modeLabel'),
  threshold: $('threshold'), thresholdOut: $('thresholdOut'),
  minArea: $('minArea'), minAreaOut: $('minAreaOut'),
  zoomRow: $('zoomRow'), zoom: $('zoom'), zoomOut: $('zoomOut'),
  diffBtn: $('diffBtn'), stopBtn: $('stopBtn'),
  unsupportedReason: $('unsupportedReason'), log: $('log'),
};

const state = {
  cam: null,
  mode: 'normal',            // 'normal' | 'diff'
  thresholds: { normal: DEFAULTS.normal, diff: DEFAULTS.diff },
  minArea: DEFAULTS.minArea,
  diffFrame: null,           // 差分モードで最後に作った差分フレーム
  blinker: null,
  raf: 0,
  frames: 0,
  fpsAt: 0,
};

const work = document.createElement('canvas');
const wctx = work.getContext('2d', { willReadFrequently: true });
const vctx = els.view.getContext('2d');
const skipTorchGate = new URLSearchParams(location.search).has('skipTorch');

// ---- ログ ----
export function log(message, kind = '') {
  const time = new Date().toLocaleTimeString('ja-JP', { hour12: false });
  const line = document.createElement('div');
  if (kind) line.className = kind;
  line.textContent = `[${time}] ${message}`;
  els.log.prepend(line);
}
window.addEventListener('error', (e) => log(`error: ${e.message}`, 'err'));
window.addEventListener('unhandledrejection', (e) => log(`rejection: ${e.reason?.message ?? e.reason}`, 'err'));

// ---- 画面 ----
function showScreen(name) {
  for (const n of ['idle', 'detect', 'unsupported']) $(`screen-${n}`).hidden = n !== name;
  els.hud.hidden = name !== 'detect';
}

function unsupported(reason) {
  els.unsupportedReason.textContent = reason;
  log(`非対応: ${reason}`, 'err');
  showScreen('unsupported');
}

// ---- 開始と停止 ----
async function start() {
  els.startBtn.disabled = true;
  els.permHint.hidden = true;

  let cam;
  try {
    cam = await openCamera();
  } catch (e) {
    els.startBtn.disabled = false;
    if (e.name === 'NotAllowedError') {
      els.permHint.hidden = false;
      log('カメラの許可が拒否されました', 'err');
      return;
    }
    if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
      unsupported(`カメラが見つかりません (${e.name})`);
      return;
    }
    log(`getUserMedia 失敗: ${e.name} ${e.message}`, 'err');
    return;
  }
  state.cam = cam;
  log(`カメラ: ${cam.track.label}`, 'ok');

  if (skipTorchGate) {
    log('開発用: ?skipTorch によりライトの判定を飛ばします', 'err');
  } else {
    // 点灯を試みてから判定する。capabilities の torch の有無だけで弾かない
    // (iPhone の Safari が capabilities にどう出すかは端末と版で違い得るため)。
    let lit = false;
    try {
      await setTorch(cam.track, true);
      const settings = cam.track.getSettings?.() ?? {};
      lit = hasTorch(cam.caps) || settings.torch === true;
      log(`torch caps=${JSON.stringify(cam.caps.torch)} settings=${JSON.stringify(settings.torch)}`);
    } catch (e) {
      log(`ライト点灯の applyConstraints が失敗: ${e.name} ${e.message}`, 'err');
    }
    if (!lit) {
      await closeCamera(cam);
      state.cam = null;
      els.startBtn.disabled = false;
      unsupported(`ライト (torch) を制御できません: ${cam.track.label}`);
      return;
    }
    log('ライト点灯', 'ok');
  }

  els.video.srcObject = cam.stream;
  try {
    await els.video.play();
  } catch (e) {
    log(`video.play: ${e.message}`, 'err');
  }
  setupZoom(cam);
  showScreen('detect');
  state.frames = 0;
  state.fpsAt = performance.now();
  loop();
}

async function stop(reason = '') {
  cancelAnimationFrame(state.raf);
  state.blinker?.stop();
  state.blinker = null;
  const cam = state.cam;
  state.cam = null;
  await closeCamera(cam);
  els.video.srcObject = null;
  state.mode = 'normal';
  state.diffFrame = null;
  els.modeLabel.textContent = '通常';
  els.diffBtn.classList.remove('on');
  els.threshold.value = state.thresholds.normal;
  els.thresholdOut.value = els.threshold.value;
  els.startBtn.disabled = false;
  showScreen('idle');
  log(reason ? `停止 (${reason})` : '停止');
}

function setupZoom(cam) {
  const range = zoomRange(cam.caps);
  if (!range) {
    els.zoomRow.hidden = true;
    return;
  }
  els.zoom.min = range.min;
  els.zoom.max = range.max;
  els.zoom.step = range.step;
  els.zoom.value = cam.track.getSettings?.().zoom ?? range.min;
  els.zoomOut.value = Number(els.zoom.value).toFixed(1);
  els.zoomRow.hidden = false;
}

// ---- フレーム取得と描画 ----
function grabFrame() {
  const vw = els.video.videoWidth || 640;
  const vh = els.video.videoHeight || 360;
  const W = WORK_WIDTH;
  const H = Math.max(1, Math.round(W * vh / vw));
  if (work.width !== W || work.height !== H) {
    work.width = W; work.height = H;
    els.view.width = W; els.view.height = H;
  }
  wctx.drawImage(els.video, 0, 0, W, H);
  const img = wctx.getImageData(0, 0, W, H);
  return { data: img.data, width: W, height: H };
}

function drawBlobs(blobs) {
  vctx.lineWidth = 2;
  vctx.strokeStyle = '#ff3b3b';
  vctx.fillStyle = '#ff3b3b';
  vctx.font = '12px system-ui';
  for (const b of blobs.slice(0, MAX_DRAWN)) {
    const r = Math.max(8, Math.sqrt(b.area) * 1.6);
    vctx.beginPath();
    vctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    vctx.stroke();
    vctx.fillText(`${b.area}px`, b.x + r + 2, b.y + 4);
  }
}

function currentFrame() {
  // Task 9 で差分モードの分岐を足す
  const frame = grabFrame();
  vctx.drawImage(work, 0, 0);
  return { frame, threshold: state.thresholds.normal };
}

function loop() {
  state.raf = requestAnimationFrame(loop);
  if (!state.cam || els.video.readyState < 2) return;
  const picked = currentFrame();
  if (!picked) return;
  const { frame, threshold } = picked;
  const blobs = findBlobs(thresholdMask(frame, threshold), frame.width, frame.height, state.minArea);
  drawBlobs(blobs);
  els.hitCount.textContent = blobs.length;
  state.frames++;
  const now = performance.now();
  if (now - state.fpsAt >= 1000) {
    els.fps.textContent = Math.round(state.frames * 1000 / (now - state.fpsAt));
    state.frames = 0;
    state.fpsAt = now;
  }
}

// ---- UI の配線 ----
els.startBtn.addEventListener('click', start);
els.stopBtn.addEventListener('click', () => stop());
els.threshold.addEventListener('input', () => {
  const v = Number(els.threshold.value);
  state.thresholds[state.mode] = v;
  els.thresholdOut.value = v;
});
els.minArea.addEventListener('input', () => {
  state.minArea = Number(els.minArea.value);
  els.minAreaOut.value = state.minArea;
});
els.zoom.addEventListener('input', async () => {
  const v = Number(els.zoom.value);
  els.zoomOut.value = v.toFixed(1);
  if (!state.cam) return;
  try {
    await setZoom(state.cam.track, v);
  } catch (e) {
    log(`ズーム失敗: ${e.message}`, 'err');
    els.zoomRow.hidden = true;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.cam) stop('画面が非表示');
});
window.addEventListener('pagehide', () => {
  if (state.cam) stop('ページ終了');
});

if (!navigator.mediaDevices?.getUserMedia) {
  unsupported('このブラウザはカメラ API に対応していません。HTTPS で開いているか確認してください。');
} else {
  log('準備完了');
}
```

- [ ] **Step 2: テストが引き続き通ることを確かめる**

Run: `npm test`
Expected: PASS。`pass 19`（app.js は Node では読み込まない）

- [ ] **Step 3: 非対応の門を PC のブラウザで確かめる**

Run (別ターミナル): `npm run serve`
Edge を偽カメラ付きで起動する（PowerShell）:

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --use-fake-device-for-media-stream --use-fake-ui-for-media-stream --user-data-dir="$env:TEMP\mmf-edge" http://127.0.0.1:8080/
```

「開始」を押す。
Expected: 偽カメラには torch が無いので**非対応画面**になり、理由に「ライト (torch) を制御できません: fake_device_0」のような文が出る。ログにも同じ内容が赤字で出る。

- [ ] **Step 4: 検出ループを ?skipTorch で確かめる**

同じ Edge で `http://127.0.0.1:8080/?skipTorch` を開き、「開始」を押す。
Expected: 検出中の画面になり、偽カメラの映像（動く模様）が出る。HUD の fps が 1 秒後から更新される。しきい値を 100 まで下げると赤丸が出る。「停止」で待機画面に戻り、ログに「停止」が出る。

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: 通常モードの検出ループと画面の状態遷移を追加"
```

---

### Task 9: app.js に差分モードを足す

**Files:**
- Modify: `app.js`（import、`currentFrame`、`setMode`、`diffBtn` の配線）

**Interfaces:**
- Consumes: `createBlinker`（Task 5）、`diffFrames`（Task 4）
- Produces: `setMode('normal' | 'diff')`

- [ ] **Step 1: import を差し替える**

```js
import { thresholdMask, findBlobs, diffFrames } from './detect.js';
import { createBlinker } from './blink.js';
```

- [ ] **Step 2: currentFrame を差分対応に置き換える**

`currentFrame` 関数を丸ごと次にする:

```js
function currentFrame() {
  if (state.mode === 'diff') {
    if (!state.diffFrame) {
      // 最初の組が揃うまでは生映像だけ出す
      grabFrame();
      vctx.drawImage(work, 0, 0);
      return null;
    }
    const f = state.diffFrame;
    vctx.putImageData(new ImageData(f.data, f.width, f.height), 0, 0);
    return { frame: f, threshold: state.thresholds.diff };
  }
  const frame = grabFrame();
  vctx.drawImage(work, 0, 0);
  return { frame, threshold: state.thresholds.normal };
}
```

- [ ] **Step 3: setMode を足す**

`// ---- UI の配線 ----` の直前に追記:

```js
// ---- モード切替 ----
function setMode(mode) {
  if (!state.cam) return;
  state.mode = mode;
  state.diffFrame = null;
  els.modeLabel.textContent = mode === 'diff' ? '差分' : '通常';
  els.diffBtn.classList.toggle('on', mode === 'diff');
  els.threshold.value = state.thresholds[mode];
  els.thresholdOut.value = els.threshold.value;

  state.blinker?.stop();
  state.blinker = null;

  if (mode === 'diff') {
    state.blinker = createBlinker({
      setTorch: (on) => setTorch(state.cam.track, on),
      grabFrame,
      onPair: (on, off) => { state.diffFrame = diffFrames(on, off); },
      onError: (e) => {
        log(`差分モード中のライト切替に失敗: ${e.message}`, 'err');
        setMode('normal');
      },
    });
    state.blinker.start();
    log('差分モード開始 (ライト点滅)');
  } else {
    if (!skipTorchGate) {
      setTorch(state.cam.track, true).catch((e) => log(`ライト再点灯失敗: ${e.message}`, 'err'));
    }
    log('通常モード');
  }
}
```

- [ ] **Step 4: diffBtn を配線する**

`els.stopBtn.addEventListener(...)` の直後に追記:

```js
els.diffBtn.addEventListener('click', () => setMode(state.mode === 'diff' ? 'normal' : 'diff'));
```

- [ ] **Step 5: テストが引き続き通ることを確かめる**

Run: `npm test`
Expected: PASS。`pass 19`

- [ ] **Step 6: PC のブラウザで差分モードを確かめる**

Task 8 Step 4 と同じ Edge で `http://127.0.0.1:8080/?skipTorch` を開き、「開始」→「差分」。
Expected: Chromium は `advanced` 制約を満たせなくても黙って無視するので、偽カメラでも torch の切替は「成功」扱いになり、点滅スケジューラがそのまま回る。HUD が「差分」になり、約 0.5 秒後に映像がグレーの差分表示（偽カメラの動く部分だけ明るい）に変わる。ログに「差分モード開始 (ライト点滅)」。もう一度「差分」を押すと HUD が「通常」に戻り、生映像に戻る。しきい値スライダーの値が 80 と 235 で切り替わる。

これで確かめられるのは点滅の順序と差分画像の変換だけで、LED が実際に点滅するかと失敗経路（`onError` で通常へ戻る）は iPhone でしか確かめられない（Task 12）。

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat: torch 点滅で環境光を打ち消す差分モードを追加"
```

---

### Task 10: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: README.md を書く**

````markdown
# mocap-marker-finder

モーションキャプチャ用の再帰反射マーカーが迷子になったとき、iPhone のライトで光らせて探すページです。Vicon / OptiTrack のマーカー（3 mm の半球から 14 mm の球まで）に使えます。

https://ogata-ryoma.github.io/mocap-marker-finder/

## 使い方

1. iPhone の Safari で上の URL を開く（ホーム画面には追加せず、ブックマークで開く。ホーム画面から開くとカメラの許可を毎回聞かれる）
2. 「開始」を押し、カメラを許可する。ライトが自動で点く
3. 立った高さから、1〜3 m 先の床を映す。光る点に赤丸が付き、個数が右上に出る
4. 背景まで赤丸が付くときは「差分」を押す。ライトが点滅し、環境光を打ち消した映像になる
5. 探し終えたら「停止」を押す。ライトが消える

近づくより 1〜3 m 離れた方がよく光ります。ライトとレンズの角度差が小さくなるためです。

## 対応機種

- LED ライト付きの iPhone
- Safari がカメラの capabilities に torch を報告すること（古い iOS では報告されず、非対応画面になる）
- iPad の多くは LED が無いので非対応

非対応画面になったら、画面に出る端末名と理由をそのまま報告してください。

## 注意

- ライトを点けたままにすると端末が熱くなる。数分ごとに「停止」を挟む
- 差分モードは点滅するので、てんかん等の光過敏がある人がいる場所では使わない

## 実機検証の手順

1. 明るい部屋で、3 mm の半球マーカーを床に置く
2. 1〜3 m 離れ、立った高さから「開始」
3. 通常モードで赤丸が付くか確認する。付かなければ「差分」で確認する
4. 差分モードの映像で、背景が暗いままか、全体が明るく持ち上がるかを記録する

結果は `docs/verification.md` に日付、端末、iOS の版、結果を書く。

## 開発

```bash
npm test        # node --test
npm run serve   # http://127.0.0.1:8080/
```

`detect.js` と `blink.js` は DOM に触れない純粋なモジュールで、Node のテストで固めています。設計は `docs/superpowers/specs/`、用語は `docs/CONTEXT.md`、判断の記録は `docs/adr/` にあります。
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: 使い方、対応機種、実機検証の手順を README に書く"
```

---

### Task 11: GitHub に非公開で作成し、公開に切り替えて Pages で配信する

**Files:** なし（リモート操作のみ）

**前提:** `gh auth status` が `ogata-ryoma` でログイン済みを示すこと（2026-09-18 に確認済み）。`gh` は `C:\Program Files\GitHub CLI\gh.exe`。

- [ ] **Step 1: ログインと作業ツリーを確認する**

Run:
```bash
gh auth status
cd D:/Repository/mocap-marker-finder && git status --short && git log --oneline | head -20
```
Expected: `Logged in to github.com account ogata-ryoma`。作業ツリーはきれい。Task 1〜10 の commit が並ぶ

- [ ] **Step 2: 非公開リポジトリを作って push する**

Run:
```bash
cd D:/Repository/mocap-marker-finder
gh repo create mocap-marker-finder --private --source=. --remote=origin --push --description "iPhone のライトで再帰反射マーカーを光らせて迷子マーカーを探す静的ページ"
```
Expected: `https://github.com/ogata-ryoma/mocap-marker-finder` が作られ、`main` が push される

- [ ] **Step 3: 公開への切り替えをユーザーに確認する**

ユーザーに「リポジトリを公開に切り替えて Pages を有効にします。よいですか」と聞き、明示的な了承を待つ。了承が無ければここで止まる。

- [ ] **Step 4: 公開に切り替える**

Run:
```bash
gh repo edit ogata-ryoma/mocap-marker-finder --visibility public --accept-visibility-change-consequences
```
Expected: エラー無し。`gh repo view ogata-ryoma/mocap-marker-finder --json visibility` が `PUBLIC`

- [ ] **Step 5: Pages を有効にする（main ブランチのルート）**

Run:
```bash
gh api -X POST repos/ogata-ryoma/mocap-marker-finder/pages -f build_type=legacy -f "source[branch]=main" -f "source[path]=/"
```
Expected: JSON が返り、`"html_url": "https://ogata-ryoma.github.io/mocap-marker-finder/"` を含む。既に有効なら 409 が返るのでそのまま次へ

- [ ] **Step 6: 配信を確かめる**

1〜2 分待ってから:
```bash
gh api repos/ogata-ryoma/mocap-marker-finder/pages --jq '.status, .html_url'
curl -s -o /dev/null -w "%{http_code}\n" https://ogata-ryoma.github.io/mocap-marker-finder/
```
Expected: `built` と URL、HTTP `200`。`404` なら 1 分待って再試行（初回ビルドに時間がかかる）

- [ ] **Step 7: README の URL が生きていることを確かめる**

ブラウザで `https://ogata-ryoma.github.io/mocap-marker-finder/` を開く。
Expected: 待機画面が出て、ログに「準備完了」

- [ ] **Step 8: spike 用の一時トンネルとローカルサーバーを止める**

2026-09-18 の壁打ちセッションが、使い捨ての検証ページを `cloudflared` の一時トンネル（`https://acres-mentor-legend-gbp.trycloudflare.com/`）と、ポート 8765 の node サーバーで公開したまま残している。Pages が使えるようになったので止める。

Run (PowerShell):
```powershell
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
$pid8765 = (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($pid8765) { Stop-Process -Id $pid8765 -Force }
```
Expected: エラー無し。既に止まっていれば何も起きない。`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8765/` が接続失敗になる

---

### Task 12: iPhone での動作確認（ユーザーが実施、結果を記録）

**Files:**
- Create: `docs/verification.md`

- [ ] **Step 1: ユーザーに依頼する**

ユーザーの iPhone の Safari で `https://ogata-ryoma.github.io/mocap-marker-finder/` を開いてもらい、次を確認してもらう:

1. 「開始」→ カメラ許可 → ライトが点く → 検出中の画面になる
2. 「差分」を押すとライトが点滅し、映像がグレーの差分表示になる。もう一度押すと通常に戻りライトが点いたままになる
3. 「停止」でライトが消え、待機画面に戻る
4. 検出中にホームへ戻る（画面を非表示にする）とライトが消える
5. ズームのスライダーが出ているか（出ていれば動かして映像が拡大するか）
6. ログに赤字が無いか。あればその文面

- [ ] **Step 2: 結果を docs/verification.md に書く**

```markdown
# 実機検証の記録

## 2026-MM-DD iPhone 動作確認

- 端末: （例: iPhone 15 Pro）
- iOS: （例: 26.0）
- 開始 → ライト点灯 → 検出中: OK / NG（内容）
- 差分モードの点滅と復帰: OK / NG
- 停止でライト消灯: OK / NG
- 画面非表示でライト消灯: OK / NG
- ズームのスライダー: 表示あり / なし
- ログの赤字: なし / （文面）
```

日付、端末、iOS の版はユーザーの報告で埋める。空欄のまま commit しない。

- [ ] **Step 3: Commit**

```bash
git add docs/verification.md
git commit -m "docs: iPhone での動作確認の記録を追加"
git push
```

NG があった場合は修正に入るが、修正の commit はユーザーの再検証 OK の後に行う（CLAUDE.md の 3 step）。

---

### Task 13: スタジオでの合格ライン検証（ユーザーが実施、結果で分岐）

**Files:**
- Modify: `docs/verification.md`（追記）

- [ ] **Step 1: ユーザーに依頼する**

明るい部屋で 3 mm 半球を床に置き、2 m 離れた立った高さから:

1. 通常モードで赤丸が付くか（付いたときのしきい値と最小面積）
2. 付かなければ差分モードで付くか（付いたときの差分しきい値）
3. 差分モードの映像で、背景が暗いままか、全体が明るく持ち上がるか
4. ズームを使うと 3 mm が見やすくなるか

- [ ] **Step 2: 結果を docs/verification.md に追記する**

```markdown
## 2026-MM-DD スタジオ 合格ライン検証

- 場所と明るさ: （例: 更衣室、蛍光灯）
- マーカー: Vicon 3 mm 半球、床、2 m、立った高さ
- 通常モード: 赤丸 あり / なし（しきい値 NNN、最小面積 N）
- 差分モード: 赤丸 あり / なし（差分しきい値 NNN）
- 差分表示の背景: 暗いまま / 全体が持ち上がる
- ズーム: 効果 あり / なし
- 判定: 合格 / 不合格
```

- [ ] **Step 3: 結果で分岐する**

- 合格（どちらかのモードで赤丸）: 計画完了。commit して push
- 不合格で「差分表示の背景が全体に持ち上がる」: Task 14 を実行する
- 不合格で Task 14 でも駄目: ADR 0001 の退避条件に該当する。ネイティブ移行の設計を別の brainstorming として始める（この計画の範囲外）

```bash
git add docs/verification.md
git commit -m "docs: スタジオでの合格ライン検証の記録を追加"
git push
```

---

### Task 14（条件付き）: 差分の正規化（背景が全体に持ち上がる場合のみ）

Task 13 で「差分表示の背景が全体に持ち上がる」と記録された場合だけ実行する。それ以外は飛ばす。

**Files:**
- Modify: `detect.js`（末尾に追記）
- Modify: `test/detect.test.js`（末尾に追記）
- Modify: `app.js`（`onPair` の 1 行）

**Interfaces:**
- Produces: `normalizeDiff(frame: Frame): Frame` … 差分フレームの輝度の中央値を全画素から引く。中央値以下は 0

- [ ] **Step 1: 失敗するテストを書く**

`test/detect.test.js` の import に `normalizeDiff` を足し、末尾に追記:

```js
import { luminance, thresholdMask, findBlobs, detect, diffFrames, normalizeDiff } from '../detect.js';
```

```js
test('normalizeDiff は中央値を引いて背景を 0 にし、明るい点だけ残す', () => {
  // 3x3 のうち 8 画素が 40、中央 1 画素が 200
  const pixels = [];
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) pixels.push([x, y, x === 1 && y === 1 ? 200 : 40]);
  const frame = makeFrame(3, 3, pixels);
  const out = normalizeDiff(frame);
  assert.equal(luminance(out.data, 0), 0);
  assert.equal(luminance(out.data, (1 * 3 + 1) * 4), 160);
  assert.equal(out.data[3], 255);
});

test('normalizeDiff は全画素同じ値なら全て 0 にする', () => {
  const frame = makeFrame(2, 2, [[0, 0, 90], [1, 0, 90], [0, 1, 90], [1, 1, 90]]);
  const out = normalizeDiff(frame);
  assert.deepEqual(Array.from(out.data).filter((_, i) => i % 4 === 0), [0, 0, 0, 0]);
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `npm test`
Expected: FAIL。`normalizeDiff` が無い

- [ ] **Step 3: 実装を書く**

`detect.js` の末尾に追記:

```js
// 差分フレームの輝度の中央値を引く。torch の点滅で自動露出が動き、
// 差分全体が持ち上がる場合に背景を 0 に戻す。
export function normalizeDiff(frame) {
  const { data, width, height } = frame;
  const n = width * height;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n * 4; i += 4) hist[luminance(data, i)]++;
  const half = n / 2;
  let acc = 0, median = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= half) { median = v; break; }
  }
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n * 4; i += 4) {
    const v = Math.max(0, luminance(data, i) - median);
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return { data: out, width, height };
}
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npm test`
Expected: PASS。`pass 21`

- [ ] **Step 5: app.js で差分に正規化をかける**

import を差し替え:

```js
import { thresholdMask, findBlobs, diffFrames, normalizeDiff } from './detect.js';
```

`setMode` 内の `onPair` を差し替え:

```js
      onPair: (on, off) => { state.diffFrame = normalizeDiff(diffFrames(on, off)); },
```

- [ ] **Step 6: ユーザーにスタジオで再検証してもらう**

Task 13 Step 1 の手順をもう一度。結果を `docs/verification.md` に「正規化あり」として追記する。

- [ ] **Step 7: 再検証 OK の後に Commit**

```bash
git add detect.js test/detect.test.js app.js docs/verification.md
git commit -m "feat: 差分フレームの中央値を引いて自動露出のずれを打ち消す"
git push
```
