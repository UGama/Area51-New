"use strict";

const video = document.querySelector("#video");
const overlay = document.querySelector("#overlay");
const ctx = overlay.getContext("2d");
const stage = document.querySelector("#stage");
const emptyState = document.querySelector("#emptyState");

const countEl = document.querySelector("#count");
const statusEl = document.querySelector("#status");
const statusDot = document.querySelector("#statusDot");
const fpsEl = document.querySelector("#fps");

const startBtn = document.querySelector("#startBtn");
const stopBtn = document.querySelector("#stopBtn");
const switchBtn = document.querySelector("#switchBtn");
const clearZoneBtn = document.querySelector("#clearZoneBtn");
const confidenceInput = document.querySelector("#confidence");
const confidenceValue = document.querySelector("#confidenceValue");
const wholeFrameInput = document.querySelector("#wholeFrame");

const saveReadingBtn = document.querySelector("#saveReadingBtn");
const exportBtn = document.querySelector("#exportBtn");
const clearReadingsBtn = document.querySelector("#clearReadingsBtn");
const readingSummary = document.querySelector("#readingSummary");

let model = null;
let stream = null;
let running = false;
let facingMode = "environment";
let currentCount = 0;
let lastPredictions = [];
let lastInferenceAt = 0;
let inferenceTimer = null;

// Normalized coordinates: x, y, width, height are always 0..1.
let queueZone = null;
let drawingStart = null;
let drawingNow = null;
let zoneDrag = null;

const READING_KEY = "queue-counter-readings-v1";
const MIN_ZONE_SIZE = 0.03;
const HANDLE_RADIUS = 0.06;

function setStatus(message, type = "idle") {
  statusEl.textContent = message;
  statusDot.classList.toggle("live", type === "live");
  statusDot.classList.toggle("error", type === "error");
}

function confidenceThreshold() {
  return Number(confidenceInput.value) / 100;
}

function updateConfidenceLabel() {
  confidenceValue.value = `${confidenceInput.value}%`;
}

function stopTracks() {
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  stream = null;
  video.srcObject = null;
}

function setControls(isRunning) {
  startBtn.disabled = isRunning;
  stopBtn.disabled = !isRunning;
  switchBtn.disabled = !isRunning;
  clearZoneBtn.disabled = !isRunning || !queueZone;
  saveReadingBtn.disabled = !isRunning;
}

function setCameraUiActive(isActive) {
  stage.classList.toggle("camera-off", !isActive);
}

function resizeStageToVideo() {
  if (!video.videoWidth || !video.videoHeight) return;

  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  redraw();
}

async function loadDetector() {
  if (model) return model;

  if (!window.tf || !window.cocoSsd) {
    throw new Error("AI libraries did not load. Check the internet connection and reload.");
  }

  setStatus("Loading person detector…");
  try {
    await tf.setBackend("webgl");
  } catch {
    await tf.setBackend("cpu");
  }
  await tf.ready();

  model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
  return model;
}

async function startCamera() {
  try {
    setStatus("Requesting camera permission…");
    statusDot.classList.remove("error");

    stopTracks();

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    video.srcObject = stream;
    await video.play();

    if (video.readyState < 2) {
      await new Promise((resolve) => {
        video.addEventListener("loadedmetadata", resolve, { once: true });
      });
    }

    resizeStageToVideo();
    emptyState.hidden = true;
    setCameraUiActive(true);

    await loadDetector();

    running = true;
    setControls(true);
    setStatus("Counting people", "live");
    scheduleDetection(0);
  } catch (error) {
    console.error(error);
    running = false;
    stopTracks();
    setControls(false);
    emptyState.hidden = false;
    setCameraUiActive(false);
    setStatus(readableCameraError(error), "error");
  }
}

function readableCameraError(error) {
  if (error?.name === "NotAllowedError") {
    return "Camera permission was denied. Allow camera access in Safari settings.";
  }
  if (error?.name === "NotFoundError") {
    return "No camera was found.";
  }
  if (error?.name === "NotReadableError") {
    return "The camera is being used by another app.";
  }
  return error?.message || "Unable to start the camera.";
}

function stopCamera() {
  running = false;
  clearTimeout(inferenceTimer);
  inferenceTimer = null;
  stopTracks();
  lastPredictions = [];
  currentCount = 0;
  countEl.textContent = "0";
  fpsEl.textContent = "";
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  emptyState.hidden = false;
  setCameraUiActive(false);
  setControls(false);
  setStatus("Camera stopped");
}

function scheduleDetection(delay = 220) {
  clearTimeout(inferenceTimer);
  inferenceTimer = setTimeout(detectFrame, delay);
}

async function detectFrame() {
  if (!running || !model || video.readyState < 2) return;

  try {
    const started = performance.now();
    const predictions = await model.detect(video, 30, confidenceThreshold());
    const elapsed = performance.now() - started;

    lastPredictions = predictions.filter((p) => p.class === "person");
    currentCount = countPeople(lastPredictions);
    countEl.textContent = String(currentCount);
    fpsEl.textContent = `${Math.round(elapsed)} ms`;
    lastInferenceAt = performance.now();
    redraw();
  } catch (error) {
    console.error(error);
    setStatus("Detection paused: " + (error.message || "unknown error"), "error");
  }

  if (running) scheduleDetection(180);
}

function countPeople(predictions) {
  if (wholeFrameInput.checked || !queueZone) return predictions.length;

  return predictions.filter((prediction) => {
    const [x, y, width, height] = prediction.bbox;
    const centerX = (x + width / 2) / overlay.width;
    const centerY = (y + height / 2) / overlay.height;

    return (
      centerX >= queueZone.x &&
      centerX <= queueZone.x + queueZone.width &&
      centerY >= queueZone.y &&
      centerY <= queueZone.y + queueZone.height
    );
  }).length;
}

function redraw() {
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const activeZone = drawingStart && drawingNow
    ? rectFromPoints(drawingStart, drawingNow)
    : queueZone;

  if (activeZone && !wholeFrameInput.checked) {
    drawZone(activeZone);
  }

  for (const prediction of lastPredictions) {
    drawPrediction(prediction);
  }
}

function drawZone(zone) {
  const x = zone.x * overlay.width;
  const y = zone.y * overlay.height;
  const width = zone.width * overlay.width;
  const height = zone.height * overlay.height;
  const handleSize = Math.max(18, overlay.width / 40);

  ctx.save();
  ctx.fillStyle = "rgba(105, 229, 157, 0.12)";
  ctx.strokeStyle = "#69e59d";
  ctx.lineWidth = Math.max(3, overlay.width / 250);
  ctx.setLineDash([14, 10]);
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.setLineDash([]);

  ctx.fillStyle = "#69e59d";
  for (const handle of zoneHandles(zone)) {
    ctx.beginPath();
    ctx.arc(
      handle.x * overlay.width,
      handle.y * overlay.height,
      handleSize / 2,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  const label = "QUEUE ZONE";
  ctx.font = `800 ${Math.max(18, overlay.width / 34)}px system-ui`;
  const labelWidth = ctx.measureText(label).width + 22;
  const labelHeight = Math.max(34, overlay.width / 22);
  ctx.fillStyle = "#69e59d";
  ctx.fillRect(x, Math.max(0, y - labelHeight), labelWidth, labelHeight);
  ctx.fillStyle = "#062116";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 11, Math.max(labelHeight / 2, y - labelHeight / 2));
  ctx.restore();
}

function drawPrediction(prediction) {
  const [x, y, width, height] = prediction.bbox;
  const centerX = (x + width / 2) / overlay.width;
  const centerY = (y + height / 2) / overlay.height;
  const isInside = wholeFrameInput.checked || !queueZone || (
    centerX >= queueZone.x &&
    centerX <= queueZone.x + queueZone.width &&
    centerY >= queueZone.y &&
    centerY <= queueZone.y + queueZone.height
  );

  ctx.save();
  ctx.strokeStyle = isInside ? "#69e59d" : "#ffbe6b";
  ctx.fillStyle = isInside ? "rgba(105, 229, 157, 0.15)" : "rgba(255, 190, 107, 0.10)";
  ctx.lineWidth = Math.max(3, overlay.width / 260);
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);

  const label = `${isInside ? "COUNTED" : "OUTSIDE"} ${Math.round(prediction.score * 100)}%`;
  ctx.font = `800 ${Math.max(16, overlay.width / 42)}px system-ui`;
  const textWidth = ctx.measureText(label).width + 18;
  const textHeight = Math.max(28, overlay.width / 28);
  ctx.fillStyle = isInside ? "#69e59d" : "#ffbe6b";
  ctx.fillRect(x, Math.max(0, y - textHeight), textWidth, textHeight);
  ctx.fillStyle = "#07110d";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 9, Math.max(textHeight / 2, y - textHeight / 2));
  ctx.restore();
}

function normalizedPointer(event) {
  const rect = overlay.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  };
}

function rectFromPoints(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  };
}

function clampZone(zone) {
  const width = Math.min(1, Math.max(MIN_ZONE_SIZE, zone.width));
  const height = Math.min(1, Math.max(MIN_ZONE_SIZE, zone.height));

  return {
    x: Math.min(1 - width, Math.max(0, zone.x)),
    y: Math.min(1 - height, Math.max(0, zone.y)),
    width,
    height
  };
}

function zoneHandles(zone) {
  return [
    { name: "nw", x: zone.x, y: zone.y },
    { name: "ne", x: zone.x + zone.width, y: zone.y },
    { name: "sw", x: zone.x, y: zone.y + zone.height },
    { name: "se", x: zone.x + zone.width, y: zone.y + zone.height }
  ];
}

function pointInZone(point, zone) {
  return (
    point.x >= zone.x &&
    point.x <= zone.x + zone.width &&
    point.y >= zone.y &&
    point.y <= zone.y + zone.height
  );
}

function nearestHandle(point, zone) {
  return zoneHandles(zone).find((handle) => {
    return Math.hypot(point.x - handle.x, point.y - handle.y) <= HANDLE_RADIUS;
  });
}

function zoneFromHandleDrag(handle, fixedCorner, point) {
  if (handle === "nw" || handle === "ne") {
    point.y = Math.min(fixedCorner.y - MIN_ZONE_SIZE, point.y);
  } else {
    point.y = Math.max(fixedCorner.y + MIN_ZONE_SIZE, point.y);
  }

  if (handle === "nw" || handle === "sw") {
    point.x = Math.min(fixedCorner.x - MIN_ZONE_SIZE, point.x);
  } else {
    point.x = Math.max(fixedCorner.x + MIN_ZONE_SIZE, point.x);
  }

  return rectFromPoints(fixedCorner, point);
}

function updateCountFromZone() {
  clearZoneBtn.disabled = !queueZone;
  currentCount = countPeople(lastPredictions);
  countEl.textContent = String(currentCount);
}

overlay.addEventListener("pointerdown", (event) => {
  if (!running || wholeFrameInput.checked) return;
  overlay.setPointerCapture(event.pointerId);
  const point = normalizedPointer(event);
  const handle = queueZone && nearestHandle(point, queueZone);

  if (handle) {
    const fixedCorner = {
      nw: { x: queueZone.x + queueZone.width, y: queueZone.y + queueZone.height },
      ne: { x: queueZone.x, y: queueZone.y + queueZone.height },
      sw: { x: queueZone.x + queueZone.width, y: queueZone.y },
      se: { x: queueZone.x, y: queueZone.y }
    }[handle.name];

    zoneDrag = { mode: "resize", handle: handle.name, fixedCorner };
  } else if (queueZone && pointInZone(point, queueZone)) {
    zoneDrag = {
      mode: "move",
      offsetX: point.x - queueZone.x,
      offsetY: point.y - queueZone.y
    };
  } else {
    drawingStart = point;
    drawingNow = point;
  }

  redraw();
});

overlay.addEventListener("pointermove", (event) => {
  const point = normalizedPointer(event);

  if (zoneDrag?.mode === "move") {
    queueZone = clampZone({
      ...queueZone,
      x: point.x - zoneDrag.offsetX,
      y: point.y - zoneDrag.offsetY
    });
    updateCountFromZone();
  } else if (zoneDrag?.mode === "resize") {
    queueZone = clampZone(zoneFromHandleDrag(zoneDrag.handle, zoneDrag.fixedCorner, point));
    updateCountFromZone();
  } else if (drawingStart) {
    drawingNow = point;
  } else {
    return;
  }

  redraw();
});

function finishDrawing(event) {
  if (zoneDrag) {
    zoneDrag = null;
    updateCountFromZone();
    redraw();
    return;
  }

  if (!drawingStart) return;

  drawingNow = normalizedPointer(event);
  const zone = rectFromPoints(drawingStart, drawingNow);
  drawingStart = null;
  drawingNow = null;

  if (zone.width > MIN_ZONE_SIZE && zone.height > MIN_ZONE_SIZE) {
    queueZone = clampZone(zone);
  }

  updateCountFromZone();
  redraw();
}

overlay.addEventListener("pointerup", finishDrawing);
overlay.addEventListener("pointercancel", () => {
  drawingStart = null;
  drawingNow = null;
  zoneDrag = null;
  redraw();
});

startBtn.addEventListener("click", startCamera);
stopBtn.addEventListener("click", stopCamera);

switchBtn.addEventListener("click", async () => {
  facingMode = facingMode === "environment" ? "user" : "environment";
  running = false;
  clearTimeout(inferenceTimer);
  await startCamera();
});

clearZoneBtn.addEventListener("click", () => {
  queueZone = null;
  clearZoneBtn.disabled = true;
  updateCountFromZone();
  redraw();
});

confidenceInput.addEventListener("input", () => {
  updateConfidenceLabel();
});

wholeFrameInput.addEventListener("change", () => {
  clearZoneBtn.disabled = !running || !queueZone || wholeFrameInput.checked;
  currentCount = countPeople(lastPredictions);
  countEl.textContent = String(currentCount);
  redraw();
});

video.addEventListener("loadedmetadata", resizeStageToVideo);
window.addEventListener("resize", redraw);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running) {
    setStatus("Paused while the app is hidden");
  } else if (!document.hidden && running) {
    setStatus("Counting people", "live");
    scheduleDetection(0);
  }
});

function loadReadings() {
  try {
    return JSON.parse(localStorage.getItem(READING_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveReadings(readings) {
  localStorage.setItem(READING_KEY, JSON.stringify(readings));
  renderReadingSummary();
}

function renderReadingSummary() {
  const readings = loadReadings();
  if (!readings.length) {
    readingSummary.textContent = "No saved readings.";
    return;
  }
  const latest = readings[readings.length - 1];
  readingSummary.textContent =
    `${readings.length} saved reading${readings.length === 1 ? "" : "s"}. ` +
    `Latest: ${latest.count} people at ${new Date(latest.timestamp).toLocaleString()}.`;
}

saveReadingBtn.addEventListener("click", () => {
  const readings = loadReadings();
  readings.push({
    timestamp: new Date().toISOString(),
    count: currentCount,
    confidence: confidenceThreshold(),
    mode: wholeFrameInput.checked ? "whole-frame" : "queue-zone"
  });
  saveReadings(readings);
});

exportBtn.addEventListener("click", () => {
  const readings = loadReadings();
  if (!readings.length) {
    alert("There are no readings to export.");
    return;
  }

  const rows = [
    ["timestamp", "count", "confidence", "mode"],
    ...readings.map((r) => [r.timestamp, r.count, r.confidence, r.mode])
  ];
  const csv = rows
    .map((row) => row.map(csvCell).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `queue-readings-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

clearReadingsBtn.addEventListener("click", () => {
  if (confirm("Delete all saved readings from this device?")) {
    localStorage.removeItem(READING_KEY);
    renderReadingSummary();
  }
});

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}

updateConfidenceLabel();
renderReadingSummary();
setControls(false);
setCameraUiActive(false);
