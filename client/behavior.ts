import type { CreatureState, Tool } from "@shared/schema";

export type Motion = "wobble" | "sit" | "walk" | "sleep" | "jump" | "faint";
export type Overlay = "dots" | "zzz" | "ribbon" | "swirl" | null;
export type PenSpot = "book" | "keyboard" | "mailbox" | "bowl" | "center" | "pace";

export type Behavior = {
  motion: Motion;
  overlay: Overlay;
  /** Where in the pen the creature goes for this state. */
  spot: PenSpot;
  /** The Day Care Lady walks over when true. */
  needsLady: boolean;
};

/** Which play equipment each tool maps to while working. */
export const TOOL_SPOT: Record<Tool, PenSpot> = {
  read_file: "book",
  run_terminal_cmd: "keyboard",
  mcp: "mailbox",
  web: "mailbox",
  other: "pace",
};

/** The whole personality: state -> what the creature does in its pen. */
export const STATE_BEHAVIOR: Record<CreatureState, Behavior> = {
  egg: { motion: "wobble", overlay: null, spot: "center", needsLady: false },
  thinking: { motion: "sit", overlay: "dots", spot: "center", needsLady: false },
  working: { motion: "walk", overlay: null, spot: "pace", needsLady: false },
  napping: { motion: "sleep", overlay: "zzz", spot: "center", needsLady: false },
  levelup: { motion: "jump", overlay: "ribbon", spot: "center", needsLady: false },
  fainted: { motion: "faint", overlay: "swirl", spot: "center", needsLady: true },
};

export const SOURCE_BADGE: Record<string, { color: number; letter: string }> = {
  "cursor-cloud": { color: 0x41a6f6, letter: "C" },
  "cursor-cli": { color: 0x94b0c2, letter: ">" },
  claude: { color: 0xef7d57, letter: "A" },
  chatgtm: { color: 0x38b764, letter: "G" },
  sand: { color: 0xd6b370, letter: "S" },
};
