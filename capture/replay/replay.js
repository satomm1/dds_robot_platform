/**
 * Capture mission replay — vanilla JS client for ingest read APIs.
 * Open /replay/ on the capture host (same origin as /api/v1/).
 */

(function () {
  "use strict";

  const GRID_CELL_SIZE = 5;
  const IMAGE_EPS_MS = 1000;
  /** Break trail when consecutive poses are farther apart than this (ms). */
  const POSE_TRAIL_GAP_MS = 5000;
  const API_KEY_STORAGE = "capture_api_key";
  const CLASS_COLORS = {
    person: "#2563eb",
    cone: "#ea580c",
    unknown: "#6b7280",
  };
  const ROBOT_PALETTE = [
    { trail: "rgba(37, 99, 235, 0.75)", robot: "#2563eb", heading: "#1e3a8a" },
    { trail: "rgba(220, 38, 38, 0.75)", robot: "#dc2626", heading: "#7f1d1d" },
    { trail: "rgba(22, 163, 74, 0.75)", robot: "#16a34a", heading: "#14532d" },
    { trail: "rgba(234, 88, 12, 0.75)", robot: "#ea580c", heading: "#7c2d12" },
    { trail: "rgba(147, 51, 234, 0.75)", robot: "#9333ea", heading: "#581c87" },
    { trail: "rgba(8, 145, 178, 0.75)", robot: "#0891b2", heading: "#164e63" },
    { trail: "rgba(202, 138, 4, 0.75)", robot: "#ca8a04", heading: "#713f12" },
    { trail: "rgba(219, 39, 119, 0.75)", robot: "#db2777", heading: "#831843" },
  ];

  // --- DOM ---
  const cameraRobotSelect = document.getElementById("camera-robot-select");
  const fromInput = document.getElementById("from-input");
  const toInput = document.getElementById("to-input");
  const apiKeyInput = document.getElementById("api-key-input");
  const mapFileInput = document.getElementById("map-file-input");
  const loadBtn = document.getElementById("load-btn");
  const statusMsg = document.getElementById("status-msg");
  const mapCanvas = document.getElementById("map-canvas");
  const mapHint = document.getElementById("map-hint");
  const evidencePanel = document.getElementById("evidence-panel");
  const evidencePlaceholder = document.getElementById("evidence-placeholder");
  const evidenceContent = document.getElementById("evidence-content");
  const evidenceMeta = document.getElementById("evidence-meta");
  const evidenceImg = document.getElementById("evidence-img");
  const depthCanvas = document.getElementById("depth-canvas");
  const bboxCanvas = document.getElementById("bbox-canvas");
  const detectionList = document.getElementById("detection-list");
  const scrubber = document.getElementById("scrubber");
  const scrubTimeLabel = document.getElementById("scrub-time-label");
  const eventMarkers = document.getElementById("event-markers");
  const playBtn = document.getElementById("play-btn");
  const playFastBtn = document.getElementById("play-fast-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const prevSkipEventBtn = document.getElementById("prev-skip-event-btn");
  const prevStepBtn = document.getElementById("prev-step-btn");
  const nextStepBtn = document.getElementById("next-step-btn");
  const nextSkipEventBtn = document.getElementById("next-skip-event-btn");
  const zoomInBtn = document.getElementById("zoom-in-btn");
  const zoomOutBtn = document.getElementById("zoom-out-btn");
  const zoomResetBtn = document.getElementById("zoom-reset-btn");
  const zoomLevelLabel = document.getElementById("zoom-level-label");
  const mapSection = document.querySelector(".map-section");

  const mapCtx = mapCanvas.getContext("2d");
  const depthCtx = depthCanvas.getContext("2d");
  const bboxCtx = bboxCanvas.getContext("2d");

  // --- State ---
  let mapData = null;
  let mapImageCanvas = null;
  let autoBounds = null;

  let windowFromMs = 0;
  let windowToMs = 0;
  let scrubMs = 0;

  let robots = [];
  /** @type {Record<string, { poses: object[], snapshots: object[], events: object[] }>} */
  let robotReplay = {};
  let cameraRobotId = null;

  let activeTab = "rgb";
  let activeEvent = null;
  let imageObjectUrl = null;

  let playback = { active: false, speed: 1, lastTs: 0, rafId: null };

  const MIN_VIEW_ZOOM = 0.15;
  const MAX_VIEW_ZOOM = 8;
  const ZOOM_WHEEL_FACTOR = 1.12;
  const ZOOM_BUTTON_FACTOR = 1.35;

  let fitScale = 1;
  let viewZoom = 1;
  let panX = 0;
  let panY = 0;
  let panDrag = null;

  let mapPixelWidth = 800;
  let mapPixelHeight = 600;

  // --- API ---
  function apiHeaders() {
    const headers = {};
    const key = localStorage.getItem(API_KEY_STORAGE);
    if (key) headers["X-Api-Key"] = key;
    return headers;
  }

  async function apiFetch(path) {
    const r = await fetch("/api/v1" + path, { headers: apiHeaders() });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(text || r.statusText);
    }
    return r.json();
  }

  async function loadAuthImageBlob(storagePath) {
    const r = await fetch("/api/v1/files/" + storagePath, { headers: apiHeaders() });
    if (r.status === 425) {
      const err = new Error("anonymizing");
      err.code = 425;
      throw err;
    }
    if (r.status === 424) {
      const err = new Error("anonymization failed");
      err.code = 424;
      throw err;
    }
    if (!r.ok) throw new Error("Failed to load image");
    return r.blob();
  }

  async function loadAuthImageBuffer(storagePath) {
    const r = await fetch("/api/v1/files/" + storagePath, { headers: apiHeaders() });
    if (r.status === 425) {
      const err = new Error("anonymizing");
      err.code = 425;
      throw err;
    }
    if (r.status === 424) {
      const err = new Error("anonymization failed");
      err.code = 424;
      throw err;
    }
    if (!r.ok) throw new Error("Failed to load image");
    return r.arrayBuffer();
  }

  function readU32BE(view, offset) {
    return (
      (view[offset] << 24) |
      (view[offset + 1] << 16) |
      (view[offset + 2] << 8) |
      view[offset + 3]
    );
  }

  function paethPredictor(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  function unfilterPngRows(data, width, height, bpp) {
    const rowBytes = width * bpp;
    const out = new Uint8Array(height * rowBytes);
    let src = 0;
    for (let y = 0; y < height; y++) {
      const filter = data[src++];
      const row = data.subarray(src, src + rowBytes);
      src += rowBytes;
      const prev = y > 0 ? out.subarray((y - 1) * rowBytes, y * rowBytes) : null;
      const dst = out.subarray(y * rowBytes, (y + 1) * rowBytes);
      for (let i = 0; i < rowBytes; i++) {
        const left = i >= bpp ? dst[i - bpp] : 0;
        const up = prev ? prev[i] : 0;
        const upLeft = prev && i >= bpp ? prev[i - bpp] : 0;
        let value;
        switch (filter) {
          case 0:
            value = row[i];
            break;
          case 1:
            value = (row[i] + left) & 0xff;
            break;
          case 2:
            value = (row[i] + up) & 0xff;
            break;
          case 3:
            value = (row[i] + Math.floor((left + up) / 2)) & 0xff;
            break;
          case 4:
            value = (row[i] + paethPredictor(left, up, upLeft)) & 0xff;
            break;
          default:
            throw new Error("unsupported PNG filter " + filter);
        }
        dst[i] = value;
      }
    }
    return out;
  }

  async function inflatePngIdat(idatBytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("Depth preview requires DecompressionStream (modern browser)");
    }
    const attempts = [
      {
        bytes: idatBytes,
        format: "deflate",
      },
      {
        bytes: idatBytes.subarray(2, idatBytes.length - 4),
        format: "deflate-raw",
      },
    ];
    let lastErr = null;
    for (const attempt of attempts) {
      try {
        const stream = new Blob([attempt.bytes])
          .stream()
          .pipeThrough(new DecompressionStream(attempt.format));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("failed to inflate depth PNG");
  }

  async function decodeGrayscalePng(buffer) {
    const bytes = new Uint8Array(buffer);
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < sig.length; i++) {
      if (bytes[i] !== sig[i]) throw new Error("not a PNG file");
    }

    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = -1;
    const idatParts = [];
    let offset = 8;
    while (offset + 8 <= bytes.length) {
      const length = readU32BE(bytes, offset);
      const type = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7]
      );
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      const chunk = bytes.subarray(dataStart, dataEnd);
      if (type === "IHDR") {
        width = readU32BE(chunk, 0);
        height = readU32BE(chunk, 4);
        bitDepth = chunk[8];
        colorType = chunk[9];
      } else if (type === "IDAT") {
        idatParts.push(chunk);
      } else if (type === "IEND") {
        break;
      }
      offset = dataEnd + 4;
    }

    if (!width || !height) throw new Error("PNG missing IHDR");
    if (colorType !== 0) throw new Error("depth PNG must be grayscale");
    if (bitDepth !== 8 && bitDepth !== 16) {
      throw new Error("depth PNG must be 8- or 16-bit grayscale");
    }

    const zlib = new Uint8Array(idatParts.reduce((n, part) => n + part.length, 0));
    let pos = 0;
    for (const part of idatParts) {
      zlib.set(part, pos);
      pos += part.length;
    }
    const inflated = await inflatePngIdat(zlib);
    const bpp = bitDepth === 16 ? 2 : 1;
    const expectedInflated = height * (1 + width * bpp);
    if (inflated.length !== expectedInflated) {
      throw new Error(
        "depth PNG inflate size mismatch (" + inflated.length + " vs " + expectedInflated + ")"
      );
    }
    const filtered = unfilterPngRows(inflated, width, height, bpp);
    const mm = new Uint16Array(width * height);
    if (bitDepth === 16) {
      for (let i = 0; i < mm.length; i++) {
        mm[i] = (filtered[i * 2] << 8) | filtered[i * 2 + 1];
      }
    } else {
      for (let i = 0; i < mm.length; i++) {
        mm[i] = filtered[i];
      }
    }
    return { width, height, mm };
  }

  function depthMmStats(mm) {
    let min = Infinity;
    let max = -Infinity;
    let valid = 0;
    for (const v of mm) {
      if (!v) continue;
      valid++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { min, max, valid };
  }

  function depthMmToImageData(mm, width, height) {
    const stats = depthMmStats(mm);
    let min = stats.min;
    let max = stats.max;
    if (!Number.isFinite(min)) {
      min = 0;
      max = 1;
    }
    const span = Math.max(max - min, 1);
    const out = new ImageData(width, height);
    for (let i = 0; i < mm.length; i++) {
      const v = mm[i];
      const o = i * 4;
      if (!v) {
        out.data[o] = 20;
        out.data[o + 1] = 20;
        out.data[o + 2] = 30;
        out.data[o + 3] = 255;
        continue;
      }
      const t = (v - min) / span;
      const hue = 220 - t * 220;
      const rgb = hslToRgb(hue, 85, 35 + t * 40);
      out.data[o] = rgb[0];
      out.data[o + 1] = rgb[1];
      out.data[o + 2] = rgb[2];
      out.data[o + 3] = 255;
    }
    return out;
  }

  function hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255),
    ];
  }

  async function renderDepthPreview(storagePath) {
    const buffer = await loadAuthImageBuffer(storagePath);
    const { width, height, mm } = await decodeGrayscalePng(buffer);
    const stats = depthMmStats(mm);
    depthCanvas.width = width;
    depthCanvas.height = height;
    depthCanvas.style.aspectRatio = width + " / " + height;
    depthCtx.putImageData(depthMmToImageData(mm, width, height), 0, 0);
    return { width, height, stats };
  }

  function frameForTab(ev, tab) {
    if (tab === "ir") return ev.ir;
    if (tab === "depth") return ev.depth;
    return ev.rgb;
  }

  function hasFrameForTab(ev, tab) {
    const frame = frameForTab(ev, tab);
    return !!frame?.storage_path;
  }

  function setEvidenceViewMode(mode) {
    const isDepth = mode === "depth";
    evidenceImg.classList.toggle("hidden", isDepth);
    depthCanvas.classList.toggle("hidden", !isDepth);
    bboxCanvas.classList.toggle("hidden", isDepth);
  }

  function setStatus(msg, isError) {
    statusMsg.textContent = msg || "";
    statusMsg.classList.toggle("error", !!isError);
  }

  function robotLabel(robotId) {
    const r = robots.find((x) => String(x.id) === String(robotId));
    if (!r) return "Robot " + robotId;
    return "Robot " + r.id + (r.name ? " (" + r.name + ")" : "");
  }

  /** Short label for map markers: name if set, otherwise Robot {id}. */
  function robotMapLabel(robotId) {
    const r = robots.find((x) => String(x.id) === String(robotId));
    if (r?.name) return r.name;
    return "Robot " + robotId;
  }

  function drawRobotMapLabel(rx, ry, robotId, colors) {
    const text = robotMapLabel(robotId);
    mapCtx.font = "bold 11px system-ui, sans-serif";
    const padX = 5;
    const padY = 3;
    const textW = mapCtx.measureText(text).width;
    const boxW = textW + padX * 2;
    const boxH = 14 + padY * 2;
    const x = rx + 12;
    const y = ry - boxH / 2;

    mapCtx.fillStyle = "rgba(255, 255, 255, 0.94)";
    mapCtx.strokeStyle = colors.robot;
    mapCtx.lineWidth = 1.5;
    mapCtx.beginPath();
    mapCtx.roundRect(x, y, boxW, boxH, 3);
    mapCtx.fill();
    mapCtx.stroke();

    mapCtx.fillStyle = "#0f172a";
    mapCtx.textBaseline = "middle";
    mapCtx.fillText(text, x + padX, y + boxH / 2);
    mapCtx.textBaseline = "alphabetic";
  }

  function robotPaletteIndex(robotId) {
    const idx = robots.findIndex((r) => String(r.id) === String(robotId));
    return idx >= 0 ? idx : Number(robotId) || 0;
  }

  function robotColors(robotId) {
    return ROBOT_PALETTE[robotPaletteIndex(robotId) % ROBOT_PALETTE.length];
  }

  function getRobotReplay(robotId) {
    return robotReplay[String(robotId)] || { poses: [], snapshots: [], events: [] };
  }

  function allPosesFlat() {
    const out = [];
    for (const r of robots) {
      out.push(...getRobotReplay(r.id).poses);
    }
    return out;
  }

  function allEventsFlat() {
    const out = [];
    for (const r of robots) {
      out.push(...getRobotReplay(r.id).events);
    }
    return out;
  }

  function hasReplayData() {
    return allPosesFlat().length > 0 || allEventsFlat().length > 0;
  }

  function updateCameraRobotSelect() {
    const prev = cameraRobotId != null ? String(cameraRobotId) : "";
    cameraRobotSelect.innerHTML = "";
    for (const r of robots) {
      const opt = document.createElement("option");
      opt.value = String(r.id);
      opt.textContent = robotLabel(r.id);
      cameraRobotSelect.appendChild(opt);
    }
    if (robots.length) {
      const keep = prev && robots.some((r) => String(r.id) === prev);
      cameraRobotId = keep ? Number(prev) : robots[0].id;
      cameraRobotSelect.value = String(cameraRobotId);
      cameraRobotSelect.disabled = false;
    } else {
      cameraRobotId = null;
      cameraRobotSelect.disabled = true;
    }
  }

  // --- Time helpers ---
  function localDatetimeToIso(value) {
    if (!value) return null;
    return new Date(value).toISOString();
  }

  function parseMs(iso) {
    return new Date(iso).getTime();
  }

  function formatScrubTime(ms) {
    if (!Number.isFinite(ms)) return "—";
    return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  }

  function defaultWindowInputs() {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 3600 * 1000);
    toInput.value = toLocalDatetimeInput(now);
    fromInput.value = toLocalDatetimeInput(hourAgo);
  }

  function toLocalDatetimeInput(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  }

  /** Binary search: nearest row by wall_time (ISO string) to targetMs. */
  function nearestByTime(rows, targetMs) {
    if (!rows.length) return null;
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (parseMs(rows[mid].wall_time) < targetMs) lo = mid + 1;
      else hi = mid;
    }
    const idx = lo;
    const candidates = [];
    if (idx > 0) candidates.push(rows[idx - 1]);
    candidates.push(rows[idx]);
    if (idx < rows.length - 1) candidates.push(rows[idx + 1]);
    let best = candidates[0];
    let bestDiff = Math.abs(parseMs(best.wall_time) - targetMs);
    for (const c of candidates) {
      const diff = Math.abs(parseMs(c.wall_time) - targetMs);
      if (diff < bestDiff) {
        best = c;
        bestDiff = diff;
      }
    }
    return best;
  }

  function findActiveEvent(targetMs, robotId) {
    const events = getRobotReplay(robotId).events;
    let best = null;
    let bestDiff = IMAGE_EPS_MS + 1;
    for (const ev of events) {
      const diff = Math.abs(parseMs(ev.wall_time) - targetMs);
      if (diff <= IMAGE_EPS_MS && diff < bestDiff) {
        best = ev;
        bestDiff = diff;
      }
    }
    return best;
  }

  function findActiveEventAny(targetMs) {
    let best = null;
    let bestDiff = IMAGE_EPS_MS + 1;
    for (const ev of allEventsFlat()) {
      const diff = Math.abs(parseMs(ev.wall_time) - targetMs);
      if (diff <= IMAGE_EPS_MS && diff < bestDiff) {
        best = ev;
        bestDiff = diff;
      }
    }
    return best;
  }

  function sortedEvents() {
    return [...allEventsFlat()].sort(
      (a, b) => parseMs(a.wall_time) - parseMs(b.wall_time)
    );
  }

  /** Capture sessions in timeline order; each session has one or more frame events (◇). */
  function eventsBySession() {
    const sorted = sortedEvents();
    const order = [];
    const byId = new Map();
    for (const ev of sorted) {
      if (!byId.has(ev.session_id)) {
        byId.set(ev.session_id, []);
        order.push(ev.session_id);
      }
      byId.get(ev.session_id).push(ev);
    }
    return order.map((sessionId) => ({ sessionId, events: byId.get(sessionId) }));
  }

  function sessionIndexForScrub(groups) {
    const active = findActiveEventAny(scrubMs);
    if (active) {
      const idx = groups.findIndex((g) => g.sessionId === active.session_id);
      if (idx >= 0) return idx;
    }
    for (let i = groups.length - 1; i >= 0; i--) {
      if (parseMs(groups[i].events[0].wall_time) <= scrubMs) return i;
    }
    return 0;
  }

  function eventsInSession(sessionId) {
    return sortedEvents().filter((ev) => ev.session_id === sessionId);
  }

  // --- Map file & coordinates ---
  function parseMapFile(json) {
    const map = json.data?.map || json.map;
    if (!map || !map.width || !map.height || !map.resolution || !map.occupancy) {
      throw new Error("Expected data.map with width, height, resolution, occupancy");
    }
    if (map.occupancy.length !== map.width * map.height) {
      throw new Error("occupancy length does not match width × height");
    }
    return map;
  }

  function prerenderOccupancy(map) {
    const w = map.width * GRID_CELL_SIZE;
    const h = map.height * GRID_CELL_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#E4F8FF";
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < map.width; x++) {
      for (let y = 0; y < map.height; y++) {
        const value = map.occupancy[y * map.width + x];
        if (value === 0) continue;
        let color;
        if (value === 100) color = "#000000";
        else color = "#A8A8A8";
        const xPos = (map.width - x - 1) * GRID_CELL_SIZE;
        const yPos = y * GRID_CELL_SIZE;
        ctx.fillStyle = color;
        ctx.fillRect(xPos, yPos, GRID_CELL_SIZE, GRID_CELL_SIZE);
      }
    }
    return canvas;
  }

  /** Map-frame meters → map pixel coords (matches RobotMap). */
  function worldToMapPixels(x, y, map) {
    const px = (map.width - x / map.resolution) * GRID_CELL_SIZE;
    const py = (y * GRID_CELL_SIZE) / map.resolution;
    return [px, py];
  }

  function computeAutoBounds(poseList) {
    const valid = poseList.filter((p) => p.valid && p.x != null && p.y != null);
    if (!valid.length) return null;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of valid) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const pad = 1;
    return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
  }

  function resetMapView() {
    viewZoom = 1;
    panX = 0;
    panY = 0;
    updateZoomLabel();
  }

  function updateZoomLabel() {
    if (zoomLevelLabel) zoomLevelLabel.textContent = Math.round(viewZoom * 100) + "%";
  }

  /** Screen point to zoom toward: selected camera robot, map center, or canvas center. */
  function getZoomAnchor() {
    if (cameraRobotId != null) {
      const pose = nearestByTime(getRobotReplay(cameraRobotId).poses, scrubMs);
      if (pose?.valid && pose.x != null && pose.y != null) {
        return worldToDisplay(pose.x, pose.y);
      }
    }

    const t = getMapViewTransform();
    if (t.mode === "map") {
      return [
        t.offsetX + (mapPixelWidth * t.scale) / 2,
        t.offsetY + (mapPixelHeight * t.scale) / 2,
      ];
    }
    if (t.mode === "auto" && autoBounds) {
      const cx = (autoBounds.minX + autoBounds.maxX) / 2;
      const cy = (autoBounds.minY + autoBounds.maxY) / 2;
      return worldToDisplay(cx, cy);
    }
    return [mapCanvas.width / 2, mapCanvas.height / 2];
  }

  function drawEmptyGrid() {
    const t = getMapViewTransform();
    const step = 40 * t.scale;
    if (step < 8) return;
    mapCtx.save();
    mapCtx.strokeStyle = "rgba(148, 163, 184, 0.45)";
    mapCtx.lineWidth = 1;
    const startX = ((t.offsetX % step) + step) % step;
    const startY = ((t.offsetY % step) + step) % step;
    for (let x = startX; x < mapCanvas.width; x += step) {
      mapCtx.beginPath();
      mapCtx.moveTo(x, 0);
      mapCtx.lineTo(x, mapCanvas.height);
      mapCtx.stroke();
    }
    for (let y = startY; y < mapCanvas.height; y += step) {
      mapCtx.beginPath();
      mapCtx.moveTo(0, y);
      mapCtx.lineTo(mapCanvas.width, y);
      mapCtx.stroke();
    }
    mapCtx.restore();
  }

  function clampViewZoom(z) {
    return Math.min(MAX_VIEW_ZOOM, Math.max(MIN_VIEW_ZOOM, z));
  }

  /** Screen transform for map-image or auto-bounds modes. */
  function getMapViewTransform() {
    const cw = mapCanvas.width;
    const ch = mapCanvas.height;

    if (mapData && mapImageCanvas) {
      const scale = fitScale * viewZoom;
      return {
        mode: "map",
        scale,
        offsetX: (cw - mapPixelWidth * scale) / 2 + panX,
        offsetY: (ch - mapPixelHeight * scale) / 2 + panY,
      };
    }

    if (autoBounds) {
      const margin = 40;
      const bw = autoBounds.maxX - autoBounds.minX || 1;
      const bh = autoBounds.maxY - autoBounds.minY || 1;
      const baseScale = Math.min((cw - margin * 2) / bw, (ch - margin * 2) / bh);
      const scale = baseScale * viewZoom;
      const contentW = bw * baseScale;
      const contentH = bh * baseScale;
      return {
        mode: "auto",
        scale,
        offsetX: (cw - contentW * viewZoom) / 2 + panX,
        offsetY: (ch - contentH * viewZoom) / 2 + panY,
      };
    }

    const scale = viewZoom;
    return {
      mode: "empty",
      scale,
      offsetX: (cw - cw * viewZoom) / 2 + panX,
      offsetY: (ch - ch * viewZoom) / 2 + panY,
    };
  }

  function worldToDisplay(x, y) {
    const t = getMapViewTransform();
    if (t.mode === "map") {
      const [px, py] = worldToMapPixels(x, y, mapData);
      return [px * t.scale + t.offsetX, py * t.scale + t.offsetY];
    }
    if (t.mode === "auto") {
      return [
        t.offsetX + (x - autoBounds.minX) * t.scale,
        t.offsetY + (autoBounds.maxY - y) * t.scale,
      ];
    }
    return [t.offsetX, t.offsetY];
  }

  /** Inverse of map-pixel coords (map-image mode only). */
  function screenToMapPixels(mx, my) {
    const t = getMapViewTransform();
    return [(mx - t.offsetX) / t.scale, (my - t.offsetY) / t.scale];
  }

  function zoomAtPoint(mx, my, factor) {
    const t = getMapViewTransform();
    if (t.mode === "map") {
      const [mapPx, mapPy] = screenToMapPixels(mx, my);
      viewZoom = clampViewZoom(viewZoom * factor);
      const scale = fitScale * viewZoom;
      const cw = mapCanvas.width;
      const ch = mapCanvas.height;
      panX = mx - mapPx * scale - (cw - mapPixelWidth * scale) / 2;
      panY = my - mapPy * scale - (ch - mapPixelHeight * scale) / 2;
    } else if (t.mode === "auto") {
      const wx = (mx - t.offsetX) / t.scale + autoBounds.minX;
      const wy = autoBounds.maxY - (my - t.offsetY) / t.scale;
      viewZoom = clampViewZoom(viewZoom * factor);
      const cw = mapCanvas.width;
      const ch = mapCanvas.height;
      const margin = 40;
      const bw = autoBounds.maxX - autoBounds.minX || 1;
      const bh = autoBounds.maxY - autoBounds.minY || 1;
      const baseScale = Math.min((cw - margin * 2) / bw, (ch - margin * 2) / bh);
      const contentW = bw * baseScale;
      const contentH = bh * baseScale;
      const scale = baseScale * viewZoom;
      panX = mx - (wx - autoBounds.minX) * scale - (cw - contentW * viewZoom) / 2;
      panY = my - (autoBounds.maxY - wy) * scale - (ch - contentH * viewZoom) / 2;
    } else {
      const cx = (mx - t.offsetX) / t.scale;
      const cy = (my - t.offsetY) / t.scale;
      viewZoom = clampViewZoom(viewZoom * factor);
      const cw = mapCanvas.width;
      const ch = mapCanvas.height;
      const scale = viewZoom;
      panX = mx - cx * scale - (cw - cw * viewZoom) / 2;
      panY = my - cy * scale - (ch - ch * viewZoom) / 2;
    }
    updateZoomLabel();
    paintMap();
  }

  function updateMapLayout() {
    const section = mapCanvas.parentElement;
    const cw = Math.max(section.clientWidth, 320);
    const ch = Math.max(section.clientHeight, 360);

    if (mapImageCanvas) {
      mapPixelWidth = mapImageCanvas.width;
      mapPixelHeight = mapImageCanvas.height;
      fitScale = Math.min(cw / mapPixelWidth, ch / mapPixelHeight);
    } else if (autoBounds) {
      const margin = 40;
      const bw = autoBounds.maxX - autoBounds.minX || 1;
      const bh = autoBounds.maxY - autoBounds.minY || 1;
      mapPixelWidth = cw;
      mapPixelHeight = ch;
      fitScale = Math.min((cw - margin * 2) / bw, (ch - margin * 2) / bh);
    } else {
      mapPixelWidth = cw;
      mapPixelHeight = ch;
      fitScale = 1;
    }

    mapCanvas.width = cw;
    mapCanvas.height = ch;
    mapHint.classList.toggle("hidden", !!(mapData || hasReplayData()));
  }

  function splitTrailSegments(trail) {
    if (!trail.length) return [];
    const segments = [[trail[0]]];
    for (let i = 1; i < trail.length; i++) {
      const gap = parseMs(trail[i].wall_time) - parseMs(trail[i - 1].wall_time);
      if (gap > POSE_TRAIL_GAP_MS) {
        segments.push([trail[i]]);
      } else {
        segments[segments.length - 1].push(trail[i]);
      }
    }
    return segments.filter((segment) => segment.length >= 2);
  }

  function drawTrailSegments(trail, colors) {
    for (const segment of splitTrailSegments(trail)) {
      mapCtx.beginPath();
      const [x0, y0] = worldToDisplay(segment[0].x, segment[0].y);
      mapCtx.moveTo(x0, y0);
      for (let i = 1; i < segment.length; i++) {
        const [x, y] = worldToDisplay(segment[i].x, segment[i].y);
        mapCtx.lineTo(x, y);
      }
      mapCtx.strokeStyle = colors.trail;
      mapCtx.lineWidth = 2;
      mapCtx.stroke();
    }
  }

  function paintRobotOnMap(robotId) {
    const { poses, snapshots } = getRobotReplay(robotId);
    const colors = robotColors(robotId);

    const trail = poses.filter((p) => {
      const t = parseMs(p.wall_time);
      return t <= scrubMs && p.valid && p.x != null && p.y != null;
    });
    drawTrailSegments(trail, colors);

    const pose = nearestByTime(poses, scrubMs);
    if (pose && pose.valid && pose.x != null && pose.y != null) {
      const [rx, ry] = worldToDisplay(pose.x, pose.y);
      mapCtx.fillStyle = colors.robot;
      mapCtx.beginPath();
      mapCtx.arc(rx, ry, 8, 0, Math.PI * 2);
      mapCtx.fill();
      if (pose.theta != null) {
        const len = 20;
        mapCtx.strokeStyle = colors.heading;
        mapCtx.lineWidth = 2;
        mapCtx.beginPath();
        mapCtx.moveTo(rx, ry);
        // Match live GUI RobotMap heading (map Y inverted vs robot frame).
        mapCtx.lineTo(rx - len * Math.cos(pose.theta), ry + len * Math.sin(pose.theta));
        mapCtx.stroke();
      }
      drawRobotMapLabel(rx, ry, robotId, colors);
    }

    const snap = nearestByTime(snapshots, scrubMs);
    if (snap && snap.objects && snap.objects.length) {
      for (const obj of snap.objects) {
        const poseObj = obj.pose;
        if (!poseObj || poseObj.x == null || poseObj.y == null) continue;
        const [ox, oy] = worldToDisplay(poseObj.x, poseObj.y);
        const color = CLASS_COLORS[obj.class_name] || CLASS_COLORS.unknown;
        mapCtx.fillStyle = color;
        mapCtx.beginPath();
        mapCtx.arc(ox, oy, 5, 0, Math.PI * 2);
        mapCtx.fill();
        if (obj.class_name) {
          mapCtx.fillStyle = "#0f172a";
          mapCtx.font = "10px sans-serif";
          mapCtx.fillText(obj.class_name, ox + 7, oy - 3);
        }
      }
    }
  }

  function paintMap() {
    mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    const t = getMapViewTransform();

    if (mapImageCanvas && t.mode === "map") {
      mapCtx.drawImage(
        mapImageCanvas,
        t.offsetX,
        t.offsetY,
        mapImageCanvas.width * t.scale,
        mapImageCanvas.height * t.scale
      );
    } else {
      mapCtx.fillStyle = "#e4f8ff";
      mapCtx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
      if (t.mode === "empty") drawEmptyGrid();
    }

    if (!hasReplayData() && !windowFromMs) return;

    for (const r of robots) {
      paintRobotOnMap(r.id);
    }
  }

  function renderMap() {
    updateMapLayout();
    paintMap();
  }

  function onScrub() {
    paintMap();
    updateEvidence();
  }

  function syncScrubberFromMs() {
    const span = windowToMs - windowFromMs;
    if (span <= 0) {
      scrubber.value = 0;
      return;
    }
    scrubber.value = Math.round(((scrubMs - windowFromMs) / span) * 1000);
    scrubTimeLabel.textContent = formatScrubTime(scrubMs);
  }

  function scrubMsFromSlider() {
    const span = windowToMs - windowFromMs;
    scrubMs = windowFromMs + (Number(scrubber.value) / 1000) * span;
  }

  function renderEventMarkers() {
    eventMarkers.innerHTML = "";
    const span = windowToMs - windowFromMs;
    if (span <= 0) return;
    for (const ev of allEventsFlat()) {
      const t = parseMs(ev.wall_time);
      const pct = ((t - windowFromMs) / span) * 100;
      if (pct < 0 || pct > 100) continue;
      const el = document.createElement("div");
      el.className = "event-marker";
      el.style.left = pct + "%";
      const rid = ev.robot_id != null ? ev.robot_id : "?";
      el.title = "Robot " + rid + " · " + ev.trigger + " @ " + ev.wall_time;
      el.addEventListener("click", () => jumpToEvent(ev));
      eventMarkers.appendChild(el);
    }
  }

  function jumpToEvent(ev) {
    scrubMs = parseMs(ev.wall_time);
    if (ev.robot_id != null) {
      cameraRobotId = ev.robot_id;
      cameraRobotSelect.value = String(cameraRobotId);
    }
    syncScrubberFromMs();
    onScrub();
  }

  function updateEventSkipButtons() {
    const hasEvents = allEventsFlat().length > 0;
    prevSkipEventBtn.disabled = !hasEvents;
    prevStepBtn.disabled = !hasEvents;
    nextStepBtn.disabled = !hasEvents;
    nextSkipEventBtn.disabled = !hasEvents;
  }

  /** Double arrow: jump to the next/previous capture session. */
  function skipCaptureEvent(direction) {
    const groups = eventsBySession();
    if (!groups.length) return;

    const idx = sessionIndexForScrub(groups);
    const targetIdx = idx + direction;
    if (targetIdx < 0) {
      jumpToEvent(groups[0].events[0]);
      return;
    }
    if (targetIdx >= groups.length) {
      const last = groups[groups.length - 1].events;
      jumpToEvent(last[last.length - 1]);
      return;
    }
    jumpToEvent(groups[targetIdx].events[0]);
  }

  /**
   * Single arrow: move to the previous/next frame (◇) in the current session.
   * At the first/last frame of a session, jump to the adjacent session.
   */
  function stepTimeline(direction) {
    const groups = eventsBySession();
    if (!groups.length) return;

    const active = findActiveEventAny(scrubMs);
    const sessionId = active?.session_id ?? groups[sessionIndexForScrub(groups)].sessionId;
    const inSession = eventsInSession(sessionId);
    if (!inSession.length) return;

    if (direction > 0) {
      const threshold = active ? parseMs(active.wall_time) : scrubMs;
      const next = inSession.find((ev) => parseMs(ev.wall_time) > threshold + IMAGE_EPS_MS);
      if (next) {
        jumpToEvent(next);
        return;
      }
      skipCaptureEvent(1);
      return;
    }

    const threshold = active ? parseMs(active.wall_time) : scrubMs;
    let prev = null;
    for (let i = inSession.length - 1; i >= 0; i--) {
      if (parseMs(inSession[i].wall_time) < threshold - IMAGE_EPS_MS) {
        prev = inSession[i];
        break;
      }
    }
    if (prev) {
      jumpToEvent(prev);
      return;
    }

    const idx = groups.findIndex((g) => g.sessionId === sessionId);
    if (idx > 0) {
      const prevSession = groups[idx - 1].events;
      jumpToEvent(prevSession[prevSession.length - 1]);
      return;
    }
    jumpToEvent(inSession[0]);
  }

  // --- Evidence panel ---
  function revokeImageUrl() {
    if (imageObjectUrl) {
      URL.revokeObjectURL(imageObjectUrl);
      imageObjectUrl = null;
    }
  }

  function drawBboxes(frame) {
    const img = evidenceImg;
    const rect = img.getBoundingClientRect();
    bboxCanvas.width = rect.width;
    bboxCanvas.height = rect.height;
    bboxCtx.clearRect(0, 0, bboxCanvas.width, bboxCanvas.height);
    if (!img.naturalWidth || !frame?.detections?.length) return;
    const sx = rect.width / img.naturalWidth;
    const sy = rect.height / img.naturalHeight;
    bboxCtx.strokeStyle = "#22c55e";
    bboxCtx.lineWidth = 2;
    for (const det of frame.detections) {
      const b = det.bbox;
      if (!b || b.length < 4) continue;
      const [x1, y1, x2, y2] = b;
      bboxCtx.strokeRect(x1 * sx, y1 * sy, (x2 - x1) * sx, (y2 - y1) * sy);
    }
  }

  async function showFrameForTab(ev) {
    const frame = frameForTab(ev, activeTab);
    if (!frame?.storage_path) {
      evidenceImg.removeAttribute("src");
      depthCtx.clearRect(0, 0, depthCanvas.width, depthCanvas.height);
      setEvidenceViewMode(activeTab);
      return;
    }

    if (activeTab === "depth") {
      revokeImageUrl();
      evidenceImg.removeAttribute("src");
      bboxCtx.clearRect(0, 0, bboxCanvas.width, bboxCanvas.height);
      setEvidenceViewMode("depth");
      try {
        const depthInfo = await renderDepthPreview(frame.storage_path);
        if (depthInfo.stats.valid) {
          evidenceMeta.textContent +=
            " · depth " +
            depthInfo.width +
            "×" +
            depthInfo.height +
            " · " +
            Math.round(depthInfo.stats.min) +
            "–" +
            Math.round(depthInfo.stats.max) +
            " mm";
        }
      } catch (err) {
        if (err.code === 425) {
          evidencePlaceholder.textContent = "Anonymizing…";
          evidencePlaceholder.classList.remove("hidden");
          evidenceContent.classList.add("hidden");
        } else if (err.code === 424) {
          evidencePlaceholder.textContent = "Anonymization failed.";
          evidencePlaceholder.classList.remove("hidden");
          evidenceContent.classList.add("hidden");
        } else {
          throw err;
        }
      }
      return;
    }

    setEvidenceViewMode(activeTab);
    revokeImageUrl();
    try {
      const blob = await loadAuthImageBlob(frame.storage_path);
      imageObjectUrl = URL.createObjectURL(blob);
      evidenceImg.onload = () => drawBboxes(ev.rgb || frame);
      evidenceImg.src = imageObjectUrl;
    } catch (err) {
      evidenceImg.removeAttribute("src");
      bboxCtx.clearRect(0, 0, bboxCanvas.width, bboxCanvas.height);
      if (err.code === 425) {
        evidencePlaceholder.textContent = "Anonymizing faces…";
        evidencePlaceholder.classList.remove("hidden");
        evidenceContent.classList.add("hidden");
      } else if (err.code === 424) {
        evidencePlaceholder.textContent = "Anonymization failed.";
        evidencePlaceholder.classList.remove("hidden");
        evidenceContent.classList.add("hidden");
      } else {
        evidencePlaceholder.textContent = "Failed to load image.";
        evidencePlaceholder.classList.remove("hidden");
        evidenceContent.classList.add("hidden");
      }
    }
  }

  async function updateEvidence() {
    if (cameraRobotId == null) {
      evidencePlaceholder.classList.remove("hidden");
      evidenceContent.classList.add("hidden");
      revokeImageUrl();
      evidenceImg.removeAttribute("src");
      return;
    }

    const ev = findActiveEvent(scrubMs, cameraRobotId);
    activeEvent = ev;

    if (!ev) {
      evidencePlaceholder.classList.remove("hidden");
      evidenceContent.classList.add("hidden");
      revokeImageUrl();
      evidenceImg.removeAttribute("src");
      evidencePlaceholder.textContent =
        "Scrub near a capture event (◇) for " + robotLabel(cameraRobotId) + ".";
      return;
    }

    evidencePlaceholder.textContent = "Scrub near a capture event (◇) to see images.";
    evidencePlaceholder.classList.add("hidden");
    evidenceContent.classList.remove("hidden");
    evidenceMeta.textContent =
      robotLabel(cameraRobotId) +
      " · " +
      ev.trigger +
      " · session " +
      ev.session_id.slice(0, 8) +
      "… · " +
      ev.wall_time;

    document.querySelectorAll(".tab-bar .tab").forEach((btn) => {
      const tab = btn.dataset.tab;
      btn.disabled = !hasFrameForTab(ev, tab);
      btn.classList.toggle("active", tab === activeTab);
    });

    if (!hasFrameForTab(ev, activeTab)) {
      for (const tab of ["rgb", "ir", "depth"]) {
        if (hasFrameForTab(ev, tab)) {
          activeTab = tab;
          break;
        }
      }
    }

    try {
      await showFrameForTab(ev);
    } catch (e) {
      setStatus("Image load failed: " + e.message, true);
    }

    const snap = nearestByTime(getRobotReplay(cameraRobotId).snapshots, scrubMs);
    detectionList.innerHTML = "";
    if (snap?.objects?.length) {
      for (const obj of snap.objects) {
        const li = document.createElement("li");
        const p = obj.pose || {};
        li.textContent =
          (obj.class_name || "?") +
          " " +
          ((obj.probability ?? 0) * 100).toFixed(0) +
          "% @ (" +
          (p.x?.toFixed(2) ?? "?") +
          ", " +
          (p.y?.toFixed(2) ?? "?") +
          ") m";
        detectionList.appendChild(li);
      }
    }
  }

  // --- Timeline ---
  function stopPlayback() {
    playback.active = false;
    if (playback.rafId) cancelAnimationFrame(playback.rafId);
    playback.rafId = null;
  }

  function playbackLoop(ts) {
    if (!playback.active) return;
    if (!playback.lastTs) playback.lastTs = ts;
    const dt = (ts - playback.lastTs) * playback.speed;
    playback.lastTs = ts;
    scrubMs = Math.min(scrubMs + dt, windowToMs);
    if (scrubMs >= windowToMs) {
      scrubMs = windowToMs;
      stopPlayback();
    }
    syncScrubberFromMs();
    onScrub();
    if (playback.active) playback.rafId = requestAnimationFrame(playbackLoop);
  }

  function startPlayback(speed) {
    stopPlayback();
    playback.active = true;
    playback.speed = speed;
    playback.lastTs = 0;
    playback.rafId = requestAnimationFrame(playbackLoop);
  }

  // --- Load data ---
  async function loadRobotsList() {
    robots = await apiFetch("/robots");
    updateCameraRobotSelect();
  }

  async function loadRobotReplay(robotId, fromIso, toIso) {
    const q =
      "from=" + encodeURIComponent(fromIso) + "&to=" + encodeURIComponent(toIso);
    const [posesRes, detsRes, eventsRes] = await Promise.all([
      apiFetch("/robots/" + robotId + "/poses?" + q),
      apiFetch("/robots/" + robotId + "/detections?" + q),
      apiFetch("/robots/" + robotId + "/capture_events?" + q),
    ]);
    return {
      poses: posesRes.poses || [],
      snapshots: detsRes.snapshots || [],
      events: (eventsRes.events || []).map((ev) => ({ ...ev, robot_id: robotId })),
    };
  }

  async function loadReplayData() {
    const fromIso = localDatetimeToIso(fromInput.value);
    const toIso = localDatetimeToIso(toInput.value);
    if (!fromIso || !toIso) throw new Error("Set from and to times");

    if (!robots.length) await loadRobotsList();
    if (!robots.length) throw new Error("No robots registered");

    robotReplay = {};
    let totalPoses = 0;
    let totalSnapshots = 0;
    let totalEvents = 0;
    const errors = [];

    await Promise.all(
      robots.map(async (r) => {
        try {
          const data = await loadRobotReplay(r.id, fromIso, toIso);
          robotReplay[String(r.id)] = data;
          totalPoses += data.poses.length;
          totalSnapshots += data.snapshots.length;
          totalEvents += data.events.length;
        } catch (err) {
          robotReplay[String(r.id)] = { poses: [], snapshots: [], events: [] };
          errors.push(robotLabel(r.id) + ": " + err.message);
        }
      })
    );

    updateCameraRobotSelect();

    windowFromMs = parseMs(fromIso);
    windowToMs = parseMs(toIso);
    scrubMs = windowFromMs;

    autoBounds = computeAutoBounds(allPosesFlat());
    resetMapView();

    const hasMotion = totalPoses > 0 || totalSnapshots > 0;
    scrubber.disabled = windowToMs <= windowFromMs;
    playBtn.disabled = !hasMotion;
    playFastBtn.disabled = playBtn.disabled;
    pauseBtn.disabled = playBtn.disabled;

    syncScrubberFromMs();
    renderEventMarkers();
    updateEventSkipButtons();
    renderMap();
    updateEvidence();

    let msg =
      "Loaded " +
      robots.length +
      " robots · " +
      totalPoses +
      " poses, " +
      totalSnapshots +
      " detections, " +
      totalEvents +
      " capture events";
    if (errors.length) msg += " (" + errors.length + " failed)";
    setStatus(msg, errors.length === robots.length);
  }

  // --- Event wiring ---
  apiKeyInput.value = localStorage.getItem(API_KEY_STORAGE) || "";
  apiKeyInput.addEventListener("change", () => {
    localStorage.setItem(API_KEY_STORAGE, apiKeyInput.value.trim());
  });

  mapFileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      mapData = parseMapFile(JSON.parse(text));
      mapImageCanvas = prerenderOccupancy(mapData);
      resetMapView();
      setStatus("Map loaded: " + mapData.width + "×" + mapData.height);
      renderMap();
    } catch (err) {
      setStatus("Map file error: " + err.message, true);
    }
  });

  loadBtn.addEventListener("click", async () => {
    setStatus("Loading…");
    try {
      await loadReplayData();
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  cameraRobotSelect.addEventListener("change", () => {
    cameraRobotId = cameraRobotSelect.value ? Number(cameraRobotSelect.value) : null;
    updateEvidence();
  });

  scrubber.addEventListener("input", () => {
    scrubMsFromSlider();
    onScrub();
  });

  playBtn.addEventListener("click", () => startPlayback(1));
  playFastBtn.addEventListener("click", () => startPlayback(10));
  pauseBtn.addEventListener("click", stopPlayback);
  prevSkipEventBtn.addEventListener("click", () => skipCaptureEvent(-1));
  prevStepBtn.addEventListener("click", () => stepTimeline(-1));
  nextStepBtn.addEventListener("click", () => stepTimeline(1));
  nextSkipEventBtn.addEventListener("click", () => skipCaptureEvent(1));

  function mapCanvasCoords(evt) {
    const rect = mapCanvas.getBoundingClientRect();
    const sx = mapCanvas.width / rect.width;
    const sy = mapCanvas.height / rect.height;
    return [(evt.clientX - rect.left) * sx, (evt.clientY - rect.top) * sy];
  }

  zoomInBtn?.addEventListener("click", () => {
    const [mx, my] = getZoomAnchor();
    zoomAtPoint(mx, my, ZOOM_BUTTON_FACTOR);
  });

  zoomOutBtn?.addEventListener("click", () => {
    const [mx, my] = getZoomAnchor();
    zoomAtPoint(mx, my, 1 / ZOOM_BUTTON_FACTOR);
  });

  zoomResetBtn?.addEventListener("click", () => {
    resetMapView();
    paintMap();
  });

  mapCanvas.addEventListener(
    "wheel",
    (evt) => {
      evt.preventDefault();
      const [mx, my] = mapCanvasCoords(evt);
      const factor = evt.deltaY < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR;
      zoomAtPoint(mx, my, factor);
    },
    { passive: false }
  );

  mapCanvas.addEventListener("mousedown", (evt) => {
    if (evt.button !== 0) return;
    const [mx, my] = mapCanvasCoords(evt);
    panDrag = { startX: mx, startY: my, panX, panY };
    mapSection.classList.add("is-panning");
  });

  window.addEventListener("mousemove", (evt) => {
    if (!panDrag) return;
    const [mx, my] = mapCanvasCoords(evt);
    panX = panDrag.panX + (mx - panDrag.startX);
    panY = panDrag.panY + (my - panDrag.startY);
    paintMap();
  });

  window.addEventListener("mouseup", () => {
    if (!panDrag) return;
    panDrag = null;
    mapSection.classList.remove("is-panning");
  });

  if (!zoomInBtn || !zoomOutBtn || !zoomResetBtn) {
    console.warn("Replay map zoom controls not found in DOM");
  }

  document.querySelectorAll(".tab-bar .tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      activeTab = btn.dataset.tab;
      document.querySelectorAll(".tab-bar .tab").forEach((b) => {
        b.classList.toggle("active", b.dataset.tab === activeTab);
      });
      if (activeEvent) await showFrameForTab(activeEvent);
    });
  });

  window.addEventListener("resize", () => renderMap());

  // --- Init ---
  defaultWindowInputs();
  loadRobotsList().catch((e) => setStatus("Failed to list robots: " + e.message, true));
  updateMapLayout();
  updateZoomLabel();
  paintMap();
})();
