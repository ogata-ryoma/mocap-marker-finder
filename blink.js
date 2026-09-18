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
