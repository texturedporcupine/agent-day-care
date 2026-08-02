import Phaser from "phaser";
import type { AgentEvent } from "@shared/schema";
import { Pen, PEN_W, PEN_H } from "./Pen";
import { DayCareLady } from "./DayCareLady";
import { makeTextures } from "./textures";
import { connectBus, type ConnectionState } from "./net";
import { setConnectionStatus, updateEmptyState, updateStatusBar, updateThreadList } from "./hud";

export const SCENE_W = 512;
export const SCENE_H = 400;

const PENS_PER_ROW = 4;
const PEN_GAP = 12;
const PENS_TOP = 96; // below the day-care building
const BUILDING_Y = 24;

export class DayCareScene extends Phaser.Scene {
  private pens = new Map<string, Pen>();
  private agents = new Map<string, AgentEvent>();
  private lady!: DayCareLady;
  private connection: ConnectionState = "connecting";

  constructor() {
    super("daycare");
  }

  create(): void {
    makeTextures(this);
    this.buildYard();
    this.lady = new DayCareLady(this, SCENE_W / 2 + 80, BUILDING_Y + 56);

    this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => this.lady.tend([...this.pens.values()]),
    });

    updateEmptyState(this.agents.size, this.connection);
    connectBus({
      onAgent: (agent) => this.onAgent(agent),
      onConnectionChange: (state) => this.onConnectionChange(state),
    });
  }

  private onConnectionChange(state: ConnectionState): void {
    this.connection = state;
    setConnectionStatus(state);
    updateEmptyState(this.agents.size, state);
  }

  private onAgent(agent: AgentEvent): void {
    this.agents.set(agent.agentId, agent);
    let pen = this.pens.get(agent.agentId);
    if (!pen) {
      pen = this.spawnPen(agent);
      this.pens.set(agent.agentId, pen);
    }
    pen.update(agent);
    updateStatusBar(this.agents);
    updateThreadList(this.agents);
    updateEmptyState(this.agents.size, this.connection);
  }

  private spawnPen(agent: AgentEvent): Pen {
    const index = this.pens.size;
    const col = index % PENS_PER_ROW;
    const row = Math.floor(index / PENS_PER_ROW);
    const rowWidth = PENS_PER_ROW * PEN_W + (PENS_PER_ROW - 1) * PEN_GAP;
    const x = (SCENE_W - rowWidth) / 2 + col * (PEN_W + PEN_GAP);
    const y = PENS_TOP + row * (PEN_H + PEN_GAP + 14);
    const pen = new Pen(this, x, y, agent);
    this.add.existing(pen);
    return pen;
  }

  private buildYard(): void {
    for (let ty = 0; ty < SCENE_H / 16; ty++) {
      for (let tx = 0; tx < SCENE_W / 16; tx++) {
        this.add.image(tx * 16, ty * 16, "grass").setOrigin(0).setAlpha(0.55);
      }
    }

    this.add.image(SCENE_W / 2, BUILDING_Y + 24, "building").setOrigin(0.5, 0.5);

    const sign = this.add.container(SCENE_W / 2, BUILDING_Y + 62);
    const board = this.add.rectangle(0, 0, 132, 16, 0xa2664b).setStrokeStyle(1, 0x1a1c2c);
    const label = this.add
      .text(0, 0, "AGENT DAY CARE", {
        fontFamily: "Courier New",
        fontSize: "10px",
        color: "#f4f4f4",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    sign.add([board, label]);
  }
}
