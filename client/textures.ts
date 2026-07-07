import Phaser from "phaser";

/**
 * All art is generated at boot from pixel-string templates: original creatures,
 * no binary assets in the repo, crisp at integer zoom. Swap for real sprite
 * sheets later by loading images under the same texture keys.
 */

type Palette = Record<string, string>;

const OUTLINE = "#1a1c2c";

function createPixelTexture(
  scene: Phaser.Scene,
  key: string,
  rows: string[],
  palette: Palette,
  width = 16,
  height = 16,
): void {
  if (scene.textures.exists(key)) return;
  const canvas = scene.textures.createCanvas(key, width, height);
  if (!canvas) return;
  const ctx = canvas.context;
  for (let y = 0; y < height; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? ".";
      if (ch === ".") continue;
      ctx.fillStyle = palette[ch] ?? OUTLINE;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  canvas.refresh();
}

const CREATURE_ROWS = [
  "................",
  ".o..........o...",
  ".oo........oo...",
  "..ooooooooo.....",
  ".oaaaaaaaaao....",
  "oaallaaaallaao..",
  "oalWBaaaaWBlao..",
  "oaaaaaaaaaaaao..",
  "oaaaammmaaaaao..",
  ".oaaaaaaaaaao...",
  ".oaaaaaaaaaao...",
  "..oaaaaaaaao....",
  "..oaao..oaao....",
  "..oo.o..o.oo....",
  "................",
  "................",
];

const EGG_ROWS = [
  "................",
  "......oooo......",
  ".....oaaaao.....",
  "....oaalaaao....",
  "...oaalaaaaao...",
  "...oalaaaaaao...",
  "..oaalaaaaaaao..",
  "..oaaaaaaaaaao..",
  "..oaagaagaagao..",
  "..oagaagaagaao..",
  "..oaaaaaaaaaao..",
  "...oaaaaaaaao...",
  "....oaaaaaao....",
  ".....oooooo.....",
  "................",
  "................",
];

const LADY_ROWS = [
  ".....oooo.......",
  "....ohhhho......",
  "...ohhhhhho.....",
  "...ohhhhhhho....",
  "...osWsssWso....",
  "...ossssssso....",
  "....ossmsso.....",
  ".....odddo......",
  "....odddddo.....",
  "...odddddddo....",
  "...odddddddo....",
  "...odddddddo....",
  "....oddddo......",
  "....os..so......",
  "....oo..oo......",
  "................",
];

const BOOK_ROWS = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "..oooooooooooo..",
  ".owwwwwoWWWWWo..",
  ".owlwlwoWlWlWo..",
  ".owwwwwoWWWWWo..",
  ".owlwlwoWlWlWo..",
  ".owwwwwoWWWWWo..",
  "..oooooooooooo..",
  "................",
  "................",
  "................",
  "................",
];

const KEYBOARD_ROWS = [
  "................",
  "................",
  "................",
  "................",
  "..oooooooooooo..",
  ".oggggggggggggo.",
  ".ogkgkgkgkgkggo.",
  ".oggggggggggggo.",
  ".ogkgkgkgkgkggo.",
  ".oggggggggggggo.",
  "..oooooooooooo..",
  "................",
  "................",
  "................",
  "................",
  "................",
];

const MAILBOX_ROWS = [
  "................",
  "....oooooo......",
  "...orrrrrro.....",
  "...orwwwwro.....",
  "...orrrrrro.....",
  "...orrrrrro.....",
  "....oooooo......",
  "......oo........",
  "......oo........",
  "......oo........",
  "......oo........",
  "......oo........",
  ".....oooo.......",
  "................",
  "................",
  "................",
];

const BOWL_ROWS = [
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "................",
  "..oo........oo..",
  "..orroooooorro..",
  "..orrrrrrrrrro..",
  "...orrrrrrrro...",
  "....oooooooo....",
  "................",
  "................",
  "................",
];

const HEART_ROWS = [
  ".rr.rr..",
  "rrrrrrr.",
  "rrrrrrr.",
  ".rrrrr..",
  "..rrr...",
  "...r....",
];

export const SPECIES_COLORS: Record<string, { body: string; light: string }> = {
  sparkmon: { body: "#ffcd75", light: "#fff3b0" },
  embermon: { body: "#ef7d57", light: "#ffb570" },
  aquamon: { body: "#73eff7", light: "#c7f7fb" },
  leafmon: { body: "#a7f070", light: "#d6ffb3" },
  default: { body: "#c68fdf", light: "#e6c3f5" },
};

export function speciesTextureKey(species: string): string {
  return SPECIES_COLORS[species] ? `creature-${species}` : "creature-default";
}

export function makeTextures(scene: Phaser.Scene): void {
  for (const [species, colors] of Object.entries(SPECIES_COLORS)) {
    createPixelTexture(scene, `creature-${species}`, CREATURE_ROWS, {
      o: OUTLINE,
      a: colors.body,
      l: colors.light,
      W: "#ffffff",
      B: "#1a1c2c",
      m: "#b13e53",
    });
  }

  createPixelTexture(scene, "egg", EGG_ROWS, {
    o: OUTLINE,
    a: "#f4f4f4",
    l: "#ffffff",
    g: "#94b0c2",
  });

  createPixelTexture(scene, "lady", LADY_ROWS, {
    o: OUTLINE,
    h: "#ef7d8e",
    s: "#ffe3c8",
    W: "#1a1c2c",
    m: "#b13e53",
    d: "#f4f4f4",
  });

  createPixelTexture(scene, "prop-book", BOOK_ROWS, {
    o: OUTLINE,
    w: "#f4f4f4",
    W: "#e0e7f0",
    l: "#94b0c2",
  });
  createPixelTexture(scene, "prop-keyboard", KEYBOARD_ROWS, {
    o: OUTLINE,
    g: "#566c86",
    k: "#94b0c2",
  });
  createPixelTexture(scene, "prop-mailbox", MAILBOX_ROWS, {
    o: OUTLINE,
    r: "#41a6f6",
    w: "#f4f4f4",
  });
  createPixelTexture(scene, "prop-bowl", BOWL_ROWS, {
    o: OUTLINE,
    r: "#b13e53",
  });
  createPixelTexture(scene, "heart", HEART_ROWS, { r: "#ef7d57" }, 8, 6);

  makeGrassTexture(scene);
  makeFenceTexture(scene);
  makeBuildingTextures(scene);
}

function makeGrassTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists("grass")) return;
  const canvas = scene.textures.createCanvas("grass", 16, 16);
  if (!canvas) return;
  const ctx = canvas.context;
  ctx.fillStyle = "#38b764";
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = "#2f9e56";
  for (const [x, y] of [[2, 3], [9, 6], [5, 11], [13, 12], [12, 2], [3, 13]] as const) {
    ctx.fillRect(x, y, 2, 1);
    ctx.fillRect(x, y - 1, 1, 1);
  }
  canvas.refresh();
}

function makeFenceTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists("fence")) return;
  const canvas = scene.textures.createCanvas("fence", 16, 16);
  if (!canvas) return;
  const ctx = canvas.context;
  ctx.fillStyle = "#a2664b";
  ctx.fillRect(1, 4, 3, 12);
  ctx.fillRect(12, 4, 3, 12);
  ctx.fillStyle = "#c28569";
  ctx.fillRect(0, 6, 16, 2);
  ctx.fillRect(0, 11, 16, 2);
  ctx.fillStyle = "#7a4a35";
  ctx.fillRect(1, 4, 3, 1);
  ctx.fillRect(12, 4, 3, 1);
  canvas.refresh();
}

function makeBuildingTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists("building")) return;
  const w = 128;
  const h = 48;
  const canvas = scene.textures.createCanvas("building", w, h);
  if (!canvas) return;
  const ctx = canvas.context;
  // Walls
  ctx.fillStyle = "#e0c9a6";
  ctx.fillRect(4, 16, w - 8, h - 16);
  // Roof
  ctx.fillStyle = "#b13e53";
  ctx.fillRect(0, 8, w, 10);
  ctx.fillRect(8, 2, w - 16, 8);
  // Door
  ctx.fillStyle = "#7a4a35";
  ctx.fillRect(w / 2 - 8, h - 20, 16, 20);
  // Windows
  ctx.fillStyle = "#73eff7";
  ctx.fillRect(16, 24, 12, 10);
  ctx.fillRect(w - 28, 24, 12, 10);
  ctx.strokeStyle = "#1a1c2c";
  ctx.lineWidth = 1;
  ctx.strokeRect(16.5, 24.5, 11, 9);
  ctx.strokeRect(w - 27.5, 24.5, 11, 9);
  canvas.refresh();
}
