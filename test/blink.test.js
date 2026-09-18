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
