/* ==========================================================================
   Gesture Controller
   On-device hand tracking (MediaPipe Tasks Vision) driving a media engine and
   an on-screen pointer. No build step, no framework, no server.

   Sections
     1. Content + gesture vocabulary
     2. DOM + state
     3. Audio engine (Web Audio pad, analyser, waveform)
     4. Media controls (tracks, transport, volume)
     5. Pointer
     6. Gesture pipeline (classification, smoothing, dispatch)
     7. Simulator (synthetic landmarks + palette)
     8. Camera + MediaPipe inference loop
     9. Wiring, keyboard, boot
   ========================================================================== */

/* ---------------------------------------------------------------- content */

const TRACKS = [
  {
    title: "Low Orbit",
    desc: "Wide pad · A minor · slow filter drift",
    notes: [110.0, 164.81, 261.63],
    cutoff: 760,
    wave: "sine",
    mix: [0.18, 0.12, 0.08],
  },
  {
    title: "Signal Drift",
    desc: "Narrow pulse · D minor · moving cutoff",
    notes: [146.83, 220.0, 349.23],
    cutoff: 1180,
    wave: "triangle",
    mix: [0.15, 0.1, 0.06],
  },
  {
    title: "Night Transit",
    desc: "Deep chord · F major · long tail",
    notes: [87.31, 130.81, 349.23],
    cutoff: 640,
    wave: "sawtooth",
    mix: [0.14, 0.1, 0.045],
  },
];

const GESTURES = {
  OPEN_PALM: {
    label: "Open palm",
    action: "Pointer — steer with the palm",
    verb: "Pointer",
  },
  PINCH: {
    label: "Pinch",
    action: "Volume — continuous",
    verb: "Volume",
  },
  PEACE: {
    label: "Peace",
    action: "Play / pause playback",
    verb: "Playback",
  },
  THUMBS_UP: {
    label: "Thumbs up",
    action: "Next track",
    verb: "Track",
  },
  FIST: {
    label: "Closed fist",
    action: "Mute / unmute",
    verb: "Mute",
  },
  UNKNOWN: {
    label: "No hand",
    action: "Show your hand to begin",
    verb: "Idle",
  },
};

// MediaPipe hand topology (21 points).
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const DISCRETE = new Set(["THUMBS_UP", "PEACE", "FIST"]);
const HOLD_MS = 220;
const COOLDOWN_MS = 900;
const SIM_COOLDOWN_MS = 320;

/* ------------------------------------------------------------------- dom */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const dom = {
  fps: $("#fps"),
  statusPill: $("#status-pill"),
  statusText: $("#status-text"),
  modeCamera: $("#mode-camera"),
  modeSim: $("#mode-sim"),
  waveform: $("#waveform"),
  trackIndex: $("#track-index"),
  trackTitle: $("#track-title"),
  trackDesc: $("#track-desc"),
  trackState: $("#track-state"),
  trackStateText: $("#track-state-text"),
  prev: $("#btn-prev"),
  play: $("#btn-play"),
  next: $("#btn-next"),
  mute: $("#btn-mute"),
  volume: $("#volume"),
  volumeValue: $("#volume-value"),
  volumeSource: $("#volume-source"),
  pointerPad: $("#pointer-pad"),
  pointerDot: $("#pointer-dot"),
  pointerHint: $("#pointer-hint"),
  pointerX: $("#pointer-x"),
  pointerY: $("#pointer-y"),
  pointerStatus: $("#pointer-status"),
  viewport: $("#viewport"),
  video: $("#video"),
  overlay: $("#overlay"),
  empty: $("#camera-empty"),
  cameraNote: $("#camera-note"),
  cameraBtn: $("#btn-camera"),
  simStart: $("#btn-sim-start"),
  simStage: $("#sim-stage"),
  simSkeleton: $("#sim-skeleton"),
  simPanel: $("#sim-panel"),
  palette: $("#sim-palette"),
  pinchStrength: $("#pinch-strength"),
  pinchStrengthValue: $("#pinch-strength-value"),
  badge: $("#camera-badge"),
  gestureName: $("#gesture-name"),
  gestureAction: $("#gesture-action"),
  confidenceValue: $("#confidence-value"),
  confidenceFill: $("#confidence-fill"),
  visionMeta: $("#vision-meta"),
  engineMeta: $("#engine-meta"),
  mappingItems: $$(".mapping__item"),
  log: $("#log"),
  logEmpty: $("#log-empty"),
  clearLog: $("#btn-clear-log"),
  toast: $("#toast"),
};

/* ----------------------------------------------------------------- state */

const state = {
  trackIndex: 0,
  volume: 50,
  muted: false,
  playing: false,
  mode: "idle", // idle | camera | sim
  confidence: 0,
  displayGesture: "UNKNOWN",
  log: [],
  simGesture: "OPEN_PALM",
  lastDiscreteAt: 0,
  stableLabel: "UNKNOWN",
  stableSince: 0,
  firedFor: null,
  pinchLogged: false,
};

const camera = {
  stream: null,
  landmarker: null,
  loading: false,
  starting: false,
  loopId: null,
  lastVideoTime: -1,
  fpsEma: 0,
  lastFrameAt: 0,
  history: [],
  running: false,
};

const audio = {
  ctx: null,
  master: null,
  filter: null,
  analyser: null,
  data: null,
  voices: [],
};

/* --------------------------------------------------------------- helpers */

const pad = (n) => String(n).padStart(2, "0");
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function setStatus(kind, text) {
  dom.statusPill.dataset.state = kind;
  dom.statusText.textContent = text;
}

/* ==========================================================================
   Audio engine
   ========================================================================== */

function ensureAudio() {
  if (audio.ctx) return audio.ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {
    dom.engineMeta.textContent = "Web Audio unavailable";
    return null;
  }

  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = 0.0001;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = TRACKS[state.trackIndex].cutoff;
  filter.Q.value = 0.8;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.72;

  filter.connect(master);
  master.connect(analyser);
  analyser.connect(ctx.destination);

  // Slow cutoff drift so the pad breathes instead of sitting still.
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.07;
  lfoGain.gain.value = 110;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  lfo.start();

  audio.ctx = ctx;
  audio.master = master;
  audio.filter = filter;
  audio.analyser = analyser;
  // Time-domain reads need fftSize samples (frequency reads use fftSize / 2).
  audio.data = new Uint8Array(analyser.fftSize);

  buildVoices(TRACKS[state.trackIndex]);
  dom.engineMeta.textContent = `${Math.round(ctx.sampleRate / 1000)} kHz · local synth`;
  return ctx;
}

function buildVoices(track) {
  if (!audio.ctx) return;
  const ctx = audio.ctx;
  const now = ctx.currentTime;

  for (const voice of audio.voices) {
    try {
      voice.osc.stop(now);
    } catch {
      /* already stopped */
    }
    voice.osc.disconnect();
    voice.gain.disconnect();
  }

  audio.voices = track.notes.map((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = track.wave;
    osc.frequency.value = freq;
    osc.detune.value = i === 1 ? 7 : -6;

    const gain = ctx.createGain();
    gain.gain.value = track.mix[i] ?? 0.08;

    osc.connect(gain);
    gain.connect(audio.filter);
    osc.start(now);
    return { osc, gain };
  });

  audio.filter.frequency.setTargetAtTime(track.cutoff, now, 0.25);
}

function applyGain() {
  if (!audio.ctx) return;
  const target =
    state.muted || !state.playing
      ? 0.0001
      : Math.max(0.0001, Math.pow(state.volume / 100, 1.7) * 0.34);
  audio.master.gain.setTargetAtTime(target, audio.ctx.currentTime, 0.07);
}

/* ------------------------------------------------------------- waveform */

const wave = { points: new Array(140).fill(0) };

function drawWave(now) {
  const canvas = dom.waveform;
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);

  const points = wave.points.length;
  const live = Boolean(state.playing && !state.muted && audio.analyser && audio.data);
  if (live) audio.analyser.getByteTimeDomainData(audio.data);

  // Normalise the display against the current gain so a quiet pad still reads.
  const boost = clamp(0.35 / Math.max(0.0001, audio.master?.gain.value || 0.35), 1, 6);
  const mid = height / 2;
  const amplitude = height * 0.4;

  for (let i = 0; i < points; i++) {
    let target;
    if (live) {
      const src = audio.data[Math.floor((i / (points - 1)) * (audio.data.length - 1))] || 128;
      target = clamp(((src - 128) / 128) * boost * 6.5, -1, 1);
    } else {
      target =
        0.16 * Math.sin(i * 0.19 + now / 950) +
        0.06 * Math.sin(i * 0.061 - now / 1500);
    }
    // Live signal changes phase every frame, so it needs a fast follower;
    // the idle sweep is slow on purpose.
    wave.points[i] += (target - wave.points[i]) * (live ? 0.82 : 0.12);
  }

  const trace = () => {
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const x = (i / (points - 1)) * width;
      const y = mid - wave.points[i] * amplitude;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };

  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "rgba(201, 245, 109, 0.35)");
  gradient.addColorStop(0.5, "rgba(201, 245, 109, 0.95)");
  gradient.addColorStop(1, "rgba(201, 245, 109, 0.35)");

  trace();
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 1.6 * dpr;
  ctx.lineJoin = "round";
  ctx.stroke();

  // Mirror the trace back to the centre line for weight.
  ctx.lineTo(width, mid);
  ctx.lineTo(0, mid);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, mid - amplitude, 0, mid + amplitude);
  fill.addColorStop(0, "rgba(201, 245, 109, 0.10)");
  fill.addColorStop(1, "rgba(201, 245, 109, 0.01)");
  ctx.fillStyle = fill;
  ctx.fill();
}

function pumpFrame(now) {
  drawWave(now);
  requestAnimationFrame(pumpFrame);
}

/* ==========================================================================
   Media controls
   ========================================================================== */

function renderVolume() {
  dom.volume.value = String(state.volume);
  dom.volume.style.setProperty("--fill", `${state.volume}%`);
  dom.volumeValue.textContent = `${state.volume}%`;
}

function renderPlayer() {
  const track = TRACKS[state.trackIndex];
  dom.trackIndex.textContent = `Track ${pad(state.trackIndex + 1)} / ${pad(TRACKS.length)}`;
  dom.trackTitle.textContent = track.title;
  dom.trackDesc.textContent = track.desc;

  const mode = state.muted ? "muted" : state.playing ? "playing" : "paused";
  dom.trackState.dataset.state = mode;
  dom.trackStateText.textContent = state.muted ? "Muted" : state.playing ? "Playing" : "Paused";

  dom.play.setAttribute("aria-pressed", String(state.playing));
  dom.play.setAttribute("aria-label", state.playing ? "Pause audio" : "Play audio");
  dom.play.innerHTML = state.playing
    ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';

  dom.mute.setAttribute("aria-pressed", String(state.muted));
  dom.mute.setAttribute("aria-label", state.muted ? "Unmute audio" : "Mute audio");
  dom.mute.innerHTML = state.muted
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3l4.5-3.5v12L7 14.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3l4.5-3.5v12L7 14.5H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
}

function setVolume(value, { log = false, source = "control" } = {}) {
  const next = clamp(Math.round(value), 0, 100);
  const changed = next !== state.volume;
  state.volume = next;

  if (state.volume > 0 && state.muted) {
    state.muted = false;
    renderPlayer();
  }
  renderVolume();
  applyGain();
  if (changed && log) addLog("Volume", `${state.volume}%`, source);
}

function setTrack(index, { log = true, source = "control" } = {}) {
  const next = ((index % TRACKS.length) + TRACKS.length) % TRACKS.length;
  if (next === state.trackIndex && log === false) return;
  state.trackIndex = next;
  const track = TRACKS[next];
  if (audio.ctx) buildVoices(track);
  renderPlayer();
  if (log) addLog("Track", `${pad(next + 1)} · ${track.title}`, source);
}

function nextTrack(source = "control") {
  setTrack(state.trackIndex + 1, { source });
}

function prevTrack(source = "control") {
  setTrack(state.trackIndex - 1, { source });
}

function togglePlay(source = "control") {
  state.playing = !state.playing;
  if (state.playing) {
    ensureAudio();
    audio.ctx?.resume?.();
  }
  applyGain();
  renderPlayer();
  addLog("Playback", state.playing ? "Playing" : "Paused", source);
  return state.playing;
}

function toggleMute(source = "control") {
  state.muted = !state.muted;
  applyGain();
  renderPlayer();
  addLog("Audio", state.muted ? "Muted" : "Unmuted", source);
  return state.muted;
}

/* ------------------------------------------------------------------- log */

function addLog(what, detail, source = "control") {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  state.log.unshift({ time, what, detail, source });
  state.log = state.log.slice(0, 8);
  renderLog();
}

function renderLog() {
  if (!state.log.length) {
    dom.log.replaceChildren(dom.logEmpty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const entry of state.log) {
    const li = document.createElement("li");
    li.className = "log__item";

    const time = document.createElement("span");
    time.className = "log__time";
    time.textContent = entry.time;

    const what = document.createElement("span");
    what.className = "log__what";
    what.textContent = entry.what;

    const detail = document.createElement("span");
    detail.className = "log__detail";
    detail.textContent = entry.detail;

    li.append(time, what, detail);
    frag.append(li);
  }
  dom.log.replaceChildren(frag);
}

/* ----------------------------------------------------------------- toast */

let toastTimer = null;
function toast(message, tone = "info") {
  dom.toast.textContent = message;
  dom.toast.dataset.tone = tone;
  dom.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => dom.toast.classList.remove("is-visible"), 3600);
}

/* ==========================================================================
   Pointer
   ========================================================================== */

function showPointer(x, y, active) {
  const px = clamp(x, 0, 1);
  const py = clamp(y, 0, 1);
  dom.pointerDot.hidden = false;
  dom.pointerDot.style.left = `${(px * 100).toFixed(2)}%`;
  dom.pointerDot.style.top = `${(py * 100).toFixed(2)}%`;
  dom.pointerPad.classList.toggle("is-tracking", active);
  dom.pointerX.textContent = `x ${px.toFixed(2)}`;
  dom.pointerY.textContent = `y ${py.toFixed(2)}`;
  dom.pointerStatus.textContent = active ? "Tracking" : "Hand detected";
}

function hidePointer() {
  dom.pointerDot.hidden = true;
  dom.pointerPad.classList.remove("is-tracking");
  dom.pointerX.textContent = "x 0.50";
  dom.pointerY.textContent = "y 0.50";
  dom.pointerStatus.textContent = "Idle";
}

/* ------------------------------------------------------------- status UI */

function renderGesture(gesture, confidence) {
  const meta = GESTURES[gesture] || GESTURES.UNKNOWN;
  state.displayGesture = gesture;
  state.confidence = clamp(confidence || 0, 0, 1);

  dom.gestureName.textContent = meta.label;
  dom.gestureAction.textContent = meta.action;
  dom.confidenceValue.textContent = confidence ? `${Math.round(state.confidence * 100)}%` : "—";
  dom.confidenceFill.style.width = `${state.confidence * 100}%`;
  dom.volumeSource.hidden = gesture !== "PINCH";

  for (const item of dom.mappingItems) {
    item.classList.toggle("is-live", item.dataset.gesture === gesture);
  }
}

function flowConfidence(target) {
  state.confidence += (target - state.confidence) * 0.35;
}

/* ==========================================================================
   Gesture pipeline
   ========================================================================== */

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function classify(landmarks) {
  if (!landmarks || landmarks.length < 21) {
    return { gesture: "UNKNOWN", confidence: 0, intensity: null };
  }
  const wrist = landmarks[0];
  const scale = Math.max(
    dist(wrist, landmarks[9]),
    dist(landmarks[5], landmarks[17]),
    0.06
  );

  const fingerUp = (tip, pip) => {
    const byTip = landmarks[tip].y < landmarks[pip].y - 0.008;
    const byReach = dist(wrist, landmarks[tip]) > dist(wrist, landmarks[pip]) * 1.12;
    return byTip || byReach;
  };

  const indexUp = fingerUp(8, 6);
  const middleUp = fingerUp(12, 10);
  const ringUp = fingerUp(16, 14);
  const pinkyUp = fingerUp(20, 18);

  // Thumb: the tip sits noticeably farther from the index knuckle than the IP joint.
  const thumbUp =
    dist(landmarks[4], landmarks[5]) > dist(landmarks[3], landmarks[5]) * 1.18 &&
    dist(wrist, landmarks[4]) > dist(wrist, landmarks[3]) * 1.05;

  const pinchRatio = dist(landmarks[4], landmarks[8]) / scale;
  const indexReach = dist(wrist, landmarks[8]) / Math.max(dist(wrist, landmarks[5]), 0.001);
  const pinch = pinchRatio < 0.34 && indexReach > 1.08;

  if (pinch) {
    return {
      gesture: "PINCH",
      confidence: clamp(0.94 + (0.34 - pinchRatio) * 0.12, 0.9, 0.99),
      intensity: clamp((1 - pinchRatio / 0.34) * 100, 0, 100),
      pinchRatio,
    };
  }

  if (thumbUp && !indexUp && !middleUp && !ringUp && !pinkyUp) {
    return { gesture: "THUMBS_UP", confidence: 0.91, intensity: null };
  }

  if (indexUp && middleUp && !ringUp && !pinkyUp) {
    return { gesture: "PEACE", confidence: 0.95, intensity: null };
  }

  if (indexUp && middleUp && ringUp && pinkyUp) {
    return { gesture: "OPEN_PALM", confidence: 0.97, intensity: null };
  }

  if (!indexUp && !middleUp && !ringUp && !pinkyUp) {
    return { gesture: "FIST", confidence: 0.9, intensity: null };
  }

  return { gesture: "UNKNOWN", confidence: 0.45, intensity: null };
}

function majorityLabel(history) {
  if (!history.length) return "UNKNOWN";
  const counts = new Map();
  for (const label of history) counts.set(label, (counts.get(label) || 0) + 1);
  let best = "UNKNOWN";
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (label === "UNKNOWN") continue;
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return bestCount >= 2 ? best : "UNKNOWN";
}

function onLandmarks(landmarks) {
  const now = performance.now();
  const result = classify(landmarks);

  camera.history.push(result.gesture);
  if (camera.history.length > 5) camera.history.shift();
  const stable = majorityLabel(camera.history);

  if (stable !== state.stableLabel) {
    if (state.stableLabel === "PINCH" && state.pinchLogged) {
      addLog("Volume", `${state.volume}%`, "gesture");
      state.pinchLogged = false;
    }
    state.stableLabel = stable;
    state.stableSince = now;
    state.firedFor = null;
  }

  const held = now - state.stableSince;
  if (held >= HOLD_MS) {
    if (stable === "PINCH") {
      const intensity = result.intensity ?? 50;
      const next = Math.round(state.volume + (intensity - state.volume) * 0.4);
      setVolume(next);
      if (!state.pinchLogged) {
        state.pinchLogged = true;
        addLog("Volume", `${state.volume}%`, "gesture");
      }
    } else if (DISCRETE.has(stable) && state.firedFor !== stable) {
      if (now - state.lastDiscreteAt > COOLDOWN_MS) {
        state.firedFor = stable;
        state.lastDiscreteAt = now;
        runAction(stable, "gesture");
      }
    }
  }

  // Palm position drives the pointer. The preview is mirrored, so x is flipped.
  const palm = landmarks[9];
  showPointer(1 - palm.x, palm.y, stable === "OPEN_PALM");

  const shown = GESTURES[stable] ? stable : "UNKNOWN";
  const target = shown === "UNKNOWN" ? 0 : result.confidence || 0;
  flowConfidence(target);
  renderGesture(shown, state.confidence);
}

function runAction(gesture, source) {
  switch (gesture) {
    case "THUMBS_UP":
      nextTrack(source);
      break;
    case "PEACE":
      togglePlay(source);
      break;
    case "FIST":
      toggleMute(source);
      break;
    case "PINCH":
      addLog("Volume", `${state.volume}%`, source);
      break;
    default:
      break;
  }
}

/* ==========================================================================
   Simulator
   ========================================================================== */

// Synthetic 21-point hands (normalised, same geometry as the Python reference).
const SYNTHETIC = {
  OPEN_PALM: [
    [0.5, 0.84],
    [0.4, 0.72], [0.34, 0.62], [0.3, 0.52], [0.29, 0.42],
    [0.45, 0.62], [0.43, 0.47], [0.41, 0.35], [0.4, 0.24],
    [0.51, 0.61], [0.51, 0.44], [0.51, 0.31], [0.51, 0.19],
    [0.57, 0.62], [0.59, 0.46], [0.6, 0.34], [0.61, 0.23],
    [0.63, 0.64], [0.66, 0.51], [0.68, 0.41], [0.7, 0.31],
  ],
  PINCH: [
    [0.5, 0.84],
    [0.45, 0.72], [0.43, 0.6], [0.42, 0.5], [0.43, 0.42],
    [0.47, 0.62], [0.45, 0.51], [0.44, 0.44], [0.43, 0.42],
    [0.53, 0.62], [0.54, 0.53], [0.54, 0.6], [0.54, 0.67],
    [0.57, 0.63], [0.58, 0.56], [0.58, 0.62], [0.58, 0.69],
    [0.62, 0.65], [0.63, 0.58], [0.63, 0.64], [0.63, 0.71],
  ],
  PEACE: [
    [0.5, 0.84],
    [0.44, 0.72], [0.42, 0.64], [0.42, 0.57], [0.44, 0.55],
    [0.47, 0.61], [0.45, 0.46], [0.43, 0.34], [0.42, 0.23],
    [0.53, 0.61], [0.53, 0.45], [0.54, 0.33], [0.55, 0.22],
    [0.58, 0.62], [0.59, 0.56], [0.59, 0.63], [0.59, 0.7],
    [0.63, 0.65], [0.64, 0.59], [0.64, 0.66], [0.64, 0.72],
  ],
  THUMBS_UP: [
    [0.5, 0.84],
    [0.43, 0.68], [0.4, 0.53], [0.38, 0.39], [0.37, 0.25],
    [0.48, 0.62], [0.48, 0.56], [0.48, 0.63], [0.48, 0.7],
    [0.53, 0.61], [0.53, 0.55], [0.53, 0.63], [0.53, 0.7],
    [0.58, 0.62], [0.58, 0.56], [0.58, 0.64], [0.58, 0.71],
    [0.63, 0.65], [0.63, 0.59], [0.63, 0.66], [0.63, 0.73],
  ],
  FIST: [
    [0.5, 0.84],
    [0.44, 0.72], [0.45, 0.63], [0.46, 0.6], [0.48, 0.6],
    [0.48, 0.62], [0.48, 0.57], [0.48, 0.64], [0.48, 0.7],
    [0.53, 0.61], [0.53, 0.56], [0.53, 0.63], [0.53, 0.7],
    [0.58, 0.62], [0.58, 0.57], [0.58, 0.64], [0.58, 0.71],
    [0.63, 0.65], [0.63, 0.6], [0.63, 0.67], [0.63, 0.74],
  ],
};

const SVG_NS = "http://www.w3.org/2000/svg";

function drawSyntheticHand(gesture) {
  const points = SYNTHETIC[gesture] || SYNTHETIC.OPEN_PALM;
  const frag = document.createDocumentFragment();

  for (const [a, b] of CONNECTIONS) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", (points[a][0] * 200).toFixed(1));
    line.setAttribute("y1", (points[a][1] * 220).toFixed(1));
    line.setAttribute("x2", (points[b][0] * 200).toFixed(1));
    line.setAttribute("y2", (points[b][1] * 220).toFixed(1));
    line.setAttribute("stroke-opacity", a === 0 ? "0.85" : "0.55");
    line.setAttribute("stroke-width", a === 0 ? "2.4" : "1.7");
    frag.append(line);
  }
  points.forEach(([x, y], i) => {
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", (x * 200).toFixed(1));
    dot.setAttribute("cy", (y * 220).toFixed(1));
    dot.setAttribute("r", i === 4 || i === 8 ? "3.4" : "2.2");
    dot.setAttribute("fill", i === 4 || i === 8 ? "var(--accent)" : "#080a0f");
    dot.setAttribute("stroke", "var(--accent)");
    dot.setAttribute("stroke-width", "1.4");
    frag.append(dot);
  });

  dom.simSkeleton.replaceChildren(frag);
}

function setSimGesture(gesture, { silence = false } = {}) {
  state.simGesture = gesture;
  drawSyntheticHand(gesture);
  for (const chip of $$(".gesture-chip", dom.palette)) {
    chip.classList.toggle("is-active", chip.dataset.gesture === gesture);
  }

  const meta = GESTURES[gesture];
  renderGesture(gesture, meta ? 0.95 : 0);

  if (gesture === "OPEN_PALM") showPointer(0.5, 0.5, true);
  else if (state.mode === "sim") showPointer(0.5, 0.5, false);

  if (silence) return;

  if (gesture === "PINCH") {
    setVolume(Number(dom.pinchStrength.value), { log: true, source: "sim" });
    return;
  }
  const now = performance.now();
  if (now - state.lastDiscreteAt < SIM_COOLDOWN_MS) return;
  state.lastDiscreteAt = now;
  runAction(gesture, "sim");
}

function enterSimulator() {
  stopCamera({ silent: true });
  state.mode = "sim";
  dom.empty.hidden = true;
  dom.viewport.classList.remove("is-live");
  dom.badge.hidden = true;
  dom.simStage.hidden = false;
  dom.simPanel.hidden = false;
  dom.modeCamera.classList.remove("is-active");
  dom.modeSim.classList.add("is-active");
  dom.modeCamera.setAttribute("aria-selected", "false");
  dom.modeSim.setAttribute("aria-selected", "true");
  setStatus("sim", "Simulator");
  dom.fps.textContent = "— fps";
  dom.visionMeta.textContent = "Simulator · mouse steers pointer";
  setSimGesture(state.simGesture, { silence: true });
  renderGesture(state.simGesture, 0.95);
}

/* ==========================================================================
   Camera + MediaPipe
   ========================================================================== */

const MP_VERSION = "0.10.14";
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

async function loadLandmarker() {
  if (camera.landmarker) return camera.landmarker;
  if (camera.loading) return null;
  camera.loading = true;
  setStatus("idle", "Loading model…");
  dom.visionMeta.textContent = "Loading MediaPipe…";

  try {
    const { FilesetResolver, HandLandmarker } = await import(MP_BUNDLE);
    const fileset = await FilesetResolver.forVisionTasks(MP_WASM);

    const build = (delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MP_MODEL, delegate },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

    try {
      camera.landmarker = await build("GPU");
      dom.visionMeta.textContent = "MediaPipe · GPU";
    } catch {
      camera.landmarker = await build("CPU");
      dom.visionMeta.textContent = "MediaPipe · CPU";
    }
    setStatus("live", "Camera live");
    return camera.landmarker;
  } finally {
    camera.loading = false;
  }
}

async function startCamera() {
  if (camera.starting) return;
  if (state.mode === "camera" && camera.running) {
    toast("Camera is already live.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    failCamera("This browser does not expose a camera API. Try Chrome or Edge, or use the simulator.");
    return;
  }

  camera.starting = true;
  setStatus("idle", "Requesting camera…");
  dom.cameraBtn.disabled = true;
  dom.cameraNote.textContent = "Waiting for camera permission…";

  try {
    camera.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 960 },
        height: { ideal: 720 },
      },
    });
    dom.video.srcObject = camera.stream;
    await dom.video.play();

    dom.viewport.classList.add("is-live");
    dom.empty.hidden = true;
    dom.simStage.hidden = true;
    dom.simPanel.hidden = true;
    dom.badge.hidden = false;
    dom.modeSim.classList.remove("is-active");
    dom.modeCamera.classList.add("is-active");
    dom.modeSim.setAttribute("aria-selected", "false");
    dom.modeCamera.setAttribute("aria-selected", "true");
    state.mode = "camera";
    setStatus("live", "Camera live");

    await loadLandmarker();
    camera.running = true;
    camera.history = [];
    state.stableLabel = "UNKNOWN";
    state.firedFor = null;
    state.pinchLogged = false;
    loopFrames();
  } catch (error) {
    failCamera(describeCameraError(error));
  } finally {
    camera.starting = false;
    dom.cameraBtn.disabled = false;
  }
}

function failCamera(message) {
  camera.running = false;
  stopStream();
  state.mode = "idle";
  setStatus("error", "Camera unavailable");
  dom.cameraNote.textContent = message;
  dom.cameraBtn.disabled = false;
  toast(message, "error");
  enterSimulator();
}

function describeCameraError(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission was blocked. Allow it in the address bar, or use the simulator.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found. The simulator works without one.";
  }
  if (name === "NotReadableError") {
    return "The camera is busy in another app. Close it, then retry — or use the simulator.";
  }
  return `Camera could not start: ${error?.message || "unknown error"}. The simulator still works.`;
}

function stopStream() {
  if (camera.stream) {
    for (const track of camera.stream.getTracks()) track.stop();
    camera.stream = null;
  }
  dom.video.srcObject = null;
}

function clearOverlay() {
  const ctx = dom.overlay.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, dom.overlay.width, dom.overlay.height);
}

function stopCamera({ silent = false } = {}) {
  camera.running = false;
  if (camera.loopId) cancelAnimationFrame(camera.loopId);
  camera.loopId = null;
  stopStream();
  clearOverlay();
  dom.viewport.classList.remove("is-live");
  dom.badge.hidden = true;
  if (state.mode === "camera") {
    state.mode = "idle";
    dom.empty.hidden = false;
    dom.cameraNote.textContent = "Requires camera permission · Chrome, Edge, Safari 17+";
    dom.modeCamera.classList.remove("is-active");
    dom.modeCamera.setAttribute("aria-selected", "false");
    setStatus("idle", "Ready");
    dom.fps.textContent = "— fps";
    hidePointer();
    renderGesture("UNKNOWN", 0);
    if (!silent) toast("Camera stopped.");
  }
}

function loopFrames() {
  if (!camera.running) return;

  const tick = () => {
    if (!camera.running) return;
    if (dom.video.readyState >= 2 && dom.video.currentTime !== camera.lastVideoTime) {
      camera.lastVideoTime = dom.video.currentTime;
      analyzeFrame();
    }
    camera.loopId = requestAnimationFrame(tick);
  };
  camera.loopId = requestAnimationFrame(tick);
}

function analyzeFrame() {
  if (!camera.landmarker) return;

  let result;
  try {
    result = camera.landmarker.detectForVideo(dom.video, performance.now());
  } catch (error) {
    console.warn("inference error", error);
    return;
  }

  const now = performance.now();
  if (camera.lastFrameAt) {
    const fps = 1000 / (now - camera.lastFrameAt);
    camera.fpsEma = camera.fpsEma ? camera.fpsEma * 0.85 + fps * 0.15 : fps;
    dom.fps.textContent = `${Math.round(camera.fpsEma)} fps`;
  }
  camera.lastFrameAt = now;

  const hand = result?.landmarks?.[0] || null;
  drawOverlay(hand);

  if (hand) {
    onLandmarks(hand);
  } else {
    camera.history = [];
    state.stableLabel = "UNKNOWN";
    state.firedFor = null;
    if (state.pinchLogged) state.pinchLogged = false;
    hidePointer();
    renderGesture("UNKNOWN", 0);
    dom.volumeSource.hidden = true;
  }
}

function drawOverlay(landmarks) {
  const canvas = dom.overlay;
  const rect = dom.viewport.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) return;

  // The video uses object-fit: cover, so map the source frame onto the same
  // cropped rectangle instead of stretching landmarks across the viewport.
  const vw = dom.video.videoWidth || 4;
  const vh = dom.video.videoHeight || 3;
  const scale = Math.max(canvas.width / vw, canvas.height / vh);
  const drawW = vw * scale;
  const drawH = vh * scale;
  const offsetX = (canvas.width - drawW) / 2;
  const offsetY = (canvas.height - drawH) / 2;

  ctx.save();
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const px = (p) => offsetX + p.x * drawW;
  const py = (p) => offsetY + p.y * drawH;

  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(px(landmarks[a]), py(landmarks[a]));
    ctx.lineTo(px(landmarks[b]), py(landmarks[b]));
    ctx.strokeStyle = "rgba(201, 245, 109, 0.55)";
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
  }

  landmarks.forEach((p, i) => {
    const tip = i === 4 || i === 8;
    ctx.beginPath();
    ctx.arc(px(p), py(p), (tip ? 4.2 : 2.8) * dpr, 0, Math.PI * 2);
    ctx.fillStyle = tip ? "#c9f56d" : "#080a0f";
    ctx.fill();
    ctx.strokeStyle = "rgba(201, 245, 109, 0.9)";
    ctx.lineWidth = 1.4 * dpr;
    ctx.stroke();
  });

  ctx.restore();
}

/* ==========================================================================
   Wiring
   ========================================================================== */

dom.cameraBtn.addEventListener("click", startCamera);
dom.simStart.addEventListener("click", enterSimulator);
dom.modeCamera.addEventListener("click", startCamera);
dom.modeSim.addEventListener("click", enterSimulator);

dom.prev.addEventListener("click", () => prevTrack("control"));
dom.next.addEventListener("click", () => nextTrack("control"));
dom.play.addEventListener("click", () => togglePlay("control"));
dom.mute.addEventListener("click", () => toggleMute("control"));

dom.volume.addEventListener("input", (event) => {
  setVolume(Number(event.target.value));
});
dom.volume.addEventListener("change", () => {
  addLog("Volume", `${state.volume}%`, "control");
});

dom.pinchStrength.addEventListener("input", () => {
  dom.pinchStrengthValue.textContent = `${dom.pinchStrength.value}%`;
  dom.pinchStrength.style.setProperty("--fill", `${dom.pinchStrength.value}%`);
  if (state.mode === "sim" && state.simGesture === "PINCH") {
    setVolume(Number(dom.pinchStrength.value));
  }
});

dom.palette.addEventListener("click", (event) => {
  const chip = event.target.closest(".gesture-chip");
  if (!chip) return;
  setSimGesture(chip.dataset.gesture);
});

dom.pointerPad.addEventListener("pointermove", (event) => {
  if (state.mode !== "sim") return;
  const rect = dom.pointerPad.getBoundingClientRect();
  const active = state.simGesture === "OPEN_PALM";
  showPointer(
    (event.clientX - rect.left) / rect.width,
    (event.clientY - rect.top) / rect.height,
    active
  );
});

dom.clearLog.addEventListener("click", () => {
  state.log = [];
  renderLog();
  toast("Session log cleared.");
});

document.addEventListener("keydown", (event) => {
  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || event.metaKey || event.ctrlKey || event.altKey) return;
  if (tag === "BUTTON" && event.key === " ") return;

  switch (event.key) {
    case "ArrowRight":
      event.preventDefault();
      nextTrack("keyboard");
      break;
    case "ArrowLeft":
      event.preventDefault();
      prevTrack("keyboard");
      break;
    case " ":
      event.preventDefault();
      togglePlay("keyboard");
      break;
    case "m":
    case "M":
      toggleMute("keyboard");
      break;
    case "v":
    case "V":
      if (state.mode === "camera") stopCamera();
      else startCamera();
      break;
    default:
      break;
  }
});

window.addEventListener("beforeunload", stopStream);

/* ------------------------------------------------------------------- boot */

function boot() {
  renderPlayer();
  renderVolume();
  renderLog();
  renderGesture("UNKNOWN", 0);
  drawSyntheticHand("OPEN_PALM");
  setStatus("idle", "Ready");
  dom.visionMeta.textContent = "MediaPipe · 21 landmarks";
  dom.pinchStrength.style.setProperty("--fill", `${dom.pinchStrength.value}%`);
  requestAnimationFrame(pumpFrame);
}

boot();
