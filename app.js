// ===== AR Strike — game logic =====

const MAX_HEALTH = 200;
const DAMAGE_PER_HIT = 10;
const MAG_SIZE = 6;
const RELOAD_MS = 1200;
const DETECT_INTERVAL_MS = 180;

const state = {
  health: MAX_HEALTH,
  ammo: MAG_SIZE,
  reloading: false,
  model: null,
  detections: [],
  locked: false,
  running: false,
};

const els = {
  gate: document.getElementById('gate'),
  gateStatus: document.getElementById('gateStatus'),
  startBtn: document.getElementById('startBtn'),
  cam: document.getElementById('cam'),
  overlay: document.getElementById('overlay'),
  reticle: document.getElementById('reticle'),
  lockText: document.getElementById('lockText'),
  hpFill: document.getElementById('hpFill'),
  hpNum: document.getElementById('hpNum'),
  statusLine: document.getElementById('statusLine'),
  ammoNum: document.getElementById('ammoNum'),
  fireBtn: document.getElementById('fireBtn'),
  reloadBtn: document.getElementById('reloadBtn'),
  hitFlash: document.getElementById('hitFlash'),
  downOverlay: document.getElementById('downOverlay'),
  respawnBtn: document.getElementById('respawnBtn'),
};

const ctx = els.overlay.getContext('2d');

function resizeCanvas() {
  els.overlay.width = window.innerWidth;
  els.overlay.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ---------- Camera setup ----------
async function startCamera() {
  els.gateStatus.textContent = 'Camera permission maang rahe hain...';
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  els.cam.srcObject = stream;
  await new Promise((res) => { els.cam.onloadedmetadata = () => res(); });
  await els.cam.play();
}

async function loadModel() {
  els.gateStatus.textContent = 'AI model load ho raha hai...';
  state.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
}

els.startBtn.addEventListener('click', async () => {
  els.startBtn.disabled = true;
  try {
    await startCamera();
    await loadModel();
    els.gate.style.display = 'none';
    state.running = true;
    requestAnimationFrame(detectLoop);
  } catch (err) {
    els.gateStatus.textContent = 'Permission nahi mili ya camera error. Phir try karo. (' + (err.message || err) + ')';
    els.startBtn.disabled = false;
  }
});

// ---------- Detection loop ----------
let lastDetectTime = 0;

async function detectLoop(ts) {
  if (!state.running) return;

  if (ts - lastDetectTime > DETECT_INTERVAL_MS && state.model && els.cam.readyState >= 2) {
    lastDetectTime = ts;
    try {
      const preds = await state.model.detect(els.cam, 6);
      state.detections = preds.filter(p => p.class === 'person' && p.score > 0.55);
    } catch (e) {
      // detection hiccup - skip this frame
    }
  }

  drawOverlay();
  requestAnimationFrame(detectLoop);
}

function videoToScreenBox(bbox) {
  // bbox: [x, y, width, height] in video's intrinsic pixel space
  const vw = els.cam.videoWidth, vh = els.cam.videoHeight;
  const sw = window.innerWidth, sh = window.innerHeight;

  // object-fit: cover scaling
  const scale = Math.max(sw / vw, sh / vh);
  const dispW = vw * scale, dispH = vh * scale;
  const offX = (sw - dispW) / 2, offY = (sh - dispH) / 2;

  const [x, y, w, h] = bbox;
  return {
    x: x * scale + offX,
    y: y * scale + offY,
    w: w * scale,
    h: h * scale,
  };
}

function centerIsLocked(box) {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
}

function drawOverlay() {
  ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
  let locked = false;

  for (const det of state.detections) {
    const box = videoToScreenBox(det.bbox);
    const isLocked = centerIsLocked(box);
    if (isLocked) locked = true;

    ctx.lineWidth = isLocked ? 3 : 2;
    ctx.strokeStyle = isLocked ? '#39ff6a' : 'rgba(255,255,255,0.85)';
    ctx.strokeRect(box.x, box.y, box.w, box.h);

    ctx.font = '11px monospace';
    ctx.fillStyle = isLocked ? '#39ff6a' : 'rgba(255,255,255,0.85)';
    const label = (isLocked ? 'LOCKED ' : 'TARGET ') + Math.round(det.score * 100) + '%';
    ctx.fillText(label, box.x + 2, box.y > 14 ? box.y - 4 : box.y + box.h + 12);
  }

  state.locked = locked;
  els.reticle.classList.toggle('locked', locked);
  els.lockText.classList.toggle('show', locked);
  els.statusLine.textContent = state.detections.length
    ? (locked ? 'LOCK ACQUIRED' : 'TARGET DETECTED — CENTER KARO')
    : 'SCANNING...';
}

// ---------- Fire / Reload / Health ----------
function updateHud() {
  const pct = Math.max(0, (state.health / MAX_HEALTH) * 100);
  els.hpFill.style.width = pct + '%';
  els.hpFill.style.background = pct > 50 ? '#39ff6a' : (pct > 20 ? '#ffaa00' : '#ff4433');
  els.hpNum.textContent = Math.max(0, state.health);
  els.ammoNum.textContent = `${state.ammo}/${MAG_SIZE}`;
  els.fireBtn.classList.toggle('disabled', state.ammo <= 0 || state.reloading || state.health <= 0);
  els.reloadBtn.classList.toggle('disabled', state.reloading || state.ammo === MAG_SIZE);
}

function spawnPopup(text, color) {
  const p = document.createElement('div');
  p.className = 'popup';
  p.style.color = color || '#ff4433';
  p.style.left = '50%';
  p.style.top = '46%';
  p.textContent = text;
  document.body.appendChild(p);
  setTimeout(() => p.remove(), 700);
}

function fire() {
  if (state.health <= 0 || state.reloading) return;
  if (state.ammo <= 0) {
    spawnPopup('AMMO KHATAM', '#ffaa00');
    return;
  }
  state.ammo -= 1;

  if (state.locked) {
    state.health = Math.max(0, state.health - DAMAGE_PER_HIT);
    spawnPopup('-' + DAMAGE_PER_HIT, '#ff4433');
    els.hitFlash.style.background = 'rgba(255,68,51,0.28)';
    setTimeout(() => { els.hitFlash.style.background = 'rgba(255,68,51,0)'; }, 90);
    if (state.health <= 0) {
      els.downOverlay.classList.add('show');
    }
  } else {
    spawnPopup('MISS', 'rgba(255,255,255,0.7)');
  }
  updateHud();
}

function reload() {
  if (state.reloading || state.ammo === MAG_SIZE) return;
  state.reloading = true;
  els.statusLine.textContent = 'RELOADING...';
  updateHud();
  setTimeout(() => {
    state.ammo = MAG_SIZE;
    state.reloading = false;
    updateHud();
  }, RELOAD_MS);
}

els.fireBtn.addEventListener('click', fire);
els.reloadBtn.addEventListener('click', reload);
els.respawnBtn.addEventListener('click', () => {
  state.health = MAX_HEALTH;
  state.ammo = MAG_SIZE;
  els.downOverlay.classList.remove('show');
  updateHud();
});

updateHud();

// ---------- Service worker (installability) ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
