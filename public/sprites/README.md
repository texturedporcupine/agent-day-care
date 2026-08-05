# Sprite drop folder

Run `npm run sprites` to download Pokémon minisprites (B2W2 menu-icon style)
here from [pokesprite](https://github.com/msikma/pokesprite), or hand-place
your own PNGs:

- `creature-<species>.png` — one per species used in your pens
- `egg.png`, `lady.png`, `prop-book.png`, `prop-keyboard.png`,
  `prop-mailbox.png`, `prop-bowl.png` — optional overrides

After hand-placing files, re-run `npm run sprites` to rebuild `manifest.json`.
Anything missing falls back to the built-in generated pixel art.

PNGs in this folder are gitignored on purpose: game sprite rips are
Nintendo/Game Freak IP and must not be committed to a public repo.
