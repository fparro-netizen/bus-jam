// Plays levels with the tick-by-tick ring simulation (as the game does) and checks it settles exactly where the solver's
// macro model says, after every tap. Also plays random taps mid-motion to make sure the simulation always ends won or stuck.
import * as C from '../site/js/core.js';
import { LEVELS } from '../site/js/levels.js';
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : LEVELS.map((_, i) => i);
function settleMicro(s) { let quiet = 0, t = 0; while (quiet < C.RING.rows * 2 + C.DEPART_TICKS && t < 20000) { const ev = C.step(s); t++; quiet = ev.length ? 0 : quiet + 1; } return t; }
const R = C.rng(5); let bad = 0;
for (const i of only) {
  const lv = LEVELS[i]; const sol = C.solve(lv, 300000); if (!sol.solution) { console.log('L' + (i + 1), 'UNSOLVED'); bad++; continue; }
  const s = C.newState(lv); settleMicro(s);
  let mism = 0;
  for (const v of sol.solution) {
    const before = C.toMacro(s); const r = C.tap(s, v, s.tick + 4); if (!r.ok) { console.log('tap fail', i, v, r); bad++; break; }
    const m = C.toMacro(s); // where the macro model says it settles
    settleMicro(s); const m2 = C.toMacro(s);
    const sameCnt = m.cnt.join() === m2.cnt.join() && m.qi.join() === m2.qi.join() && JSON.stringify(m.parked) === JSON.stringify(m2.parked);
    if (!sameCnt) mism++;
  }
  const won = C.isWon(s);
  // random play with taps while the ring is moving
  let rw = 0, rs = 0;
  for (let g = 0; g < 4; g++) {
    const t = C.newState(lv);
    for (let k = 0; k < 200000; k++) {
      if (C.isWon(t)) { rw++; break; } if (C.isStuck(t)) { rs++; break; }
      if (R() < 0.02) { const f = C.freeVehicles(t); if (f.length && C.freeSpot(t) >= 0) C.tap(t, f[Math.floor(R() * f.length)], t.tick + 5); }
      C.step(t);
    }
  }
  console.log('L' + (i + 1), 'veh', lv.vehicles.length, 'riders', C.waiting(C.newState(lv)), 'solverWin', won, 'macroMismatch', mism, 'randomMidMotion won/stuck', rw + '/' + rs);
  if (!won || mism) bad++;
}
console.log(bad ? 'FAILURES ' + bad : 'ALL OK');
process.exit(bad ? 1 : 0);
