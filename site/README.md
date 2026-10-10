# Bus Jam

An original colour-sorting traffic puzzle for iPhone (and any modern browser), drawn in 3D with three.js. Hundreds of riders queue on a horseshoe track at the top; below the parking row sits a big diagonal jam of buses and vans, each with an arrow on its roof. Tap a vehicle whose path is clear: it drives out of the jam, leaving a dust trail, and parks in one of 8 spots (VIP included). Riders of the matching colour file down the chute and board; the badge under each bus counts the seats left. Full buses leave and free their spot. Clear the jam and seat everyone to win.

**Play:** https://fparro-netizen.github.io/bus-jam/ (Safari > Share > Add to Home Screen for full screen and offline play)

- 36 levels: level 1 already has 37 vehicles and ~300 riders; the last levels have 76 to 84 vehicles, 8 colours and up to ~900 riders
- Vans hold 8, buses 16, double-deckers 24; dark '?' vehicles hide their colour until their path is clear
- All 8 parking spots are open from the start
- Free, unlimited boosters: **Shuffle** (re-mixes the colours of vehicles still in the lot among same-size vehicles and re-deals the waiting line into an order that is guaranteed solvable from where you are), **Sort** (moves passengers who fit a parked bus to the front), **Undo** and **Restart**
- No game over: when no move is possible you get a Shuffle / Undo / Restart panel
- Stars: 3 for no boosters, 2 for one or two, 1 otherwise (Undo is free and doesn't count)
- Every level is checked solvable with 8 spots and no boosters by a depth-first solver (`tools/genlevels.mjs`); levels are tuned by how often a simple human-like player wins (100% early, about 30% on the last levels)
- No ads, no purchases, no tracking, no timers. Progress is saved in localStorage

Built with [three.js](https://threejs.org) r160 (MIT), bundled in `js/lib/`. Vehicles, riders, track walls and dust are instanced, so a full level is about 60 draw calls. Sounds are synthesised with WebAudio.
