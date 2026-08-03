import Phaser from "phaser";
import { DayCareScene, SCENE_W, SCENE_H } from "./DayCareScene";

const gameHost = document.getElementById("game")!;

/** Largest fitting zoom; preserve crisp integers unless a narrow screen needs scaling down. */
function responsiveZoom(): number {
  const availW = gameHost.clientWidth;
  const availH = Math.max(400, window.innerHeight - 80);
  const fit = Math.min(availW / SCENE_W, availH / SCENE_H);
  return fit < 1 ? Math.max(0.5, fit) : Math.floor(fit);
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: SCENE_W,
  height: SCENE_H,
  zoom: responsiveZoom(),
  pixelArt: true,
  backgroundColor: "#1a1c2c",
  scene: [DayCareScene],
});

window.addEventListener("resize", () => {
  game.scale.setZoom(responsiveZoom());
});

new ResizeObserver(() => {
  game.scale.setZoom(responsiveZoom());
}).observe(gameHost);
