# Bus Jam

An original colour-sorting traffic puzzle for iPhone (and any modern browser), drawn in 3D with three.js. In the middle of the screen a big oval ring of riders (150 places, 3 abreast) keeps circulating counter-clockwise, all the time. Two streams pour in from the top corners in solid colour blocks; whenever an empty place in the ring passes a stream's join point, that stream's front rider steps in. The parking row runs along the bottom of the ring: as ring riders pass a parked bus of their colour that still has seats, they step off and board it, and the badge under the bus counts down. Full buses drive off and free their spot. Below sits a big jam of buses and vans (diamond, heart, circle, hexagon and butterfly shapes), each with an arrow on its roof. Tap a vehicle whose path is clear: it drives out of the jam, leaving a dust trail, and parks in one of 8 spots (VIP included). Clear the jam and seat everyone to win.

**Play:** https://fparro-netizen.github.io/bus-jam/ (Safari > Share > Add to Home Screen for full screen and offline play)

- 36 levels, every one with all 9 colours (green, yellow, blue, pink, purple, red, black, cyan, orange): level 1 has 32 vehicles and 360 riders; later levels grow to 70 to 84 vehicles and up to ~970 riders, with more blocking, more '?' vehicles, bigger buses, and rings holding fewer colours at a time
- Vans hold 8, buses 16, double-deckers 24; grey '?' vehicles hide their colour until their path is clear
- All 8 parking spots are open from the start
- Free, unlimited boosters: **Shuffle** (re-mixes the colours of vehicles still in the lot among same-size vehicles and re-mixes the waiting riders; every shuffle is checked with the solver, and when needed the ring and streams are re-dealt so the game is always winnable from where you are), **Sort** (moves stream riders who fit a parked bus to the front of their stream), **Undo** and **Restart**
- No game over: if every spot holds a bus and no rider in the ring (or able to enter it) fits any of them for a full turn of the ring, you get a Shuffle / Undo / Restart panel
- Stars: 3 for no boosters, 2 for one or two, 1 otherwise (Undo is free and doesn't count)
- Every level is checked solvable with 8 spots and no boosters by a depth-first solver (`tools/genlevels.mjs`) on an exact model of where the ring settles after each tap; `tools/simcheck.mjs` replays every solution tick by tick and confirms the ring simulation lands exactly where the model says. Levels are tuned by how often a player tapping free buses at random wins (100% early, about 15% on the last levels)
- No ads, no purchases, no tracking, no timers. Progress is saved in localStorage

Built with [three.js](https://threejs.org) r160 (MIT), bundled in `js/lib/`. Vehicles, riders, ring walls, jam tiles and dust are instanced, so a full level is about 60 draw calls. Sounds are synthesised with WebAudio.

## Repo layout
- `site/` the game exactly as published to `fparro-netizen.github.io/bus-jam/`
- `site/js/core.js` rules, level generator, solver, shuffle and sort (no DOM, shared by the game and tools)
- `tools/genlevels.mjs` regenerates `site/js/levels.js` and verifies every level with the solver (`node tools/genlevels.mjs`)
- `tools/icons.cjs` renders `site/icons/icon.svg` to PNG and inlines it as data URIs (apple-touch-icon and manifest icons)
- `test/e2e.cjs <url>` Playwright test in an iPhone 13 viewport: all colours at the start, the ring always moves counter-clockwise (before taps, while boarding and merging, while stuck), streams fill ring gaps, riders board from the ring, touch taps, level complete, stuck -> shuffle rescue, undo, sort, saved progress, offline
- `test/flow.cjs` + `test/flowgif.py` capture a frame sequence with tracked riders' trails (rider-flow.gif)
- `tools/simcheck.mjs` replays every level's solution with the tick-by-tick ring simulation
