import Phaser from "phaser";
import type { AgentEvent } from "@shared/schema";
import { STATE_BEHAVIOR, TOOL_SPOT, SOURCE_BADGE, type PenSpot } from "./behavior";
import { speciesTextureKey } from "./textures";

export const PEN_W = 112;
export const PEN_H = 112;
const TILE = 16;

/** Positions of the play equipment inside a pen, in local pixels. */
const SPOTS: Record<PenSpot, { x: number; y: number }> = {
  book: { x: 24, y: 40 },
  keyboard: { x: PEN_W - 24, y: 40 },
  mailbox: { x: PEN_W - 24, y: PEN_H - 40 },
  bowl: { x: 24, y: PEN_H - 40 },
  center: { x: PEN_W / 2, y: PEN_H / 2 },
  pace: { x: PEN_W / 2, y: PEN_H / 2 },
};

/**
 * One fenced pen and its resident creature. update() applies the latest
 * AgentEvent; the STATE_BEHAVIOR table decides motion, overlay, and target spot.
 */
export class Pen extends Phaser.GameObjects.Container {
  readonly agentId: string;
  private creature: Phaser.GameObjects.Sprite;
  private overlayText: Phaser.GameObjects.Text;
  private nicknameText: Phaser.GameObjects.Text;
  private activityText: Phaser.GameObjects.Text;
  private badge: Phaser.GameObjects.Container | null = null;
  private bowlFill: Phaser.GameObjects.Rectangle;
  private hearts: Phaser.GameObjects.Image[] = [];
  private flash: Phaser.GameObjects.Rectangle;

  private current: AgentEvent | null = null;
  private motionTween: Phaser.Tweens.Tween | null = null;
  private walkTimer: Phaser.Time.TimerEvent | null = null;

  needsLady = false;

  constructor(scene: Phaser.Scene, x: number, y: number, agent: AgentEvent) {
    super(scene, x, y);
    this.agentId = agent.agentId;

    this.buildGround(scene);
    this.buildFence(scene);
    this.buildProps(scene);

    this.bowlFill = scene.add
      .rectangle(SPOTS.bowl.x, SPOTS.bowl.y + 2, 10, 2, 0xa7f070)
      .setOrigin(0.5, 1)
      .setVisible(false);
    this.add(this.bowlFill);

    this.creature = scene.add
      .sprite(SPOTS.center.x, SPOTS.center.y, speciesTextureKey(scene, agent.species))
      .setInteractive({ useHandCursor: true });
    this.creature.on("pointerdown", () => {
      if (this.current?.url) window.open(this.current.url, "_blank");
    });
    this.add(this.creature);

    this.overlayText = scene.add
      .text(SPOTS.center.x, SPOTS.center.y - 16, "", {
        fontFamily: "Courier New",
        fontSize: "10px",
        color: "#f4f4f4",
        stroke: "#1a1c2c",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);
    this.add(this.overlayText);

    // Starts right of the source badge (which spans x 4-16) to avoid overlap.
    this.nicknameText = scene.add
      .text(20, -2, agent.nickname, {
        fontFamily: "Courier New",
        fontSize: "10px",
        color: "#f4f4f4",
        stroke: "#1a1c2c",
        strokeThickness: 3,
      })
      .setOrigin(0, 1);
    this.add(this.nicknameText);

    this.activityText = scene.add
      .text(PEN_W / 2, PEN_H + 3, "", {
        fontFamily: "Courier New",
        fontSize: "8px",
        color: "#94b0c2",
      })
      .setOrigin(0.5, 0);
    this.add(this.activityText);

    this.flash = scene.add
      .rectangle(PEN_W / 2, PEN_H / 2, PEN_W, PEN_H, 0xb13e53, 0)
      .setOrigin(0.5);
    this.add(this.flash);

    this.setBadge(scene, agent.source);
    this.update(agent);
  }

  /** Local-pixel position of the creature, for the Day Care Lady to walk to. */
  get creaturePosition(): { x: number; y: number } {
    return { x: this.x + this.creature.x, y: this.y + this.creature.y };
  }

  update(agent: AgentEvent): void {
    const prev = this.current;
    this.current = agent;

    this.nicknameText.setText(truncate(agent.nickname, 15));
    this.activityText.setText(truncate(agent.activity ?? "", 24));
    this.updateBowl(agent.tokens ?? 0);

    const stateChanged = prev?.state !== agent.state || prev?.tool !== agent.tool;
    if (stateChanged) this.applyBehavior(agent);
  }

  private applyBehavior(agent: AgentEvent): void {
    const behavior = STATE_BEHAVIOR[agent.state];
    this.needsLady = behavior.needsLady;

    this.motionTween?.remove();
    this.motionTween = null;
    this.walkTimer?.remove();
    this.walkTimer = null;
    this.scene.tweens.killTweensOf(this.creature);
    this.creature.setAngle(0).setScale(1).setAlpha(1);
    this.flash.setAlpha(0);

    const isEgg = agent.state === "egg";
    this.creature.setTexture(isEgg ? "egg" : speciesTextureKey(this.scene, agent.species));

    const spot = agent.state === "working" && agent.tool ? TOOL_SPOT[agent.tool] : behavior.spot;
    const target = SPOTS[spot];

    this.scene.tweens.add({
      targets: this.creature,
      x: target.x,
      y: target.y - (spot !== "center" && spot !== "pace" ? 14 : 0),
      duration: 600,
      onComplete: () => this.startMotion(agent, spot),
    });

    this.updateOverlay(agent);
  }

  private startMotion(agent: AgentEvent, spot: PenSpot): void {
    const behavior = STATE_BEHAVIOR[agent.state];
    const c = this.creature;

    switch (behavior.motion) {
      case "wobble":
        this.motionTween = this.scene.tweens.add({
          targets: c,
          angle: { from: -8, to: 8 },
          duration: 300,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
        break;
      case "sit":
        this.motionTween = this.scene.tweens.add({
          targets: c,
          scaleY: { from: 1, to: 0.95 },
          duration: 800,
          yoyo: true,
          repeat: -1,
        });
        break;
      case "walk":
        if (spot === "pace") {
          this.startPacing();
        } else {
          // Bounce in place at the equipment: flipping the book / hammering keys.
          this.motionTween = this.scene.tweens.add({
            targets: c,
            y: c.y - 3,
            duration: 200,
            yoyo: true,
            repeat: -1,
          });
        }
        break;
      case "sleep":
        this.motionTween = this.scene.tweens.add({
          targets: c,
          scaleY: { from: 0.8, to: 0.72 },
          duration: 1200,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
        break;
      case "jump":
        this.motionTween = this.scene.tweens.add({
          targets: c,
          y: c.y - 12,
          duration: 250,
          yoyo: true,
          repeat: -1,
          ease: "Quad.easeOut",
        });
        this.sparkle();
        break;
      case "faint": {
        c.setAngle(90);
        this.scene.tweens.add({
          targets: this.flash,
          alpha: { from: 0.5, to: 0 },
          duration: 400,
          repeat: 2,
        });
        break;
      }
      default: {
        const _exhaustive: never = behavior.motion;
        void _exhaustive;
      }
    }
  }

  private startPacing(): void {
    const wander = () => {
      const x = Phaser.Math.Between(28, PEN_W - 28);
      const y = Phaser.Math.Between(32, PEN_H - 28);
      this.motionTween = this.scene.tweens.add({
        targets: this.creature,
        x,
        y,
        duration: Phaser.Math.Between(700, 1300),
        ease: "Sine.easeInOut",
      });
      this.walkTimer = this.scene.time.delayedCall(Phaser.Math.Between(900, 1600), wander);
    };
    wander();
  }

  private updateOverlay(agent: AgentEvent): void {
    const behavior = STATE_BEHAVIOR[agent.state];
    this.overlayText.setVisible(behavior.overlay !== null);
    this.scene.tweens.killTweensOf(this.overlayText);

    switch (behavior.overlay) {
      case "dots":
        this.animateDots();
        break;
      case "zzz":
        this.overlayText.setText("Zzz");
        this.scene.tweens.add({
          targets: this.overlayText,
          alpha: { from: 1, to: 0.3 },
          duration: 900,
          yoyo: true,
          repeat: -1,
        });
        break;
      case "ribbon":
        this.overlayText.setText(ribbonLabel(agent.activity)).setAlpha(1);
        break;
      case "swirl":
        this.overlayText.setText("@_@").setAlpha(1);
        break;
      case null:
        break;
      default: {
        const _exhaustive: never = behavior.overlay;
        void _exhaustive;
      }
    }
  }

  private animateDots(): void {
    let n = 0;
    const tick = () => {
      if (this.current?.state !== "thinking") return;
      n = (n % 3) + 1;
      this.overlayText.setText(".".repeat(n)).setAlpha(1);
      this.scene.time.delayedCall(400, tick);
    };
    tick();
  }

  private sparkle(): void {
    for (let i = 0; i < 6; i++) {
      const star = this.scene.add
        .text(
          Phaser.Math.Between(20, PEN_W - 20),
          Phaser.Math.Between(20, PEN_H - 20),
          "*",
          { fontSize: "10px", color: "#ffcd75" },
        )
        .setOrigin(0.5);
      this.add(star);
      this.scene.tweens.add({
        targets: star,
        alpha: 0,
        y: star.y - 10,
        duration: Phaser.Math.Between(500, 1000),
        onComplete: () => star.destroy(),
      });
    }
  }

  private updateBowl(tokens: number): void {
    // Full bowl at 100k tokens; hearts appear every 20k.
    const fill = Phaser.Math.Clamp(tokens / 100_000, 0, 1);
    this.bowlFill.setVisible(fill > 0).setSize(10, Math.max(1, Math.round(fill * 6)));

    const heartCount = Phaser.Math.Clamp(Math.floor(tokens / 20_000), 0, 5);
    while (this.hearts.length < heartCount) {
      const heart = this.scene.add.image(8 + this.hearts.length * 9, 10, "heart").setOrigin(0, 0);
      this.add(heart);
      this.hearts.push(heart);
    }
  }

  private setBadge(scene: Phaser.Scene, source: string): void {
    this.badge?.destroy();
    const style = SOURCE_BADGE[source] ?? { color: 0x94b0c2, letter: "?" };
    const bg = scene.add.rectangle(0, 0, 12, 12, style.color).setOrigin(0.5);
    const letter = scene.add
      .text(0, 0, style.letter, { fontFamily: "Courier New", fontSize: "9px", color: "#1a1c2c" })
      .setOrigin(0.5);
    this.badge = scene.add.container(10, -8, [bg, letter]);
    this.add(this.badge);
  }

  private buildGround(scene: Phaser.Scene): void {
    for (let ty = 0; ty < PEN_H / TILE; ty++) {
      for (let tx = 0; tx < PEN_W / TILE; tx++) {
        this.add(scene.add.image(tx * TILE, ty * TILE, "grass").setOrigin(0));
      }
    }
  }

  private buildFence(scene: Phaser.Scene): void {
    for (let tx = 0; tx < PEN_W / TILE; tx++) {
      this.add(scene.add.image(tx * TILE, 0, "fence").setOrigin(0));
      this.add(scene.add.image(tx * TILE, PEN_H - TILE, "fence").setOrigin(0));
    }
    for (let ty = 1; ty < PEN_H / TILE - 1; ty++) {
      this.add(scene.add.image(0, ty * TILE, "fence").setOrigin(0).setAngle(0));
      this.add(scene.add.image(PEN_W - TILE, ty * TILE, "fence").setOrigin(0));
    }
  }

  private buildProps(scene: Phaser.Scene): void {
    this.add(scene.add.image(SPOTS.book.x, SPOTS.book.y, "prop-book"));
    this.add(scene.add.image(SPOTS.keyboard.x, SPOTS.keyboard.y, "prop-keyboard"));
    this.add(scene.add.image(SPOTS.mailbox.x, SPOTS.mailbox.y, "prop-mailbox"));
    this.add(scene.add.image(SPOTS.bowl.x, SPOTS.bowl.y, "prop-bowl"));
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function ribbonLabel(activity: string | undefined): string {
  if (activity && /pr|branch/i.test(activity)) return activity.slice(0, 16);
  return "PR!";
}
