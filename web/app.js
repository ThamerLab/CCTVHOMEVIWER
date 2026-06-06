document.querySelectorAll(".camera-card").forEach((card) => {
  const frame = card.querySelector("iframe");
  const reloadButton = card.querySelector(".reload-button");
  const fullscreenButton = card.querySelector(".fullscreen-button");
  const player = card.querySelector(".player-wrap");

  reloadButton.addEventListener("click", () => {
    frame.src = frame.src;
  });

  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await player.requestFullscreen();
      }
    } catch (error) {
      console.error("Fullscreen is not available:", error);
    }
  });
});
