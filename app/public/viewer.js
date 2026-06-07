const grid = document.querySelector("#camera-grid");
const emptyState = document.querySelector("#empty-state");

loadCameras();

async function loadCameras() {
  try {
    const cameras = await apiRequest("/api/cameras");
    grid.replaceChildren();
    emptyState.hidden = cameras.length !== 0;
    grid.hidden = cameras.length === 0;
    grid.style.setProperty("--camera-count", cameras.length);

    for (const camera of cameras) {
      grid.append(createCameraCard(camera));
    }
  } catch (error) {
    grid.textContent = error.message;
  }
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
