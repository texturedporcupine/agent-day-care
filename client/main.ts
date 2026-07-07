import Phaser from "phaser";
import { DayCareScene, SCENE_W, SCENE_H } from "./DayCareScene";

/** Largest integer zoom that fits the viewport, so pixels stay crisp. */
function integerZoom(): number {
  const availW = window.innerWidth - 16;
  const availH = window.innerHeight - 60; // status bar
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
