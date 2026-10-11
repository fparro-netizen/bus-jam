// Bus Jam game rules, level generator, solver and boosters. Pure logic, no DOM: shared by the game and the build/test tools.
//
// Riders: a big closed RING in the middle keeps circulating counter-clockwise (as seen on screen), one row per tick.
// Two upper STREAMS queue more riders; when an empty place in the ring passes a stream's join point, the stream's front
// rider steps in. As ring riders pass a parked bus of their colour with free seats, they step off and board it.
// v5: riders travel in ROWS OF 4 abreast. Every ring row and every stream row is one colour, merges fill a whole empty
// ring row, and a row boards a parked bus of its colour all together (seat counts are multiples of 4).
// The micro simulation (step) is what the game runs; the solver uses an exact "macro" model of where the micro simulation
// settles after each tap (ring order doesn't matter for that, only the colour counts and the stream merge order do).
export const SPOTS = 8;
export const COLORS = ['#22c55e', '#facc15', '#3b82f6', '#ec4899', '#a855f7', '#ef4444', '#2b2f3a', '#22d3ee', '#f97316'];
export const COLOR_NAMES = ['green', 'yellow', 'blue', 'pink', 'purple', 'red', 'black', 'cyan', 'orange'];
export const DIRS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const DIRKEYS = ['N', 'S', 'E', 'W'];

// ---------- ring geometry (shared with the renderer; world units, x right, z down the screen) ----------
export const RING = { a: 2.4, R: 2.0, cz: -10.0, rows: 50, lanes: [-0.45, -0.15, 0.15, 0.45] };
export const LANES_N = RING.lanes.length, CAP = RING.rows * LANES_N, ROW = LANES_N; // ROW = riders per row (4)
export const RING_LEN = 4 * RING.a + 2 * Math.PI * RING.R;
export const TICK_RATE = 6;               // ring rows advanced per second
export const SPOT_W = 1.25, SPOT_N = -7.0;
export const spotX = k => (k - 3.5) * SPOT_W;
// point at arc length u along the ring centre line, counter-clockwise on screen starting at the bottom centre;
// off = lateral offset (+ = outside). Returns [x, z, tx, tz] (tangent = direction of travel)
export function ringPoint(u, off = 0) {
  const { a, R, cz } = RING; const P = RING_LEN; u = ((u % P) + P) % P;
  let x, z, nx, nz, tx, tz;
  if (u < a) { x = u; z = cz + R; nx = 0; nz = 1; tx = 1; tz = 0; }
  else if (u < a + Math.PI * R) { const g = (u - a) / R; x = a + R * Math.sin(g); z = cz + R * Math.cos(g); nx = Math.sin(g); nz = Math.cos(g); tx = Math.cos(g); tz = -Math.sin(g); }
  else if (u < 3 * a + Math.PI * R) { x = a - (u - a - Math.PI * R); z = cz - R; nx = 0; nz = -1; tx = -1; tz = 0; }
  else if (u < 3 * a + 2 * Math.PI * R) { const g = (u - 3 * a - Math.PI * R) / R; x = -a - R * Math.sin(g); z = cz - R * Math.cos(g); nx = -Math.sin(g); nz = -Math.cos(g); tx = -Math.cos(g); tz = Math.sin(g); }
  else { x = -a + (u - 3 * a - 2 * Math.PI * R); z = cz + R; nx = 0; nz = 1; tx = 1; tz = 0; }
  return [x + nx * off, z + nz * off, tx, tz];
}
export const cellU = c => c * RING_LEN / RING.rows;
// the ring cell where riders step off for each parking spot: the nearest cell on the bottom half of the ring
export const BOARD_CELL = Array.from({ length: SPOTS }, (_, k) => {
  let best = 0, bd = 1e9;
  for (let c = 0; c < RING.rows; c++) { const [x, z] = ringPoint(cellU(c)); if (z < RING.cz - 1e-6) continue; const d = Math.hypot(x - spotX(k), z - SPOT_N); if (d < bd) { bd = d; best = c; } }
  return best;
});
// join cells for the two streams (0 = left, 1 = right), near the top of each end of the ring
export const STREAM_X = 2.9;
export const JOIN_CELL = [-1, 1].map(side => {
  let best = 0, bd = 1e9;
  for (let c = 0; c < RING.rows; c++) { const [x, z] = ringPoint(cellU(c)); if (z > RING.cz) continue; const d = Math.abs(x - side * STREAM_X) + (z > RING.cz - RING.R * 0.5 ? 5 : 0); if (d < bd) { bd = d; best = c; } }
  return best;
});
export const DEPART_TICKS = 7;

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
    ring: Int8Array.from(level.ring),  // slot = row*LANES_N + lane, -1 = empty; row r sits at cell (r + rot) % rows
    rot: 0, tick: 0,
    streams: [level.streams[0].slice(), level.streams[1].slice()],
    qi: [0, 0],
    parked: new Array(SPOTS).fill(null), // {vid, filled, ready (tick), full, freeAt}
    moves: 0, boosters: 0, shuffles: 0, sorts: 0, undos: 0, boards: 0, merges: 0,
  };
}
export const ringCount = s => { let n = 0; for (const c of s.ring) if (c >= 0) n++; return n; };
export const streamLeft = (s, a) => s.streams[a].length - s.qi[a];
export const waiting = s => ringCount(s) + streamLeft(s, 0) + streamLeft(s, 1);
export function snapshot(s) {
  return { inLot: s.inLot.slice(), colors: s.colors.slice(), ring: Int8Array.from(s.ring), rot: s.rot, streams: [s.streams[0].slice(), s.streams[1].slice()], qi: s.qi.slice(),
    parked: s.parked.map(p => p && !p.full ? { vid: p.vid, filled: p.filled } : null), moves: s.moves };
}
export function restore(s, snap) {
  s.inLot = snap.inLot.slice(); s.colors = snap.colors.slice(); s.streams = [snap.streams[0].slice(), snap.streams[1].slice()]; s.qi = snap.qi.slice();
  // keep the ring's current rotation so it doesn't jump: put each rider back into the same ring cell it was in
  const d = ((s.rot - snap.rot) % RING.rows + RING.rows) % RING.rows; const ring = new Int8Array(CAP).fill(-1);
  for (let r = 0; r < RING.rows; r++) for (let l = 0; l < LANES_N; l++) ring[r * LANES_N + l] = snap.ring[((r + d) % RING.rows) * LANES_N + l];
  s.ring = ring;
  s.parked = snap.parked.map(p => p && { vid: p.vid, filled: p.filled, ready: 0, full: false, freeAt: 0 }); s.moves = snap.moves;
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

// Tap a vehicle: it drives to the leftmost free spot and can take riders from tick `ready` on.
export function tap(s, vid, ready = s.tick) {
  if (!s.inLot[vid]) return { ok: false, reason: 'gone' };
  const b = firstBlocker(s, vid);
  if (b !== -1) return { ok: false, reason: 'blocked', blocker: b };
  const spot = freeSpot(s);
  if (spot < 0) return { ok: false, reason: 'full' };
  s.inLot[vid] = false; s.parked[spot] = { vid, filled: 0, ready, full: false, freeAt: 0 }; s.moves++;
  return { ok: true, events: [{ type: 'exit', vid, spot }] };
}

// stream merge rule: the longer stream goes first (ties: the right stream). Timing-independent, so the solver knows the order.
const mergeTurn = (l0, l1) => (l1 > 0 && l1 >= l0) ? 1 : l0 > 0 ? 0 : -1;

// One tick: the ring advances one row, riders board at the spots they pass, gaps at the join points fill from the streams.
export function step(s) {
  const ev = []; const rows = RING.rows;
  s.tick++; s.rot = (s.rot + 1) % rows;
  for (let k = 0; k < SPOTS; k++) { const p = s.parked[k]; if (p && p.full && s.tick >= p.freeAt) { s.parked[k] = null; ev.push({ type: 'freed', spot: k }); } }
  for (let k = 0; k < SPOTS; k++) {
    const p = s.parked[k]; if (!p || p.full || s.tick < p.ready) continue;
    const c = s.colors[p.vid], seats = seatsOf(s, p.vid); const r = ((BOARD_CELL[k] - s.rot) % rows + rows) % rows;
    // the whole row of 4 steps off together when it's all this bus's colour and the bus has a free row of seats
    if (seats - p.filled < ROW) continue;
    let all = true; for (let l = 0; l < LANES_N; l++) if (s.ring[r * LANES_N + l] !== c) { all = false; break; }
    if (!all) continue;
    p.filled += ROW; s.boards += ROW; s.rowBoards = (s.rowBoards || 0) + 1;
    for (let l = 0; l < LANES_N; l++) { const slot = r * LANES_N + l; s.ring[slot] = -1; ev.push({ type: 'board', spot: k, vid: p.vid, slot, color: c, filled: p.filled, lane: l }); }
    if (p.filled >= seats) { p.full = true; p.freeAt = s.tick + DEPART_TICKS; ev.push({ type: 'depart', vid: p.vid, spot: k }); }
  }
  for (const a of [1, 0]) {
    const r = ((JOIN_CELL[a] - s.rot) % rows + rows) % rows;
    // a whole row of 4 steps into a completely empty ring row
    let empty = true; for (let l = 0; l < LANES_N; l++) if (s.ring[r * LANES_N + l] !== -1) { empty = false; break; }
    if (!empty || mergeTurn(streamLeft(s, 0), streamLeft(s, 1)) !== a) continue;
    for (let l = 0; l < LANES_N; l++) {
      const slot = r * LANES_N + l; const c = s.streams[a][s.qi[a]]; s.ring[slot] = c; ev.push({ type: 'merge', arm: a, idx: s.qi[a], slot, color: c }); s.qi[a]++; s.merges++;
    }
  }
  return ev;
}

export function isWon(s) { return s.inLot.every(x => !x) && s.parked.every(p => !p) && waiting(s) === 0; }
// Stuck: every spot holds a bus that still needs riders, and no rider in the ring (or able to enter it) fits any of them.
export function isStuck(s) {
  if (isWon(s)) return false;
  if (s.parked.some(p => !p || p.full)) return false;
  const need = new Set(s.parked.map(p => s.colors[p.vid]));
  for (const c of s.ring) if (c >= 0 && need.has(c)) return false;
  if (ringCount(s) < CAP && (streamLeft(s, 0) || streamLeft(s, 1))) return false;
  return true;
}

// ---------- macro model (exact settle-point of the micro simulation, used by the solver and generator) ----------
export function toMacro(s) {
  const cnt = new Array(COLORS.length).fill(0); for (const c of s.ring) if (c >= 0) cnt[c]++;
  const m = { level: s.level, inLot: s.inLot.slice(), colors: s.colors, cnt, streams: s.streams, qi: s.qi.slice(), parked: s.parked.map(p => p && !p.full ? { vid: p.vid, filled: p.filled } : null) };
  settle(m); return m;
}
export function settle(m) {
  for (;;) {
    let changed = false;
    for (let k = 0; k < SPOTS; k++) {
      const p = m.parked[k]; if (!p) continue; const c = m.colors[p.vid], seats = m.level.vehicles[p.vid].seats;
      const t = Math.min(seats - p.filled, m.cnt[c]); if (t > 0) { m.cnt[c] -= t; p.filled += t; changed = true; }
      if (p.filled >= seats) m.parked[k] = null;
    }
    let n = 0; for (const x of m.cnt) n += x; let gaps = CAP - n;
    while (gaps > 0) {
      const a = mergeTurn(m.streams[0].length - m.qi[0], m.streams[1].length - m.qi[1]); if (a < 0 || gaps < ROW) break;
      for (let l = 0; l < ROW; l++) m.cnt[m.streams[a][m.qi[a]++]]++; gaps -= ROW; changed = true;
    }
    if (!changed) return m;
  }
}
export function macroTap(m, vid) { mTap(m, vid); }
export const macroWon = m => mWon(m);
function mTap(m, vid) { const k = m.parked.indexOf(null); m.inLot[vid] = false; m.parked[k] = { vid, filled: 0 }; settle(m); }
const mClone = m => ({ level: m.level, inLot: m.inLot.slice(), colors: m.colors, cnt: m.cnt.slice(), streams: m.streams, qi: m.qi.slice(), parked: m.parked.map(p => p && { vid: p.vid, filled: p.filled }) });
const mWon = m => m.inLot.every(x => !x) && m.parked.every(p => !p);
function mKey(m) { let k = ''; for (let i = 0; i < m.inLot.length; i++) k += m.inLot[i] ? '1' : '0'; k += '|' + m.qi[0] + ',' + m.qi[1] + '|'; for (const p of m.parked) k += p ? p.vid + ':' + p.filled + ',' : '-,'; return k; }
// how useful driving vehicle vid out now looks: riders of its colour available in the ring (and next in the streams)
function mScore(m, vid) {
  const c = m.colors[vid], seats = m.level.vehicles[vid].seats; let soon = 0;
  for (let a = 0; a < 2; a++) for (let i = m.qi[a]; i < Math.min(m.streams[a].length, m.qi[a] + 24); i++) if (m.streams[a][i] === c) soon++;
  return Math.min(seats, m.cnt[c]) * 4 + Math.min(seats, soon) - seats * 0.05;
}

// ---------- solver ----------
// Depth-first search over tap orders on the macro model. Returns the list of vehicle ids to tap (waiting for the ring to
// settle between taps), or null.
export function solve(level, maxNodes = 300000, startState) {
  const m0 = startState ? toMacro(startState) : toMacro(newState(level));
  const seen = new Set(); let nodes = 0;
  function dfs(m, path) {
    if (mWon(m)) return path;
    if (++nodes > maxNodes) return undefined;
    const k = mKey(m); if (seen.has(k)) return null; seen.add(k);
    if (m.parked.indexOf(null) < 0) return null;
    const free = freeVehicles(m); if (!free.length) return null;
    const sc = new Map(free.map(v => [v, mScore(m, v)])); free.sort((a, b) => sc.get(b) - sc.get(a));
    for (const vid of free) {
      const t = mClone(m); mTap(t, vid); path.push(vid);
      const r = dfs(t, path); if (r) return r; if (r === undefined) return undefined;
      path.pop();
    }
    return null;
  }
  const r = dfs(m0, []);
  return { solution: r || null, nodes, aborted: r === undefined };
}
// fraction of games won by a simple human-like player (difficulty estimate): drives out the free vehicle whose colour is
// best represented in the ring, with some random mistakes
export function greedyPlayRate(level, n, R, noise = 0.25) {
  let wins = 0;
  for (let t = 0; t < n; t++) {
    const m = toMacro(newState(level));
    for (;;) {
      if (mWon(m)) { wins++; break; }
      if (m.parked.indexOf(null) < 0) break;
      const f = freeVehicles(m); let v;
      if (R() < noise) v = pick(R, f); else { let best = -1e9; for (const id of f) { const d = mScore(m, id) + R() * 2; if (d > best) { best = d; v = id; } } }
      mTap(m, v);
    }
  }
  return wins / n;
}

// ---------- rider planning (guarantees a solution) ----------
// Deal the riders for the buses still to be served into one sequence of colour blocks, such that serving them in order
// needs at most `slots` buses parked at once.
export function planSequence(st, R, slots, gmin, gmax, have = null, focus = 0) {
  const lv = st.level; const lot = st.inLot.slice(); const seq = [];
  const rest = have ? have.slice() : null; // colours already in the ring: counted against needs first
  const emit = (live, c) => {
    let need = live.filter(p => st.colors[p.vid] === c).reduce((a, p) => a + p.need, 0);
    let g = Math.min(need, Math.max(ROW, ROW * Math.round(ri(R, gmin, gmax) / ROW))); /* whole rows of 4 */ let fromRing = rest ? Math.min(g, rest[c]) : 0; if (rest) rest[c] -= fromRing;
    for (let i = fromRing; i < g; i++) seq.push(c);
    for (const p of live) { if (!g) break; if (st.colors[p.vid] !== c) continue; const t = Math.min(g, p.need); p.need -= t; g -= t; }
    for (let i = live.length - 1; i >= 0; i--) if (!live[i].need) live.splice(i, 1);
  };
  const live = st.parked.filter(p => p && !p.full).map(p => ({ vid: p.vid, need: seatsOf(st, p.vid) - p.filled }));
  while (live.length) emit(live, st.colors[pick(R, live).vid]);
  for (;;) {
    const lotLeft = lot.some(Boolean);
    if (lotLeft && live.length < slots) {
      const free = freeVehicles({ level: lv, inLot: lot });
      if (!free.length) throw new Error('layout deadlock');
      // focus: keep drawing buses of the colours already in play, so the ring fills with big blocks of just a few colours
      const recent = new Set(live.map(p => st.colors[p.vid]).concat(seq.slice(-60)));
      const pref = focus && R() < focus ? free.filter(v => recent.has(st.colors[v])) : [];
      const vid = pick(R, pref.length ? pref : free); lot[vid] = false; live.push({ vid, need: lv.vehicles[vid].seats });
      continue;
    }
    if (!live.length) break;
    emit(live, st.colors[(R() < 0.55 ? live[0] : pick(R, live)).vid]);
  }
  return seq;
}
// split a sequence into its colour blocks and hand the blocks alternately to the two streams
function dealStreams(seq, R) {
  const blocks = []; for (const c of seq) { const b = blocks[blocks.length - 1]; if (b && b[0] === c && b.length < 24) b.push(c); else blocks.push([c]); }
  const st = [[], []]; let a = R() < 0.5 ? 0 : 1;
  for (const b of blocks) { st[a].push(...b); if (b.length >= 12 || R() < 0.5) a = 1 - a; }
  return st;
}

// ---------- boosters ----------
// Shuffle: swap colours between vehicles still in the lot that have the same seat count (rider totals still match) and
// re-mix the riders. Every candidate is checked with the solver. Light shuffles only re-mix the streams; if that isn't
// enough (e.g. the ring is full of colours no parked bus wants), all waiting riders, ring included, are re-dealt from a plan
// that serves the parked buses first, so play can always continue to a win.
export function shuffle(s, seed) {
  const R = rng(seed); const orig = s.colors.slice(), origStreams = [s.streams[0].slice(), s.streams[1].slice()], origRing = Int8Array.from(s.ring);
  const groups = {}; s.inLot.forEach((x, i) => { if (x) (groups[seatsOf(s, i)] ||= []).push(i); });
  const setStreams = f => { s.streams = [origStreams[0].slice(0, s.qi[0]).concat(f[0]), origStreams[1].slice(0, s.qi[1]).concat(f[1])]; };
  const tryIt = (how, slots) => {
    s.colors = orig.slice(); s.ring = Int8Array.from(origRing);
    for (const k in groups) { const ids = groups[k]; const cols = shuffleArr(R, ids.map(i => orig[i])); ids.forEach((i, j) => { s.colors[i] = cols[j]; }); }
    if (how === 'streams') {
      const rest = origStreams[0].slice(s.qi[0]).concat(origStreams[1].slice(s.qi[1]));
      setStreams(dealStreams(shuffleArr(R, rest).sort((a, b) => a - b), R));
    } else {
      s.streams = [origStreams[0].slice(0, s.qi[0]), origStreams[1].slice(0, s.qi[1])];
      const seq = planSequence(s, R, slots, 12, 24); let i = 0;
      for (let k = 0; k < CAP; k++) if (s.ring[k] >= 0) s.ring[k] = seq[i++];
      const rest = seq.slice(i);
      if (how === 'blocks') setStreams(dealStreams(rest, R));
      else { // exact: the streams will merge in exactly the planned order
        const f = [[], []]; const tot = [Math.floor(rest.length / 2), Math.ceil(rest.length / 2)];
        const half = Math.floor(rest.length / ROW / 2) * ROW; tot[0] = half; tot[1] = rest.length - half;
        for (let i = 0; i < rest.length; i += ROW) { const a = mergeTurn(tot[0] - f[0].length, tot[1] - f[1].length); f[a].push(...rest.slice(i, i + ROW)); }
        setStreams(f);
      }
    }
    return !!solve(s.level, 30000, s).solution;
  };
  let ok = false;
  for (let i = 0; i < 4 && !ok; i++) ok = tryIt('streams');
  for (let i = 0; i < 12 && !ok; i++) ok = tryIt('blocks', i < 6 ? 5 : 3);
  for (let i = 0; i < 12 && !ok; i++) ok = tryIt('exact', i < 4 ? 4 : 2);
  if (!ok) { s.colors = orig; s.streams = origStreams; s.ring = origRing; }
  s.shuffles++; s.boosters++;
  return ok;
}
// Sort: riders in the streams whose colour fits an empty seat in a parked bus move to the front of their stream.
export function sortQueue(s) {
  const need = {};
  s.parked.forEach(p => { if (p && !p.full) need[s.colors[p.vid]] = (need[s.colors[p.vid]] || 0) + seatsOf(s, p.vid) - p.filled; });
  for (const c of s.ring) if (c >= 0 && need[c] > 0) need[c]--;
  for (let a = 0; a < 2; a++) {
    const rest = s.streams[a].slice(s.qi[a]); const front = [], back = [];
    for (let i = 0; i < rest.length; i += ROW) { const row = rest.slice(i, i + ROW), c = row[0]; if (need[c] >= ROW) { front.push(...row); need[c] -= ROW; } else back.push(...row); }
    s.streams[a] = s.streams[a].slice(0, s.qi[a]).concat(front, back);
  }
  s.sorts++; s.boosters++;
}
export function canSort(s) {
  const need = {}; s.parked.forEach(p => { if (p && !p.full) need[s.colors[p.vid]] = 1; });
  return [0, 1].some(a => s.streams[a].slice(s.qi[a]).some(c => need[c]));
}

// ---------- generator ----------
// fun jam outlines, tested in screen space (the lot is drawn turned 45 degrees). u right, v down, both about -1..1
export const SHAPES = {
  diamond: () => true,
  heart: (u, v) => { const x = u * 1.72, y = -v * 1.72 + 0.3; const q = x * x + y * y - 1; return q * q * q - x * x * y * y * y <= 0; },
  circle: (u, v) => u * u + v * v <= 0.5,
  hexagon: (u, v) => Math.abs(v) <= 0.6 && Math.abs(u) * 0.866 + Math.abs(v) * 0.5 <= 0.62,
  butterfly: (u, v) => { const c = (x, y, r) => (u - x) ** 2 + (v - y) ** 2 <= r * r; return c(-0.33, -0.08, 0.34) || c(0.33, -0.08, 0.34) || c(-0.24, 0.3, 0.24) || c(0.24, 0.3, 0.24) || (Math.abs(u) < 0.09 && Math.abs(v) < 0.55); },
};
export function maskOf(w, h, shape) {
  const f = SHAPES[shape] || SHAPES.diamond; const m = new Uint8Array(w * h); const D = (w + h) / 2 / Math.SQRT2 * 0.98;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const lx = x + 0.5 - w / 2, lz = y + 0.5 - h / 2; const u = (lx + lz) / Math.SQRT2 / D, v = (lz - lx) / Math.SQRT2 / D; m[y * w + x] = f(u, v) ? 1 : 0; }
  return m;
}
// cfg: {w,h,shape,veh,colors,lens:[[len,seats,weight]...],mystery,slots,gmin,gmax}
export function generate(cfg, seed) {
  const R = rng(seed); const { w, h } = cfg; const mask = maskOf(w, h, cfg.shape);
  for (let attempt = 0; attempt < 400; attempt++) {
    const g = new Int16Array(w * h).fill(-1); const blockers = [];
    const vehicles = []; let tries = 0;
    const totalW = cfg.lens.reduce((a, l) => a + l[2], 0);
    while (vehicles.length < cfg.veh && tries++ < 30000) {
      let r = R() * totalW, L = cfg.lens[0]; for (const l of cfg.lens) { if ((r -= l[2]) <= 0) { L = l; break; } }
      const dir = pick(R, DIRKEYS); const v = { x: ri(R, 0, w - 1), y: ri(R, 0, h - 1), dir, len: L[0], seats: L[1], color: 0 };
      const cs = cellsOf(v);
      if (cs.some(([x, y]) => x < 0 || y < 0 || x >= w || y >= h || g[y * w + x] !== -1 || !mask[y * w + x])) continue;
      // its path to the edge must be clear right now: the last vehicle placed can always leave first, so no deadlocks
      const [dx, dy] = DIRS[dir]; let x = v.x + dx, y = v.y + dy, ok = true;
      while (x >= 0 && y >= 0 && x < w && y < h) { if (g[y * w + x] !== -1) { ok = false; break; } x += dx; y += dy; }
      if (!ok) continue;
      for (const [cx, cy] of cs) g[cy * w + cx] = vehicles.length;
      vehicles.push(v);
    }
    if (vehicles.length < cfg.veh * (attempt > 40 ? 0.9 : 1)) continue;
    const k = cfg.colors; const order = shuffleArr(R, vehicles.map((_, i) => i));
    order.forEach((vi, j) => { vehicles[vi].color = j % k; });
    if (cfg.mystery) vehicles.forEach(v => { if (R() < cfg.mystery) v.m = 1; });
    const level = { w, h, shape: cfg.shape || 'diamond', blockers, vehicles, ring: [], streams: [[], []] };
    const seq = planSequence({ level, inLot: vehicles.map(() => true), colors: vehicles.map(v => v.color), parked: [] }, R, cfg.slots, cfg.gmin, cfg.gmax, null, cfg.focus || 0);
    const ringN = Math.floor(Math.min(CAP, seq.length - 40) / ROW) * ROW;
    // ring rows are listed so that higher rows are further ahead; the first riders of the plan sit nearest the spots
    const ring = new Array(CAP).fill(-1); const head = seq.slice(0, ringN);
    for (let i = 0; i < ringN; i++) ring[i] = head[i];
    level.ring = ring; level.streams = dealStreams(seq.slice(ringN), R);
    return level;
  }
  return null;
}
