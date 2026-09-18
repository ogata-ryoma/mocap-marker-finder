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
