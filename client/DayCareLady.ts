import Phaser from "phaser";
import type { Pen } from "./Pen";

/**
 * Nurse-Joy-style NPC. Idles by the day-care building; when any creature
 * faints she walks over and tends to it until it recovers.
 */
export class DayCareLady {
  private sprite: Phaser.GameObjects.Sprite;
  private home: { x: number; y: number };
  private busyWith: Pen | null = null;
  private tween: Phaser.Tweens.Tween | null = null;

  constructor(private scene: Phaser.Scene, x: number, y: number) {
    this.home = { x, y };
    this.sprite = scene.add.sprite(x, y, "lady").setDepth(50);
    scene.tweens.add({
      targets: this.sprite,
      scaleY: { from: 1, to: 0.97 },
      duration: 900,
      yoyo: true,
      repeat: -1,
    });
  }

  /** Call every few hundred ms with the current pens. */
  tend(pens: Pen[]): void {
    if (this.busyWith) {
      if (this.busyWith.needsLady) return; // still nursing
      this.busyWith = null;
      this.walkTo(this.home.x, this.home.y);
      return;
    }
    const fainted = pens.find((pen) => pen.needsLady);
    if (fainted) {
      this.busyWith = fainted;
      const pos = fainted.creaturePosition;
      this.walkTo(pos.x + 14, pos.y);
    }
  }

  private walkTo(x: number, y: number): void {
    this.tween?.remove();
    const distance = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, x, y);
    this.tween = this.scene.tweens.add({
      targets: this.sprite,
      x,
      y,
      duration: Math.max(300, distance * 12),
      ease: "Sine.easeInOut",
    });
  }
}
