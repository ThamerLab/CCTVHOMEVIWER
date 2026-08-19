const grid = document.querySelector("#camera-grid");
const emptyState = document.querySelector("#empty-state");
let cameraCount = 0;
let resizeTimer;

loadCameras();

window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => updateGridLayout(cameraCount), 120);
}, { passive: true });

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

  if (window.matchMedia("(max-width: 700px)").matches) {
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
  frame.src = `/go2rtc/stream.html?src=${encodeURIComponent(camera.id)}&mode=webrtc&background=true`;

  reload.addEventListener("click", () => {
    frame.src = frame.src;
  });
  fullscreen.addEventListener("click", async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await player.requestFullscreen();
  });

  actions.append(reload, fullscreen);
  overlay.append(name, actions);
  player.append(frame);
  card.append(overlay, player);
  return card;
}
