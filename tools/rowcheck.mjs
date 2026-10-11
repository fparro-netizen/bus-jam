// v5 checks: riders in uniform rows of 4 everywhere, seats multiples of 4, colour totals = seats, run lengths, and that
// Shuffle from stuck positions always yields a solvable, still row-aligned position.
import * as C from '../site/js/core.js';
import { LEVELS } from '../site/js/levels.js';
let bad = 0; const runs = [];
const rowsOk = (arr, from = 0) => { for (let i = from; i < arr.length; i += 4) { const r = arr.slice(i, i + 4); if (r.length !== 4 || r.some(c => c !== r[0])) return false; } return true; };
const ringOk = ring => { for (let r = 0; r < C.RING.rows; r++) { const row = Array.from(ring.slice(r * 4, r * 4 + 4)); if (row.some(c => c !== row[0])) return false; } return true; };
const settle = s => { let q = 0, t = 0; while (q < C.RING.rows * 2 + C.DEPART_TICKS && t < 20000) { const ev = C.step(s); t++; q = ev.length ? 0 : q + 1; for (const p of s.parked) if (p && p.filled % 4) throw new Error('partial row'); if (!ringOk(s.ring)) throw new Error('ring row split'); } };
const R = C.rng(9); let shuffles = 0, shuffleOk = 0;
LEVELS.forEach((lv, i) => {
  const tot = new Array(9).fill(0), seats = new Array(9).fill(0);
  for (const c of lv.ring) if (c >= 0) tot[c]++; for (const q of lv.streams) for (const c of q) tot[c]++;
  for (const v of lv.vehicles) { seats[v.color] += v.seats; if (v.seats % 4) { bad++; console.log('L' + (i + 1), 'seats not x4', v.seats); } }
  if (tot.join() !== seats.join()) { bad++; console.log('L' + (i + 1), 'totals', tot, seats); }
  if (!ringOk(lv.ring) || !lv.streams.every(q => rowsOk(q))) { bad++; console.log('L' + (i + 1), 'rows not uniform'); }
  for (const q of lv.streams) { let n = 1; for (let k = 1; k <= q.length; k++) { if (k < q.length && q[k] === q[k - 1]) n++; else { runs.push(n); n = 1; } } }
  // play random taps until stuck, then shuffle and check the solver finds a win and rows are intact
  for (let t = 0; t < 3; t++) {
    const s = C.newState(lv); settle(s);
    for (let g = 0; g < 200 && !C.isWon(s) && !C.isStuck(s); g++) { const f = C.freeVehicles(s); if (!f.length || C.freeSpot(s) < 0) break; C.tap(s, f[Math.floor(R() * f.length)], s.tick); settle(s); }
    if (!C.isStuck(s)) continue;
    shuffles++; const ok = C.shuffle(s, 1234 + t + i * 10);
    const aligned = ringOk(s.ring) && [0, 1].every(a => rowsOk(s.streams[a], s.qi[a]));
    const sol = C.solve(lv, 300000, s).solution;
    if (ok && aligned && sol) shuffleOk++; else { bad++; console.log('L' + (i + 1), 'shuffle', { ok, aligned, sol: !!sol }); }
  }
});
runs.sort((a, b) => a - b);
console.log('stream colour runs (riders): min', runs[0], 'median', runs[runs.length >> 1], 'all multiples of 4:', runs.every(r => r % 4 === 0), 'share 12-24+:', (runs.filter(r => r >= 12).length / runs.length).toFixed(2));
console.log('shuffles from stuck positions', shuffles, 'solvable+aligned', shuffleOk);
console.log(bad ? 'FAILURES ' + bad : 'ALL OK');
