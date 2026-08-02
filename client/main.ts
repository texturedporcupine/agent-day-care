import Phaser from "phaser";
import { DayCareScene, SCENE_W, SCENE_H } from "./DayCareScene";

const gameHost = document.getElementById("game")!;

/** Largest integer zoom that fits the viewport, so pixels stay crisp. */
function integerZoom(): number {
  const availW = gameHost.clientWidth;
  const availH = Math.max(400, window.innerHeight - 80);
  return Math.max(1, Math.min(Math.floor(availW / SCENE_W), Math.floor(availH / SCENE_H)));
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: SCENE_W,
  height: SCENE_H,
  zoom: integerZoom(),
  pixelArt: true,
  backgroundColor: "#1a1c2c",
  scene: [DayCareScene],
});

window.addEventListener("resize", () => {
  game.scale.setZoom(integerZoom());
});

new ResizeObserver(() => {
  game.scale.setZoom(integerZoom());
}).observe(gameHost);
