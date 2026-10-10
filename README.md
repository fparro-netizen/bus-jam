# Bus Jam

An original colour-sorting traffic puzzle for iPhone (and any modern browser). Tap a vehicle whose path is clear: it drives out of the jammed lot around the ring road into one of 8 parking spots, and passengers at the front of the line whose colour matches climb aboard. Full buses leave and free their spot. Clear the lot and seat everyone to win.

**Play:** https://fparro-netizen.github.io/bus-jam/ (Safari > Share > Add to Home Screen for full screen and offline play)

- 36 levels, from 3 cars and 2 colours up to 18 vehicles, 8 colours, cones and 4/6/8/10-seat vehicles
- All 8 parking spots are open from the start
- Free, unlimited boosters: **Shuffle** (re-mixes the colours of vehicles still in the lot among same-size vehicles and re-deals the waiting line into an order that is guaranteed solvable from where you are), **Sort** (moves passengers who fit a parked bus to the front), **Undo** and **Restart**
- No game over: when no move is possible you get a Shuffle / Undo / Restart panel
- Stars: 3 for no boosters, 2 for one or two, 1 otherwise (Undo is free and doesn't count)
- Every level is checked solvable with 8 spots and no boosters by a depth-first solver (`tools/genlevels.mjs`); levels are tuned by how often random play wins (100% early, about 13% on the last levels)
- No ads, no purchases, no tracking, no timers. Progress is saved in localStorage

Built with [three.js](https://threejs.org) r160 (MIT), bundled in `js/lib/`. Sounds are synthesised with WebAudio.

## Repo layout
- `site/` the game exactly as published to `fparro-netizen.github.io/bus-jam/`
- `site/js/core.js` rules, level generator, solver, shuffle and sort (no DOM, shared by the game and tools)
- `tools/genlevels.mjs` regenerates `site/js/levels.js` and verifies every level with the solver (`node tools/genlevels.mjs`)
- `tools/icons.cjs` renders `site/icons/icon.svg` to PNG and inlines it as data URIs (apple-touch-icon and manifest icons)
- `test/e2e.cjs <url>` Playwright test in an iPhone 13 viewport: touch taps, boarding, level complete, stuck -> shuffle rescue, undo, sort, saved progress, offline
