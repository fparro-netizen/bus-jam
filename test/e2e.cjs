// End-to-end test in an iPhone 13 viewport: the ring circulates counter-clockwise all the time, streams feed its gaps,
// riders board from the ring, touch taps, level complete, stuck -> shuffle rescue, undo, sort, save, offline.
const { chromium, devices } = require('playwright');
const URL = process.argv[2] || 'http://127.0.0.1:18791/bus-jam/';
const OUT = process.env.OUT || '/workspace/bus-jam/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
// counter-clockwise on screen (x right, z down) <=> cross(r, v) < 0 around the ring centre
function motion(frames, cz) {
  let ccw = 0, cw = 0, still = 0, checked = 0, framePairs = 0; const ex = [];
  for (let f = 1; f < frames.length; f++) { const mb = new Map(frames[f].map(p => [p.pid, p])); const pairs = [];
    for (const p of frames[f - 1]) { const q = mb.get(p.pid); if (q && !p.merging && !q.merging) pairs.push([p, q]); }
    if (!pairs.some(([p, q]) => p.x !== q.x || p.z !== q.z)) continue; // no new frame rendered between these two samples
    framePairs++;
    for (const [p, q] of pairs) { checked++;
      const vx = q.x - p.x, vz = q.z - p.z, rx = p.x, rz = p.z - cz; const cr = rx * vz - rz * vx;
      if (Math.hypot(vx, vz) < 1e-3) still++; else if (cr < 0) ccw++; else { cw++; if (ex.length < 3) ex.push([p, q]); } } }
  return { framePairs, checked, ccw, cw, still, ex };
}
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.BusJam, null, { timeout: 30000 });
  await sleep(1200);
  await page.screenshot({ path: OUT + 'screenshot-title.png' });
  const cdp = await ctx.newCDPSession(page);
  const touch = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(50); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const touchVehicle = async vid => { const p = await page.evaluate(v => BusJam.screenOf(v), vid); await touch(p.x, p.y); };
  const waitSettled = async (ms = 120000) => page.waitForFunction(() => BusJam.settled(), null, { timeout: ms, polling: 100 });
  const cz = await page.evaluate(() => BusJam.ringCentre[1]);
  const sampleRing = async (n, gap) => { const fr = []; for (let i = 0; i < n; i++) { fr.push(await page.evaluate(() => BusJam.ringSamples())); await sleep(gap); } return fr; };

  await page.tap('#btn-play'); await sleep(800);
  ok('play opens level 1', await page.evaluate(() => BusJam.mode === 'play' && document.getElementById('hud-level').textContent === 'Level 1'));
  await page.screenshot({ path: OUT + 'screenshot-level1-start.png' });
  const meta = await page.evaluate(() => ({ spots: BusJam.state.parked.length, vp: [innerWidth, innerHeight], pinch: document.querySelector('meta[name=viewport]').content }));
  ok('8 spots, all open', meta.spots === 8, meta);
  const cinfo = await page.evaluate(() => BusJam.info());
  ok('level 1: big jam, all 9 colours in the jam and among the riders, ring of 80-150 riders', cinfo.vehicles >= 30 && cinfo.colorsInJam === 9 && cinfo.colorsInRiders === 9 && cinfo.ringRiders >= 80 && cinfo.ringRiders <= 150, cinfo);
  // ring circulates before anything is tapped
  const idleFrames = await sampleRing(8, 200); const m0 = motion(idleFrames, cz);
  ok('ring circulates counter-clockwise before any tap', m0.framePairs >= 1 && m0.ccw > 100 && m0.cw === 0 && m0.still === 0, m0);

  await page.evaluate(() => BusJam.setSpeed(2));
  const sol1 = await page.evaluate(() => BusJam.solve().solution);
  const before1 = await page.evaluate(() => ({ ...BusJam.stats(), waiting: BusJam.waitingRiders() }));
  await touchVehicle(sol1[0]); await sleep(100);
  const s1 = await page.evaluate(v => ({ moves: BusJam.state.moves, gone: !BusJam.state.inLot[v] }), sol1[0]);
  ok('touch tap drives a vehicle out', s1.moves === 1 && s1.gone, s1);
  for (const v of sol1.slice(1, 4)) await page.evaluate(v => BusJam.tapVehicle(v), v);
  // sample the ring while buses load and the streams refill it
  const busyFrames = await sampleRing(40, 120); const m1 = motion(busyFrames, cz);
  ok('ring keeps circulating counter-clockwise while riders board and merge (no reverse moves)', m1.framePairs >= 5 && m1.ccw > 1000 && m1.cw === 0 && m1.still === 0, m1);
  await page.evaluate(() => BusJam.setSpeed(8));
  await waitSettled();
  const after1 = await page.evaluate(() => ({ ...BusJam.stats(), waiting: BusJam.waitingRiders(), filled: BusJam.state.parked.map(p => p && p.filled) }));
  ok('riders step off the ring and board parked buses', after1.boards > before1.boards && after1.waiting < before1.waiting, { before: before1, after: after1 });
  const mergedInRing = await page.evaluate(() => BusJam.ringSamples().filter(p => p.pid[0] === 's').length);
  ok('the upper streams feed the gaps in the ring', after1.merges > 0 && after1.streams[0] + after1.streams[1] < before1.streams[0] + before1.streams[1] && mergedInRing > 0, { merges: after1.merges, streamsBefore: before1.streams, streamsAfter: after1.streams, mergedRidersInRing: mergedInRing });
  // blocked vehicle does nothing
  const blocked = await page.evaluate(() => { const s = BusJam.state; const f = BusJam.core.freeVehicles(s); return s.inLot.findIndex((x, i) => x && !f.includes(i)); });
  if (blocked >= 0) { const mv = await page.evaluate(() => BusJam.state.moves); await touchVehicle(blocked); await sleep(200); ok('blocked vehicle stays put', await page.evaluate(([v, mv]) => BusJam.state.inLot[v] && BusJam.state.moves === mv, [blocked, mv])); }
  // finish level 1 with touch taps, letting the ring settle between taps (fast clock: headless rendering is slow)
  await page.evaluate(() => BusJam.setSpeed(24));
  for (const v of sol1.slice(4)) { await waitSettled(); await touchVehicle(v); await sleep(60); }
  await page.waitForSelector('#win:not(.hidden)', { timeout: 300000 });
  await sleep(500); await page.screenshot({ path: OUT + 'screenshot-win.png' });
  const sv = await page.evaluate(() => BusJam.save());
  ok('level 1 completes, 3 stars saved, level 2 unlocked', sv.stars && sv.stars[0] === 3 && sv.unlocked >= 2, sv);
  const mWin = motion(await sampleRing(3, 150), cz);
  ok('ring still circulates on the win screen (empty ring is fine)', mWin.cw === 0, mWin);

  // undo
  await page.evaluate(() => BusJam.setSpeed(8)); await page.tap('#win-next'); await sleep(600);
  const sol2 = await page.evaluate(() => BusJam.solve().solution);
  const pos = () => page.evaluate(() => { const s = BusJam.state; return JSON.stringify([s.inLot, s.qi, s.parked.map(p => p && [p.vid, p.filled]), Array.from(s.ring).filter(c => c >= 0).sort().join('')]); });
  const before = await pos();
  await touchVehicle(sol2[0]); await sleep(200);
  await page.tap('#btn-undo'); await sleep(300);
  ok('undo restores the position', before === await pos());
  await page.tap('#btn-restart'); await sleep(300);
  ok('restart resets', await page.evaluate(() => BusJam.state.moves === 0 && BusJam.state.qi[0] + BusJam.state.qi[1] === 0));

  // mid-level screenshot on a big level
  await page.evaluate(() => BusJam.startLevel(28)); await sleep(700);
  const solM = await page.evaluate(() => BusJam.solve().solution);
  await page.evaluate(() => BusJam.setSpeed(3));
  for (const v of solM.slice(0, 6)) { await page.evaluate(v => BusJam.tapVehicle(v), v); await sleep(100); }
  await page.waitForFunction(() => BusJam.walking() >= 3, null, { timeout: 120000, polling: 50 }).catch(() => {});
  await page.screenshot({ path: OUT + 'screenshot-midlevel.png' });
  await page.evaluate(() => BusJam.setSpeed(8));

  // stuck -> shuffle rescue, on the hardest level: find a tap sequence that gets stuck (solver's settle model)
  await page.evaluate(() => { BusJam.startLevel(35); BusJam.setSpeed(24); }); await sleep(600);
  const seq = await page.evaluate(() => {
    const C = BusJam.core; const lv = BusJam.state.level;
    for (let seed = 1; seed < 500; seed++) { const R = C.rng(seed); const m = C.toMacro(C.newState(lv)); const taps = [];
      for (;;) { if (C.macroWon(m)) break; if (C.freeSpot(m) < 0) return taps; const f = C.freeVehicles(m); const v = f[Math.floor(R() * f.length)]; taps.push(v); C.macroTap(m, v); } }
    return null;
  });
  ok('found a losing tap sequence on level 36', !!seq, seq && seq.length);
  for (const v of seq) { await waitSettled(); await page.evaluate(v => BusJam.tapVehicle(v), v); }
  await page.waitForFunction(() => BusJam.stuckShown(), null, { timeout: 180000, polling: 100 }).catch(() => {});
  const stuckInfo = await page.evaluate(() => ({ shown: BusJam.stuckShown(), stuck: BusJam.core.isStuck(BusJam.state), mode: BusJam.mode, parked: BusJam.state.parked.filter(Boolean).length }));
  ok('stuck panel (shown only after a full turn of the ring) offers shuffle, no game over', stuckInfo.shown && stuckInfo.stuck && stuckInfo.mode === 'play', stuckInfo);
  const mStuck = motion(await sampleRing(8, 200), cz);
  ok('ring still circulates while stuck', mStuck.framePairs >= 1 && mStuck.ccw > 100 && mStuck.cw === 0 && mStuck.still === 0, mStuck);
  await page.screenshot({ path: OUT + 'screenshot-stuck.png' });
  await page.tap('#stuck-shuffle'); await sleep(300);
  const rescue = await page.evaluate(() => { const r = BusJam.solve(true); return { stuck: BusJam.core.isStuck(BusJam.state), solvable: !!r.solution, sol: r.solution, shuffles: BusJam.state.shuffles, panel: BusJam.stuckShown() }; });
  ok('shuffle rescues the stuck position (solver finds a win from here)', !rescue.stuck && rescue.solvable && !rescue.panel, { shuffles: rescue.shuffles, steps: rescue.sol && rescue.sol.length });
  await sleep(500); await page.screenshot({ path: OUT + 'screenshot-after-shuffle.png' });
  for (const v of rescue.sol) { await waitSettled(); await page.evaluate(v => BusJam.tapVehicle(v), v); }
  await page.waitForSelector('#win:not(.hidden)', { timeout: 400000 });
  const sv36 = await page.evaluate(() => BusJam.save());
  ok('finished level 36 after shuffle, 2 stars', sv36.stars[35] === 2, sv36.stars[35]);

  // sort booster
  await page.evaluate(() => BusJam.startLevel(30)); await sleep(500);
  const sortRes = await page.evaluate(() => {
    const C = BusJam.core; const s = BusJam.state;
    for (let k = 0; k < 8; k++) { if (C.canSort(s)) break; const f = C.freeVehicles(s); if (!f.length || C.freeSpot(s) < 0) break; BusJam.tapVehicle(f[f.length - 1]); }
    const can = C.canSort(s); if (!can) return { can };
    BusJam.doSort(); const need = new Set(s.parked.filter(p => p && !p.full).map(p => s.colors[p.vid]));
    return { can, frontsFit: [0, 1].map(a => need.has(s.streams[a][s.qi[a]])), sorts: s.sorts };
  });
  ok('sort booster moves fitting riders to the front of the streams', sortRes.can && sortRes.frontsFit.some(Boolean), sortRes);

  // persistence across reload
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForFunction(() => window.BusJam); await sleep(500);
  const sv2 = await page.evaluate(() => BusJam.save());
  ok('progress persists after reload', sv2.unlocked >= 2 && sv2.stars[0] === 3, { unlocked: sv2.unlocked });
  await page.tap('#btn-levels'); await sleep(400);
  ok('level select shows 36 levels', await page.evaluate(() => document.querySelectorAll('#lv-grid .lv').length) === 36);
  await page.screenshot({ path: OUT + 'screenshot-levels.png' });

  // offline
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  const swOk = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' }).catch(e => errors.push('offline reload: ' + e.message));
  const off = await page.waitForFunction(() => window.BusJam, null, { timeout: 15000 }).then(() => true).catch(() => false);
  if (off) { await page.evaluate(() => BusJam.startLevel(0)); await sleep(500); }
  ok('works offline (service worker)', swOk && off && await page.evaluate(() => BusJam.mode === 'play').catch(() => false), { swOk });
  await ctx.setOffline(false);

  ok('no console errors', errors.length === 0, errors.slice(0, 5));
  console.log('SUMMARY', results.filter(r => r.pass).length + '/' + results.length);
  await browser.close();
  process.exit(results.every(r => r.pass) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
