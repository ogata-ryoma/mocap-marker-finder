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
