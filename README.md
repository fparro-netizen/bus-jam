# Bus Jam

An original colour-sorting traffic puzzle for iPhone (and any modern browser), drawn in 3D with three.js. Hundreds of riders pour in from both top corners of a U-shaped track and shuffle down its two arms in solid colour waves toward the exit at the bottom centre; below the parking row sits a big diagonal jam of buses and vans, each with an arrow on its roof. Tap a vehicle whose path is clear: it drives out of the jam, leaving a dust trail, and parks in one of 8 spots (VIP included). The front rider of either arm boards a parked bus of the same colour, walking single file down the chute; the badge under each bus counts the seats left. Full buses leave and free their spot. Clear the jam and seat everyone to win.

**Play:** https://fparro-netizen.github.io/bus-jam/ (Safari > Share > Add to Home Screen for full screen and offline play)

- 36 levels, every one with all 9 colours (green, yellow, blue, pink, purple, red, black, cyan, orange): level 1 has 32 vehicles and 304 riders; later levels grow to 64 to 79 vehicles and up to ~970 riders, with more blocking, more '?' vehicles and bigger buses
- Vans hold 8, buses 16, double-deckers 24; grey '?' vehicles hide their colour until their path is clear
- All 8 parking spots are open from the start
- Free, unlimited boosters: **Shuffle** (re-mixes the colours of vehicles still in the lot among same-size vehicles and re-deals the waiting line into an order that is guaranteed solvable from where you are), **Sort** (moves passengers who fit a parked bus to the front), **Undo** and **Restart**
- No game over: when no move is possible you get a Shuffle / Undo / Restart panel
- Stars: 3 for no boosters, 2 for one or two, 1 otherwise (Undo is free and doesn't count)
- Every level is checked solvable with 8 spots and no boosters by a depth-first solver (`tools/genlevels.mjs`); levels are tuned by how often a simple human-like player wins (100% early, about 30% on the last levels)
- No ads, no purchases, no tracking, no timers. Progress is saved in localStorage

Built with [three.js](https://threejs.org) r160 (MIT), bundled in `js/lib/`. Vehicles, riders, track walls and dust are instanced, so a full level is about 60 draw calls. Sounds are synthesised with WebAudio.

## Repo layout
- `site/` the game exactly as published to `fparro-netizen.github.io/bus-jam/`
- `site/js/core.js` rules, level generator, solver, shuffle and sort (no DOM, shared by the game and tools)
- `tools/genlevels.mjs` regenerates `site/js/levels.js` and verifies every level with the solver (`node tools/genlevels.mjs`)
- `tools/icons.cjs` renders `site/icons/icon.svg` to PNG and inlines it as data URIs (apple-touch-icon and manifest icons)
- `test/e2e.cjs <url>` Playwright test in an iPhone 13 viewport: all colours at the start, riders only ever step forward down the arms (no spin), touch taps, boarding, level complete, stuck -> shuffle rescue, undo, sort, saved progress, offline
