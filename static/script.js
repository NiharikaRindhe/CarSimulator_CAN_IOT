/* ═══════════════════════════════════════════════════════════════
   ADAS Cockpit Simulator — Complete Interactive Script
   Handles: Steering, Pedals, Gears, Door, Seatbelt, Music,
            Speedometer, Indicators, BSM, CAN Popup, Socket.IO
   All controls work with KEYBOARD + MOUSE
   ═══════════════════════════════════════════════════════════════ */
'use strict';

// ── Socket.IO ─────────────────────────────────────────────────
const socket = io({ transports: ['websocket', 'polling'] });
socket.on('connect',    () => setCanStatus('io', true));
socket.on('disconnect', () => setCanStatus('io', false));

// ── State ─────────────────────────────────────────────────────
let state = {
  speed: 0, steerAngle: 0, gear: 3, /* D */
  throttle: false, brake: false, ebrake: false,
  headlights: false, highbeam: false,
  blinkerLeft: false, blinkerRight: false,
  doorOpen: false, seatbeltOn: true,
  bsmLeft: false, bsmRight: false,
  musicPlaying: false, volume: 0.5,
  canOk: false, demo: false, mps: 0,
  speedLocked: false, lockedSpeed: 0
};

// ── DOM refs ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const wheel     = $('steering-wheel');
const steerArea = $('steering-area');
const steerBadge= $('steer-angle-text');
const speedNum  = $('speed-num');
const brakeBar  = $('pedal-brake');
const gasBar    = $('pedal-gas');

// ══════════════════════════════════════════════════════════════
// 7. PREMIUM CANVAS GAUGES — Speed & RPM
// ══════════════════════════════════════════════════════════════
const GAUGE_CONFIG = {
  speedo: {
    canvasId: 'speedo-canvas', numId: 'speed-num',
    max: 250, step: 50, minor: 10,
    label: v => String(v),
    // color bands: [startPct, endPct, color]
    bands: [
      [0, 0.4, '#00ff88'],    // green
      [0.4, 0.6, '#ffcc00'],  // yellow
      [0.6, 0.8, '#ff8800'],  // orange
      [0.8, 1.0, '#ff3344'],  // red
    ]
  },
  rpm: {
    canvasId: 'rpm-canvas', numId: 'rpm-num',
    max: 8000, step: 1000, minor: 200,
    label: v => String(v / 1000),
    bands: [
      [0, 0.5, '#00aaff'],    // blue
      [0.5, 0.7, '#00d4ff'],  // cyan
      [0.7, 0.85, '#ff8800'], // orange
      [0.85, 1.0, '#ff3344'], // red
    ]
  }
};

// Arc angles in radians (225° sweep from 135° to -45°, i.e. 7:30 to 4:30 on clock)
const G_START_ANG = (135 * Math.PI) / 180;  // bottom-left
const G_END_ANG   = (-45 * Math.PI) / 180;  // bottom-right (going clockwise via top)
const G_SWEEP     = G_START_ANG - G_END_ANG; // total sweep (positive = CW in our coord)

function valToAngle(val, max) {
  const pct = Math.min(Math.max(val / max, 0), 1);
  // angle goes from G_START_ANG (min) clockwise to G_END_ANG (max)
  // In canvas arc coords (positive = CW), from startAng counter-clockwise to endAng
  return G_START_ANG - pct * G_SWEEP;
}

function drawGauge(key, value) {
  const cfg = GAUGE_CONFIG[key];
  if (!cfg) return;
  const canvas = $(cfg.canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const cx = W / 2;
  const cy = H / 2;
  const outerR = Math.min(W, H) * 0.44;
  const arcW = outerR * 0.08;
  const innerR = outerR - arcW;

  ctx.clearRect(0, 0, W, H);

  // ── Background arc (dim track) ──
  ctx.beginPath();
  ctx.arc(cx, cy, outerR - arcW / 2, -G_START_ANG, -G_END_ANG, false);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = arcW;
  ctx.lineCap = 'round';
  ctx.stroke();

  // ── Colored arc segments (full bands) ──
  cfg.bands.forEach(([s, e, color]) => {
    const angStart = -(G_START_ANG - s * G_SWEEP);
    const angEnd   = -(G_START_ANG - e * G_SWEEP);
    ctx.beginPath();
    ctx.arc(cx, cy, outerR - arcW / 2, angStart, angEnd, false);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = arcW;
    ctx.lineCap = 'butt';
    ctx.stroke();
  });
  ctx.globalAlpha = 1.0;

  // ── Active arc (bright, up to current value) ──
  const clamped = Math.min(Math.max(value, 0), cfg.max);
  const pct = clamped / cfg.max;
  if (pct > 0.005) {
    // draw each band segment that is within the active range
    cfg.bands.forEach(([s, e, color]) => {
      const clipS = Math.max(s, 0);
      const clipE = Math.min(e, pct);
      if (clipE <= clipS) return;
      const angStart = -(G_START_ANG - clipS * G_SWEEP);
      const angEnd   = -(G_START_ANG - clipE * G_SWEEP);
      ctx.beginPath();
      ctx.arc(cx, cy, outerR - arcW / 2, angStart, angEnd, false);
      ctx.strokeStyle = color;
      ctx.lineWidth = arcW;
      ctx.lineCap = 'butt';
      // glow
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    });
  }

  // ── Tick marks & labels ──
  for (let v = 0; v <= cfg.max; v += cfg.minor) {
    const vPct = v / cfg.max;
    const ang = G_START_ANG - vPct * G_SWEEP;
    const isMajor = v % cfg.step === 0;
    const tickLen = isMajor ? outerR * 0.12 : outerR * 0.06;
    const tickR1 = outerR + 2;
    const tickR2 = tickR1 + tickLen;
    
    const x1 = cx + tickR1 * Math.cos(-ang);
    const y1 = cy + tickR1 * Math.sin(-ang);
    const x2 = cx + tickR2 * Math.cos(-ang);
    const y2 = cy + tickR2 * Math.sin(-ang);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = isMajor ? 'rgba(200,220,255,0.5)' : 'rgba(200,220,255,0.15)';
    ctx.lineWidth = isMajor ? 2 : 1;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Labels for major ticks
    if (isMajor) {
      const labelR = tickR2 + (outerR * 0.1);
      const lx = cx + labelR * Math.cos(-ang);
      const ly = cy + labelR * Math.sin(-ang);
      ctx.font = `600 ${Math.round(outerR * 0.1)}px 'Share Tech Mono', monospace`;
      ctx.fillStyle = 'rgba(200,220,255,0.7)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cfg.label(v), lx, ly);
    }
  }

  // ── Needle ──
  const needleAng = G_START_ANG - pct * G_SWEEP;
  const needleLen = outerR * 0.85;
  const nx = cx + needleLen * Math.cos(-needleAng);
  const ny = cy + needleLen * Math.sin(-needleAng);

  // Determine needle color based on value band
  let needleColor = '#ff8800';
  for (const [s, e, col] of cfg.bands) {
    if (pct >= s && pct <= e) { needleColor = col; break; }
  }

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(nx, ny);
  ctx.strokeStyle = needleColor;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.shadowColor = needleColor;
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Center hub
  ctx.beginPath();
  ctx.arc(cx, cy, outerR * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = '#0a1828';
  ctx.strokeStyle = needleColor;
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, outerR * 0.025, 0, Math.PI * 2);
  ctx.fillStyle = needleColor;
  ctx.fill();

  // ── Update digital readout ──
  const num = $(cfg.numId);
  if (num) {
    num.textContent = Math.round(value);
    num.classList.remove('green', 'yellow', 'orange', 'red');
    if (pct < 0.4) num.classList.add('green');
    else if (pct < 0.6) num.classList.add('yellow');
    else if (pct < 0.8) num.classList.add('orange');
    else num.classList.add('red');
  }
}

// ══════════════════════════════════════════════════════════════
// 1. STEERING — Mouse drag + Keyboard A/D
// ══════════════════════════════════════════════════════════════
let dragging = false, dragStartX = 0, dragStartAngle = 0;

if (steerArea) {
  steerArea.addEventListener('mousedown', e => {
    dragging = true;
    dragStartX = e.clientX;
    dragStartAngle = state.steerAngle;
    e.preventDefault();
  });
}

document.addEventListener('mousemove', e => {
  if (!dragging) return;
  const dx = e.clientX - dragStartX;
  const newAngle = Math.max(-540, Math.min(540, dragStartAngle + dx * 0.6));
  state.steerAngle = newAngle;
  updateSteeringVisual();
  socket.emit('key_event', { key: 'steer_absolute', action: 'steer_absolute', angle: newAngle });
});

document.addEventListener('mouseup', () => { dragging = false; });

function updateSteeringVisual() {
  if (wheel) wheel.style.transform = `rotate(${state.steerAngle}deg)`;
  if (steerBadge) {
    const sign = state.steerAngle >= 0 ? '+' : '';
    steerBadge.textContent = `${sign}${state.steerAngle.toFixed(1)}°`;
  }
}

// ══════════════════════════════════════════════════════════════
// 2. PEDALS — Click + W/S keys
// ══════════════════════════════════════════════════════════════
function pedalDown(type) {
  if (type === 'brake') {
    state.brake = true;
    socket.emit('key_event', { key: 's', action: 'down' });
  } else {
    // Block throttle when speed lock is active
    if (state.speedLocked) return;
    state.throttle = true;
    socket.emit('key_event', { key: 'w', action: 'down' });
  }
  updatePedalBars();
}

function pedalUp(type) {
  if (type === 'brake') {
    state.brake = false;
    socket.emit('key_event', { key: 's', action: 'up' });
  } else {
    state.throttle = false;
    socket.emit('key_event', { key: 'w', action: 'up' });
  }
  updatePedalBars();
}

function updatePedalBars() {
  if (brakeBar) brakeBar.style.height = state.brake ? '80%' : '0%';
  if (gasBar) gasBar.style.height = state.throttle ? '80%' : '0%';
}

// ══════════════════════════════════════════════════════════════
// E-BRAKE
// ══════════════════════════════════════════════════════════════
function ebrakeDown() {
  state.ebrake = true;
  socket.emit('key_event', { key: ' ', action: 'down' }); 
  const el = $('ebrake-ind');
  if (el) el.classList.add('active');
}
function ebrakeUp() {
  state.ebrake = false;
  socket.emit('key_event', { key: ' ', action: 'up' });
  const el = $('ebrake-ind');
  if (el) el.classList.remove('active');
}

// ══════════════════════════════════════════════════════════════
// 3. GEAR — Click + P/N/R/G keys (D key avoids steer conflict)
// ══════════════════════════════════════════════════════════════
const GEAR_KEYS = { 0: 'P', 1: 'R', 2: 'N', 3: 'D' };
const GEAR_MAP  = { 'p': 0, 'n': 2, 'r': 1, 'g': 3 };

function setGear(idx) {
  state.gear = idx;
  const letter = GEAR_KEYS[idx];
  document.querySelectorAll('.gear-letter').forEach(el => {
    el.classList.toggle('active', el.dataset.g === letter);
  });
  // simulator.py expects action: 'down' for gear keys
  socket.emit('key_event', { key: letter.toLowerCase() === 'd' ? 'g' : letter.toLowerCase(), action: 'down' });
}

// ══════════════════════════════════════════════════════════════
// 4. DOOR — Click + Key 1 
// ══════════════════════════════════════════════════════════════
function toggleDoor() {
  state.doorOpen = !state.doorOpen;
  const ctrl = $('door-control');
  const val = $('door-val');
  if (ctrl) ctrl.classList.toggle('open', state.doorOpen);
  if (val) val.textContent = state.doorOpen ? 'OPEN' : 'LOCKED';
  socket.emit('key_event', { key: '1', action: 'toggle' });
}

// ══════════════════════════════════════════════════════════════
// 5. SEATBELT — Click + Key 2
// ══════════════════════════════════════════════════════════════
function toggleSeatbelt() {
  state.seatbeltOn = !state.seatbeltOn;
  const ctrl = $('belt-control');
  const val = $('belt-val');
  if (ctrl) ctrl.classList.toggle('off', !state.seatbeltOn);
  if (val) val.textContent = state.seatbeltOn ? 'ON' : 'OFF';
  socket.emit('key_event', { key: '2', action: 'toggle' });
}

// ══════════════════════════════════════════════════════════════
// 6. MUSIC PLAYER — Web Audio synth
// ══════════════════════════════════════════════════════════════
let audioCtx, synthGain, synthOscs = [];

function createSynth() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  synthGain = audioCtx.createGain();
  synthGain.gain.value = state.volume * 0.15;
  synthGain.connect(audioCtx.destination);

  const chords = [
    [261.6, 329.6, 392.0],
    [293.7, 370.0, 440.0],
    [329.6, 415.3, 493.9],
    [349.2, 440.0, 523.3]
  ];
  
  const now = audioCtx.currentTime;
  chords[0].forEach(freq => {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(synthGain);
    osc.start(now);
    synthOscs.push(osc);
  });

  // Chord progression
  let idx = 0;
  setInterval(() => {
    idx = (idx + 1) % chords.length;
    const freqs = chords[idx];
    synthOscs.forEach((osc, i) => {
      if (freqs[i]) osc.frequency.setTargetAtTime(freqs[i], audioCtx.currentTime, 0.3);
    });
  }, 2000);
}

function syncMusicState(isPlaying) {
  if (state.musicPlaying === isPlaying) return;
  state.musicPlaying = isPlaying;
  
  const playIcon  = $('icon-play');
  const pauseIcon = $('icon-pause');
  const viz       = $('viz');

  if (state.musicPlaying) {
    if (!audioCtx) createSynth();
    else audioCtx.resume();
    if (playIcon) playIcon.style.display = 'none';
    if (pauseIcon) pauseIcon.style.display = 'block';
    if (viz) viz.classList.add('playing');
  } else {
    if (audioCtx) audioCtx.suspend();
    if (playIcon) playIcon.style.display = 'block';
    if (pauseIcon) pauseIcon.style.display = 'none';
    if (viz) viz.classList.remove('playing');
  }
}

function toggleMusic() {
  const intendedState = !state.musicPlaying;
  socket.emit('key_event', { key: 'm', action: 'set_music', playing: intendedState });
}

function setVolume(v) {
  state.volume = parseFloat(v);
  if (synthGain) synthGain.gain.value = state.volume * 0.15;
}

// ══════════════════════════════════════════════════════════════
// 8. INDICATORS (Blinkers) — Click + Q/E
// ══════════════════════════════════════════════════════════════
function syncBlinkerState(leftOn, rightOn) {
  if (state.blinkerLeft === leftOn && state.blinkerRight === rightOn) return;
  state.blinkerLeft = leftOn;
  state.blinkerRight = rightOn;
  const l = $('blink-l'), r = $('blink-r');
  if (l) l.classList.toggle('on', state.blinkerLeft);
  if (r) r.classList.toggle('on', state.blinkerRight);
}

function toggleBlinker(side) {
  socket.emit('key_event', { key: side === 'left' ? 'q' : 'e', action: 'toggle' });
}

// ══════════════════════════════════════════════════════════════
// 9. BSM — Click + 3/4
// ══════════════════════════════════════════════════════════════
function toggleBSM(side) {
  if (side === 'left') {
    state.bsmLeft = !state.bsmLeft;
    const el = $('bsm-left');
    if (el) el.classList.toggle('active', state.bsmLeft);
  } else {
    state.bsmRight = !state.bsmRight;
    const el = $('bsm-right');
    if (el) el.classList.toggle('active', state.bsmRight);
  }
  socket.emit('key_event', { key: side === 'left' ? '3' : '4', action: 'toggle' });
}

// ══════════════════════════════════════════════════════════════
// SPEED LOCK — Click button or press K
// ══════════════════════════════════════════════════════════════
function toggleSpeedLock() {
  const intendedActive = !state.speedLocked;

  if (intendedActive) {
    // Release any held throttle before locking so the server sees no throttle input
    if (state.throttle) {
      state.throttle = false;
      socket.emit('key_event', { key: 'w', action: 'up' });
      updatePedalBars();
    }
    // Send current speed — server will also use its own live value as the source of truth
    socket.emit('set_speed_lock', { active: true, speed: state.speed });
  } else {
    socket.emit('set_speed_lock', { active: false, speed: 0 });
  }
}

function syncSpeedLock(active, lockedSpeed) {
  state.speedLocked = active;
  state.lockedSpeed = lockedSpeed;

  const btn   = $('speed-lock-btn');
  const badge = $('sl-speed-badge');
  const val   = $('sl-locked-val');

  if (btn)   btn.classList.toggle('active', active);
  if (badge) badge.classList.toggle('visible', active);
  if (val)   val.textContent = lockedSpeed.toFixed(1);
}

// ══════════════════════════════════════════════════════════════
// CAN INFO POPUP
// ══════════════════════════════════════════════════════════════
function toggleCanPopup() {
  const overlay = $('can-popup-overlay');
  if (overlay) overlay.classList.toggle('visible');
}
function closeCanPopup(e) {
  if (e.target === $('can-popup-overlay')) {
    $('can-popup-overlay').classList.remove('visible');
  }
}

// ══════════════════════════════════════════════════════════════
// HEADLIGHT / HIGHBEAM
// ══════════════════════════════════════════════════════════════
function toggleHeadlight() {
  state.headlights = !state.headlights;
  const el = $('headlight-btn');
  if (el) el.classList.toggle('on', state.headlights);
  socket.emit('key_event', { key: 'l', action: 'toggle' });
}
function toggleHighbeam() {
  state.highbeam = !state.highbeam;
  const el = $('highbeam-btn');
  if (el) el.classList.toggle('on', state.highbeam);
  socket.emit('key_event', { key: 'h', action: 'toggle' });
}

// ══════════════════════════════════════════════════════════════
// KEYBOARD HANDLER — All controls work with keyboard
// ══════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  switch (k) {
    case 'w': case 'arrowup':
      // Block throttle when speed lock is active
      if (!state.speedLocked) pedalDown('gas');
      break;
    case 's': case 'arrowdown':  pedalDown('brake'); break;
    case 'a': case 'arrowleft':
      state.steerAngle = Math.max(-540, state.steerAngle - 15);
      updateSteeringVisual();
      socket.emit('key_event', { key: 'a', action: 'down' });
      break;
    case 'd': case 'arrowright':
      state.steerAngle = Math.min(540, state.steerAngle + 15);
      updateSteeringVisual();
      socket.emit('key_event', { key: 'd', action: 'down' });
      break;
    case 'q': toggleBlinker('left'); break;
    case 'e': toggleBlinker('right'); break;
    case 'l': toggleHeadlight(); break;
    case 'h': toggleHighbeam(); break;
    case 'm': toggleMusic(); break;
    case '1': toggleDoor(); break;
    case '2': toggleSeatbelt(); break;
    case '3': toggleBSM('left'); break;
    case '4': toggleBSM('right'); break;
    case ' ': ebrakeDown(); e.preventDefault(); break;
    case 'p': setGear(0); break;
    case 'n': setGear(2); break;
    case 'r': setGear(1); break;
    case 'g': setGear(3); break;
    case 'k': toggleSpeedLock(); break;
    case 'i': toggleCanPopup(); break;
    case 'escape':
      const overlay = $('can-popup-overlay');
      if (overlay && overlay.classList.contains('visible')) {
        overlay.classList.remove('visible');
      }
      break;
  }
});

document.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  switch (k) {
    case 'w': case 'arrowup':   pedalUp('gas'); break;
    case 's': case 'arrowdown': pedalUp('brake'); break;
    case 'a': case 'arrowleft':
      socket.emit('key_event', { key: 'a', action: 'up' });
      break;
    case 'd': case 'arrowright':
      socket.emit('key_event', { key: 'd', action: 'up' });
      break;
    case ' ': ebrakeUp(); break;
  }
});

// ══════════════════════════════════════════════════════════════
// SOCKET.IO — Receive state updates from server
// ══════════════════════════════════════════════════════════════
socket.on('state_update', data => {
  if (data.speed !== undefined) {
    state.speed = data.speed;
    drawGauge('speedo', state.speed);
  }
  if (data.rpm !== undefined) {
    state.rpm = data.rpm;
    drawGauge('rpm', state.rpm);
  }
  if (data.steering !== undefined) {
    state.steerAngle = data.steering;
    updateSteeringVisual();
  }
  if (data.throttle_pct !== undefined) {
    if (gasBar) gasBar.style.height = (data.throttle_pct * 100) + '%';
  }
  if (data.brake_pct !== undefined) {
    if (brakeBar) brakeBar.style.height = (data.brake_pct * 100) + '%';
  }
  if (data.gear !== undefined) {
    state.gear = data.gear;
    const letter = GEAR_KEYS[data.gear] || 'D';
    document.querySelectorAll('.gear-letter').forEach(el => {
      el.classList.toggle('active', el.dataset.g === letter);
    });
  }
  if (data.demo !== undefined) {
    state.demo = data.demo;
    const banner = $('demo-banner');
    if (banner) banner.style.display = data.demo ? 'block' : 'none';
  }
  if (data.can_ok !== undefined) setCanStatus('can', data.can_ok);
  if (data.mps !== undefined) {
    const el = $('mps-val');
    if (el) el.textContent = data.mps;
  }
  if (data.music_playing !== undefined) {
    syncMusicState(data.music_playing);
  }
  if (data.left_blinker !== undefined && data.right_blinker !== undefined) {
    syncBlinkerState(data.left_blinker, data.right_blinker);
  }
  if (data.speed_locked !== undefined) {
    syncSpeedLock(data.speed_locked, data.locked_speed ?? 0);
  }
});

// Dedicated speed-lock broadcast (fired by set_speed_lock handler)
socket.on('speed_lock_update', data => {
  syncSpeedLock(data.active, data.locked_speed ?? 0);
});

// ══════════════════════════════════════════════════════════════
// ADAS ALERT PANEL — live warnings from the ADAS PC
// ══════════════════════════════════════════════════════════════
const STATUS_COLORS = {
  none:           '#546e7a',
  normal:         '#00ff88',
  userPrompt:     '#ffcc00',
  critical:       '#ff1744',
  faultPermanent: '#ff6d00',
};

function updateAdasPanel(data) {
  const connDot  = $('adas-conn-dot');
  const connTxt  = $('adas-conn-txt');
  const alertBox = $('adas-alert-box');
  const alert1   = $('adas-alert1');
  const alert2   = $('adas-alert2');
  const bsmL     = $('adas-bsm-left');
  const bsmR     = $('adas-bsm-right');
  const fcwVal   = $('adas-fcw-val');
  const leadVal  = $('adas-lead-val');
  const sysSt    = $('adas-sys-status');

  const connected = data.connected !== false;

  // ── Connection indicator ──
  if (connDot) connDot.classList.toggle('ok', connected);
  if (connTxt) connTxt.textContent = connected ? 'LIVE' : 'OFFLINE';

  if (!connected) {
    if (alert1)   { alert1.textContent = 'NO SIGNAL'; alert1.style.color = '#546e7a'; }
    if (alert2)   alert2.textContent = '';
    if (alertBox) alertBox.classList.remove('critical');
    return;
  }

  // ── Alert text ──
  const text1  = data.alert_text1 || '';
  const text2  = data.alert_text2 || '';
  const status = (data.alert_status || 'none');
  const isCrit = status.toLowerCase().includes('critical');

  if (alert1) {
    alert1.textContent  = text1 || 'No Alert';
    alert1.style.color  = STATUS_COLORS[status] || STATUS_COLORS.none;
  }
  if (alert2)   alert2.textContent = text2;
  if (alertBox) alertBox.classList.toggle('critical', isCrit);

  // ── BSM ──
  const bsmLeft  = data.bsm_left  || false;
  const bsmRight = data.bsm_right || false;
  if (bsmL) { bsmL.textContent = bsmLeft  ? '\u26a0 BSM L \u26a0' : '\u25c4 BSM'; bsmL.classList.toggle('active', bsmLeft);  }
  if (bsmR) { bsmR.textContent = bsmRight ? '\u26a0 BSM R \u26a0' : 'BSM \u25ba'; bsmR.classList.toggle('active', bsmRight); }

  // ── FCW ──
  const fcw = data.fcw || false;
  if (fcwVal) {
    fcwVal.textContent = fcw ? 'BRAKE!' : 'Clear';
    fcwVal.className   = 'adas-row-val' + (fcw ? ' warn' : '');
  }

  // ── Lead car ──
  const lead     = data.lead_detected || false;
  const leadDist = data.lead_distance || -1;
  if (leadVal) {
    if (lead && leadDist > 0) {
      leadVal.textContent = leadDist + 'm';
      leadVal.className   = 'adas-row-val info';
    } else {
      leadVal.textContent = 'None';
      leadVal.className   = 'adas-row-val';
    }
  }

  // ── System status ──
  const active  = data.active  || false;
  const enabled = data.enabled || false;
  if (sysSt) {
    if (active)       { sysSt.textContent = 'ACTIVE';  sysSt.className = 'adas-sys-status active'; }
    else if (enabled) { sysSt.textContent = 'ENABLED'; sysSt.className = 'adas-sys-status enabled'; }
    else              { sysSt.textContent = 'STANDBY'; sysSt.className = 'adas-sys-status'; }
  }
}

socket.on('adas_alert', data => { updateAdasPanel(data); });

function setCanStatus(type, ok) {
  if (type === 'can' || type === 'io') {
    state.canOk = ok;
    const dot = $('can-dot');
    const txt = $('can-text');
    if (dot) dot.classList.toggle('ok', ok);
    if (txt) txt.textContent = ok ? 'CAN: OK' : (type === 'io' ? (ok ? 'CAN: CONN' : 'CAN: DISC') : 'CAN: DEMO');
  }
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  drawGauge('speedo', 0);
  drawGauge('rpm', 800);
  updateSteeringVisual();
  updatePedalBars();
  // Set initial gear to D
  setGear(3);
});
