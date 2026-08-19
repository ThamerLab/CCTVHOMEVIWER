const grid = document.querySelector("#camera-grid");
const emptyState = document.querySelector("#empty-state");
const tvModeButton = document.querySelector("#tv-mode-button");

const STREAM_MONITOR_INTERVAL_MS = 3000;
const STREAM_STARTUP_GRACE_MS = 12000;
const STREAM_STALL_MS = 10000;
const STREAM_MAX_RETRIES = 5;

let cameraCount = 0;
let resizeTimer;
let controlsTimer;
let tvModeActive = false;

loadCameras();

const initialUrl = new URL(location.href);
if (initialUrl.searchParams.get("tv") === "1") {
  setTvMode(true, { updateUrl: false, requestFullscreen: false });
}

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => updateGridLayout(cameraCount), 120);
}, { passive: true });

document.addEventListener("fullscreenchange", () => {
  requestAnimationFrame(() => updateGridLayout(cameraCount));
  if (tvModeActive) showTvControls();
});

for (const eventName of ["mousemove", "pointerdown", "touchstart"]) {
  document.addEventListener(eventName, () => showTvControls(), { passive: true });
}

document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "t" && !isTypingTarget(event.target)) {
    event.preventDefault();
    void toggleTvMode();
    return;
  }
  showTvControls();
});

tvModeButton.addEventListener("click", () => {
  void toggleTvMode();
});

async function toggleTvMode() {
  if (tvModeActive) {
    await setTvMode(false);
  } else {
    await setTvMode(true, { requestFullscreen: true });
  }
}

async function setTvMode(active, options = {}) {
  const { updateUrl = true, requestFullscreen = false } = options;
  tvModeActive = active;
  document.body.classList.toggle("tv-mode", active);
  tvModeButton.setAttribute("aria-pressed", String(active));
  tvModeButton.textContent = active ? "خروج من وضع التلفزيون" : "وضع التلفزيون";

  if (updateUrl) {
    const url = new URL(location.href);
    if (active) url.searchParams.set("tv", "1");
    else url.searchParams.delete("tv");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  clearTimeout(controlsTimer);

  if (active) {
    showTvControls();
    if (requestFullscreen && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        // Some TV browsers block the Fullscreen API. TV layout still works without it.
      }
    }
  } else {
    document.body.classList.remove("tv-controls-visible", "tv-controls-hidden");
    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch {
        // Ignore browsers that do not allow programmatic fullscreen exit.
      }
    }
  }

  requestAnimationFrame(() => updateGridLayout(cameraCount));
}

function showTvControls() {
  if (!tvModeActive) return;
  document.body.classList.add("tv-controls-visible");
  document.body.classList.remove("tv-controls-hidden");
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(() => {
    document.body.classList.remove("tv-controls-visible");
    document.body.classList.add("tv-controls-hidden");
  }, 3500);
}

function isTypingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

async function loadCameras() {
  try {
    const cameras = await apiRequest("/api/cameras");
    cameraCount = cameras.length;
    grid.replaceChildren();
    emptyState.hidden = cameras.length !== 0;
    grid.hidden = cameras.length === 0;

    for (const camera of cameras) {
      grid.append(createCameraCard(camera));
    }

    requestAnimationFrame(() => updateGridLayout(cameras.length));
  } catch (error) {
    grid.textContent = error.message;
  }
}

function updateGridLayout(count) {
  cameraCount = count;
  grid.dataset.cameraCount = String(count);

  if (!count) return;

  if (window.matchMedia("(max-width: 700px)").matches && !tvModeActive) {
    grid.dataset.layout = "mobile";
    grid.style.removeProperty("--grid-columns");
    grid.style.removeProperty("--grid-rows");
    return;
  }

  const width = Math.max(grid.clientWidth, 1);
  const height = Math.max(grid.clientHeight, 1);
  const targetRatio = 16 / 9;
  let best = { columns: 1, rows: count, score: Number.POSITIVE_INFINITY };

  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const cellRatio = (width / columns) / (height / rows);
    const ratioPenalty = Math.abs(Math.log(cellRatio / targetRatio));
    const emptySlots = (columns * rows) - count;
    const emptyPenalty = emptySlots * 0.08;
    const score = ratioPenalty + emptyPenalty;

    if (score < best.score) {
      best = { columns, rows, score };
    }
  }

  grid.style.setProperty("--grid-columns", best.columns);
  grid.style.setProperty("--grid-rows", best.rows);
  grid.dataset.layout = `${best.columns}x${best.rows}`;
}

function createCameraCard(camera) {
  const card = document.createElement("article");
  card.className = "camera-card";

  const overlay = document.createElement("div");
  overlay.className = "camera-overlay";

  const name = document.createElement("h2");
  name.textContent = camera.name;

  const actions = document.createElement("div");
  actions.className = "camera-actions";

  const reload = document.createElement("button");
  reload.className = "mini-button";
  reload.type = "button";
  reload.textContent = "تحديث";

  const fullscreen = document.createElement("button");
  fullscreen.className = "mini-button";
  fullscreen.type = "button";
  fullscreen.textContent = "تكبير";

  const player = document.createElement("div");
  player.className = "player-wrap";

  const frame = document.createElement("iframe");
  frame.title = camera.name;
  frame.allow = "autoplay; fullscreen";

  const offline = document.createElement("section");
  offline.className = "auth-card";
  offline.hidden = true;
  offline.setAttribute("role", "alert");

  const offlineTitle = document.createElement("h2");
  offlineTitle.className = "error";
  offlineTitle.textContent = "لا يوجد بث";

  const offlineText = document.createElement("p");
  offlineText.className = "error";
  offlineText.textContent = "البث لا يعمل بعد 5 محاولات إعادة اتصال.";

  const manualRetry = document.createElement("button");
  manualRetry.className = "danger-button";
  manualRetry.type = "button";
  manualRetry.textContent = "إعادة المحاولة";

  offline.append(offlineTitle, offlineText, manualRetry);

  const monitor = createStreamMonitor(camera, frame, offline, player);

  reload.addEventListener("click", () => {
    monitor.retryNow({ resetFailures: true });
  });

  manualRetry.addEventListener("click", () => {
    monitor.retryNow({ resetFailures: true });
  });

  fullscreen.addEventListener("click", async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await player.requestFullscreen();
  });

  actions.append(reload, fullscreen);
  overlay.append(name, actions);
  player.append(frame);
  card.append(overlay, player);

  monitor.start();
  return card;
}

function createStreamMonitor(camera, frame, offline, player) {
  const baseSrc = `/go2rtc/stream.html?src=${encodeURIComponent(camera.id)}&mode=webrtc&background=true`;
  let monitorTimer;
  let retries = 0;
  let loadStartedAt = 0;
  let lastProgressAt = 0;
  let lastVideoTime = -1;
  let onlineConfirmed = false;
  let offlineActive = false;

  function start() {
    loadStream();
    clearInterval(monitorTimer);
    monitorTimer = setInterval(checkStream, STREAM_MONITOR_INTERVAL_MS);
  }

  function loadStream() {
    offlineActive = false;
    offline.hidden = true;
    if (frame.parentNode !== player) player.replaceChildren(frame);

    loadStartedAt = Date.now();
    lastProgressAt = loadStartedAt;
    lastVideoTime = -1;
    onlineConfirmed = false;

    frame.src = `${baseSrc}&_=${Date.now()}`;
  }

  function findVideo() {
    try {
      const documentRef = frame.contentDocument;
      if (!documentRef) return null;
      return documentRef.querySelector("video-stream video, video");
    } catch {
      return null;
    }
  }

  function checkStream() {
    if (document.hidden || offlineActive) return;

    const now = Date.now();
    const video = findVideo();

    if (video) {
      const currentTime = Number(video.currentTime) || 0;
      const hasVideoData = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      const progressed = currentTime > lastVideoTime + 0.05;

      if (hasVideoData && progressed) {
        lastVideoTime = currentTime;
        lastProgressAt = now;

        if (!onlineConfirmed) {
          onlineConfirmed = true;
          retries = 0;
        }
        return;
      }

      if (currentTime > lastVideoTime) {
        lastVideoTime = currentTime;
        lastProgressAt = now;
      }
    }

    const graceElapsed = now - loadStartedAt >= STREAM_STARTUP_GRACE_MS;
    const stalled = now - lastProgressAt >= STREAM_STALL_MS;

    if (graceElapsed && stalled) handleFailure();
  }

  function handleFailure() {
    if (retries >= STREAM_MAX_RETRIES) {
      showOffline();
      return;
    }

    retries += 1;
    loadStream();
  }

  function showOffline() {
    offlineActive = true;
    frame.removeAttribute("src");
    offline.hidden = false;
    player.replaceChildren(offline);
  }

  function retryNow({ resetFailures = false } = {}) {
    if (resetFailures) retries = 0;
    loadStream();
  }

  return { start, retryNow };
}
