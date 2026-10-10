// Bus Jam game rules, level generator, solver and boosters. Pure logic, no DOM: shared by the game and the build/test tools.
// Riders wait in two lines (the left and right arms of the track). The front rider of EITHER line boards a parked bus of their colour.
export const SPOTS = 8;
export const COLORS = ['#22c55e', '#facc15', '#3b82f6', '#ec4899', '#a855f7', '#ef4444', '#2b2f3a', '#22d3ee', '#f97316'];
export const COLOR_NAMES = ['green', 'yellow', 'blue', 'pink', 'purple', 'red', 'black', 'cyan', 'orange'];
export const DIRS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const DIRKEYS = ['N', 'S', 'E', 'W'];

export function rng(seed) {
  let a = seed >>> 0;
  return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ri = (R, a, b) => a + Math.floor(R() * (b - a + 1));
const pick = (R, arr) => arr[Math.floor(R() * arr.length)];
function shuffleArr(R, a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// A vehicle: {x, y} is its FRONT cell, it extends len cells backwards (opposite to dir).
export function cellsOf(v) {
  const [dx, dy] = DIRS[v.dir]; const out = [];
  for (let i = 0; i < v.len; i++) out.push([v.x - dx * i, v.y - dy * i]);
  return out;
}

// ---------- state ----------
export function newState(level) {
  return {
    level,
    inLot: level.vehicles.map(() => true),
    colors: level.vehicles.map(v => v.color),
    queues: [level.queues[0].slice(), level.queues[1].slice()],
    qi: [0, 0],
    parked: new Array(SPOTS).fill(null),
    moves: 0, boosters: 0, shuffles: 0, sorts: 0, undos: 0,
  };
}
export const waiting = s => s.queues[0].length - s.qi[0] + s.queues[1].length - s.qi[1];
export function snapshot(s) {
  return { inLot: s.inLot.slice(), colors: s.colors.slice(), queues: [s.queues[0].slice(), s.queues[1].slice()], qi: s.qi.slice(), parked: s.parked.map(p => p && { vid: p.vid, filled: p.filled }), moves: s.moves };
}
export function restore(s, snap) {
  s.inLot = snap.inLot.slice(); s.colors = snap.colors.slice(); s.queues = [snap.queues[0].slice(), snap.queues[1].slice()]; s.qi = snap.qi.slice();
  s.parked = snap.parked.map(p => p && { vid: p.vid, filled: p.filled }); s.moves = snap.moves;
}

export function grid(s) {
  const { w, h } = s.level; const g = new Int16Array(w * h).fill(-1);
  for (const [x, y] of s.level.blockers) g[y * w + x] = -2;
  s.level.vehicles.forEach((v, i) => { if (s.inLot[i]) for (const [x, y] of cellsOf(v)) g[y * w + x] = i; });
  return g;
}
// returns -1 if the path to the lot edge is clear, otherwise the id of the first obstacle (vehicle id, or -2 for a cone)
export function firstBlocker(s, vid, g = grid(s)) {
  const v = s.level.vehicles[vid]; const { w, h } = s.level; const [dx, dy] = DIRS[v.dir];
  let x = v.x + dx, y = v.y + dy;
  while (x >= 0 && y >= 0 && x < w && y < h) { const c = g[y * w + x]; if (c !== -1) return c; x += dx; y += dy; }
  return -1;
}
export function isFree(s, vid, g) { return s.inLot[vid] && firstBlocker(s, vid, g) === -1; }
export function freeVehicles(s) { const g = grid(s); const out = []; for (let i = 0; i < s.inLot.length; i++) if (s.inLot[i] && firstBlocker(s, i, g) === -1) out.push(i); return out; }
export function freeSpot(s) { return s.parked.indexOf(null); }
export const seatsOf = (s, vid) => s.level.vehicles[vid].seats;

function spotFor(s, c) {
  for (let k = 0; k < SPOTS; k++) { const p = s.parked[k]; if (p && s.colors[p.vid] === c && p.filled < seatsOf(s, p.vid)) return k; }
  return -1;
}
// Board riders from the front of either line into parked buses of the same colour (leftmost bus first).
function resolve(s, events) {
  for (let moved = true; moved;) {
    moved = false;
    for (let a = 0; a < 2; a++) {
      while (s.qi[a] < s.queues[a].length) {
        const c = s.queues[a][s.qi[a]]; const spot = spotFor(s, c); if (spot < 0) break;
        const p = s.parked[spot]; p.filled++; moved = true;
        events && events.push({ type: 'board', arm: a, idx: s.qi[a], color: c, vid: p.vid, spot, filled: p.filled });
        s.qi[a]++;
        if (p.filled >= seatsOf(s, p.vid)) { events && events.push({ type: 'depart', vid: p.vid, spot }); s.parked[spot] = null; }
      }
    }
  }
}

// Tap a vehicle. Returns {ok, events} or {ok:false, reason, blocker}
export function tap(s, vid) {
  if (!s.inLot[vid]) return { ok: false, reason: 'gone' };
  const b = firstBlocker(s, vid);
  if (b !== -1) return { ok: false, reason: 'blocked', blocker: b };
  const spot = freeSpot(s);
  if (spot < 0) return { ok: false, reason: 'full' };
  s.inLot[vid] = false; s.parked[spot] = { vid, filled: 0 }; s.moves++;
  const events = [{ type: 'exit', vid, spot }];
  resolve(s, events);
  return { ok: true, events };
}

export function isWon(s) { return s.inLot.every(x => !x) && s.parked.every(p => !p); }
export function isStuck(s) {
  if (isWon(s)) return false;
  if (freeSpot(s) < 0) return true;
  return freeVehicles(s).length === 0;
}

// ---------- line planning (guarantees a solution) ----------
// From the current position, deal the remaining riders into the two lines so the level can be finished by driving
// vehicles out in a valid order while using at most `slots` parking spots at a time. Riders come in colour waves.
export function planQueues(s, R, slots, gmin, gmax) {
  const lv = s.level; const lot = s.inLot.slice();
  const q = [[], []]; let arm = R() < 0.5 ? 0 : 1;
  const emit = (live, c) => {
    let need = live.filter(p => s.colors[p.vid] === c).reduce((a, p) => a + p.need, 0);
    let g = Math.min(need, ri(R, gmin, gmax));
    for (let i = 0; i < g; i++) q[arm].push(c);
    for (const p of live) { if (!g) break; if (s.colors[p.vid] !== c) continue; const t = Math.min(g, p.need); p.need -= t; g -= t; }
    for (let i = live.length - 1; i >= 0; i--) if (!live[i].need) live.splice(i, 1);
    if (R() < 0.7) arm = 1 - arm;
  };
  const live = s.parked.filter(Boolean).map(p => ({ vid: p.vid, need: seatsOf(s, p.vid) - p.filled }));
  while (live.length) emit(live, s.colors[pick(R, live).vid]); // buses already parked are served first
  for (;;) {
    const lotLeft = lot.some(Boolean);
    if (lotLeft && live.length < slots) {
      const free = freeVehicles({ level: lv, inLot: lot });
      if (!free.length) throw new Error('layout deadlock');
      const vid = pick(R, free); lot[vid] = false; live.push({ vid, need: lv.vehicles[vid].seats });
      continue;
    }
    if (!live.length) break;
    emit(live, s.colors[(R() < 0.55 ? live[0] : pick(R, live)).vid]);
  }
  return q;
}

// ---------- boosters ----------
// Shuffle: swap colours between vehicles still in the lot that have the same seat count (so rider totals still match),
// then re-deal the waiting riders into lines that are guaranteed solvable from here.
export function shuffle(s, seed) {
  const R = rng(seed);
  const groups = {};
  s.inLot.forEach((x, i) => { if (x) (groups[seatsOf(s, i)] ||= []).push(i); });
  for (const k in groups) { const ids = groups[k]; const cols = shuffleArr(R, ids.map(i => s.colors[i])); ids.forEach((i, j) => { s.colors[i] = cols[j]; }); }
  const rest = planQueues(s, R, 4, 4, 16);
  for (let a = 0; a < 2; a++) s.queues[a] = s.queues[a].slice(0, s.qi[a]).concat(rest[a]);
  s.shuffles++; s.boosters++;
  const events = []; resolve(s, events); return events;
}
// Sort: move waiting riders whose colour matches an empty seat in a parked bus to the front of their line.
export function sortQueue(s) {
  const need = {};
  s.parked.forEach(p => { if (p) need[s.colors[p.vid]] = (need[s.colors[p.vid]] || 0) + seatsOf(s, p.vid) - p.filled; });
  for (let a = 0; a < 2; a++) {
    const rest = s.queues[a].slice(s.qi[a]); const front = [], back = [];
    for (const c of rest) { if (need[c] > 0) { front.push(c); need[c]--; } else back.push(c); }
    s.queues[a] = s.queues[a].slice(0, s.qi[a]).concat(front, back);
  }
  s.sorts++; s.boosters++;
  const events = []; resolve(s, events); return events;
}
export function canSort(s) {
  const need = {}; s.parked.forEach(p => { if (p) need[s.colors[p.vid]] = 1; });
  return [0, 1].some(a => s.queues[a].slice(s.qi[a]).some(c => need[c]));
}

// ---------- solver ----------
function key(s) {
  let k = ''; for (let i = 0; i < s.inLot.length; i++) k += s.inLot[i] ? '1' : '0';
  k += '|' + s.qi[0] + ',' + s.qi[1] + '|'; for (const p of s.parked) k += p ? p.vid + ':' + p.filled + ',' : '-,';
  return k;
}
function clone(s) { return { level: s.level, inLot: s.inLot.slice(), colors: s.colors, queues: s.queues, qi: s.qi.slice(), parked: s.parked.map(p => p && { vid: p.vid, filled: p.filled }), moves: s.moves }; }
const nextUse = (s, c) => { let best = 1e9; for (let a = 0; a < 2; a++) { const i = s.queues[a].indexOf(c, s.qi[a]); if (i >= 0) best = Math.min(best, i - s.qi[a]); } return best; };
// Depth-first search over tap orders. Returns the list of vehicle ids to tap, or null.
export function solve(level, maxNodes = 300000, startState) {
  const s0 = startState ? clone(startState) : newState(level);
  const seen = new Set(); let nodes = 0;
  function dfs(s, path) {
    if (isWon(s)) return path;
    if (++nodes > maxNodes) return undefined;
    const k = key(s); if (seen.has(k)) return null; seen.add(k);
    if (freeSpot(s) < 0) return null;
    const free = freeVehicles(s); if (!free.length) return null;
    free.sort((a, b) => nextUse(s, s.colors[a]) - nextUse(s, s.colors[b]));
    for (const vid of free) {
      const t = clone(s); tap(t, vid); path.push(vid);
      const r = dfs(t, path); if (r) return r; if (r === undefined) return undefined;
      path.pop();
    }
    return null;
  }
  const r = dfs(s0, []);
  return { solution: r || null, nodes, aborted: r === undefined };
}
export function randomPlayRate(level, n, R) {
  let wins = 0;
  for (let t = 0; t < n; t++) {
    const s = newState(level);
    for (;;) { if (isWon(s)) { wins++; break; } if (isStuck(s)) break; tap(s, pick(R, freeVehicles(s))); }
  }
  return wins / n;
}
// fraction of games won by a simple human-like player: prefers vehicles whose colour is needed soonest in the visible lines,
// with some random mistakes (difficulty estimate)
export function greedyPlayRate(level, n, R, look = 130, noise = 0.2) {
  let wins = 0;
  for (let t = 0; t < n; t++) {
    const s = newState(level);
    for (;;) {
      if (isWon(s)) { wins++; break; } if (isStuck(s)) break;
      const f = freeVehicles(s); let v;
      if (R() < noise) v = pick(R, f);
      else { let best = 1e9; for (const id of f) { const d = Math.min(nextUse(s, s.colors[id]), look * 10) + R(); if (d < best) { best = d; v = id; } } }
      tap(s, v);
    }
  }
  return wins / n;
}

// ---------- generator ----------
// cfg: {w,h,veh,colors,lens:[[len,seats,weight]...],cones,mystery,slots,gmin,gmax}
export function generate(cfg, seed) {
  const R = rng(seed); const { w, h } = cfg;
  for (let attempt = 0; attempt < 400; attempt++) {
    const g = new Int16Array(w * h).fill(-1); const blockers = [];
    while (blockers.length < (cfg.cones || 0)) {
      const x = ri(R, 0, w - 1), y = ri(R, 1, h - 2); if (g[y * w + x] !== -1) continue;
      g[y * w + x] = -2; blockers.push([x, y]);
    }
    const vehicles = []; let tries = 0;
    const totalW = cfg.lens.reduce((a, l) => a + l[2], 0);
    while (vehicles.length < cfg.veh && tries++ < 20000) {
      let r = R() * totalW, L = cfg.lens[0]; for (const l of cfg.lens) { if ((r -= l[2]) <= 0) { L = l; break; } }
      const dir = pick(R, DIRKEYS); const v = { x: ri(R, 0, w - 1), y: ri(R, 0, h - 1), dir, len: L[0], seats: L[1], color: 0 };
      const cs = cellsOf(v);
      if (cs.some(([x, y]) => x < 0 || y < 0 || x >= w || y >= h || g[y * w + x] !== -1)) continue;
      // its path to the edge must be clear right now: the last vehicle placed can always leave first, so no deadlocks
      const [dx, dy] = DIRS[dir]; let x = v.x + dx, y = v.y + dy, ok = true;
      while (x >= 0 && y >= 0 && x < w && y < h) { if (g[y * w + x] !== -1) { ok = false; break; } x += dx; y += dy; }
      if (!ok) continue;
      for (const [cx, cy] of cs) g[cy * w + cx] = vehicles.length;
      vehicles.push(v);
    }
    if (vehicles.length < cfg.veh * (attempt > 40 ? 0.9 : 1)) continue;
    // colours: every colour used, spread evenly
    const k = cfg.colors; const order = shuffleArr(R, vehicles.map((_, i) => i));
    order.forEach((vi, j) => { vehicles[vi].color = j % k; });
    if (cfg.mystery) vehicles.forEach(v => { if (R() < cfg.mystery) v.m = 1; });
    const level = { w, h, blockers, vehicles, queues: [[], []] };
    level.queues = planQueues(newState(level), R, cfg.slots, cfg.gmin, cfg.gmax);
    return level;
  }
  return null;
}
