// End-to-end test in an iPhone 13 viewport: touch taps, boarding, level complete, stuck -> shuffle rescue, undo, sort, save, offline.
const { chromium, devices } = require('playwright');
const URL = process.argv[2] || 'http://127.0.0.1:18791/bus-jam/';
const OUT = process.env.OUT || '/workspace/bus-jam/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); };
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
  await page.evaluate(() => BusJam.startLevel(0)); await sleep(800); await page.screenshot({ path: OUT + 'screenshot-level1-start.png' }); await page.evaluate(() => { document.getElementById('lv-back').click(); });
  // headless Chromium renders with a slow software GPU, so run the game clock faster (animation timing only)
  await page.evaluate(() => BusJam.setSpeed(8));
  const cdp = await ctx.newCDPSession(page);
  const touch = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(50); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const touchVehicle = async vid => { const p = await page.evaluate(v => BusJam.screenOf(v), vid); await touch(p.x, p.y); };
  const waitIdle = async (ms = 120000) => page.waitForFunction(() => BusJam.isIdle(), null, { timeout: ms });

  await page.tap('#btn-play'); await sleep(800);
  ok('play opens level 1', await page.evaluate(() => BusJam.mode === 'play' && document.getElementById('hud-level').textContent === 'Level 1'));
  const meta = await page.evaluate(() => ({ spots: BusJam.state.parked.length, vp: [innerWidth, innerHeight], pinch: document.querySelector('meta[name=viewport]').content }));
  ok('8 spots, all open', meta.spots === 8, meta);
  const cinfo = await page.evaluate(() => BusJam.info());
  ok('level 1 starts with all 9 colours in the jam and in the rider lines', cinfo.colorsInJam === 9 && cinfo.colorsInRiders === 9, cinfo);
  const sol1 = await page.evaluate(() => BusJam.solve().solution);
  const peopleBefore = await page.evaluate(() => BusJam.waitingRiders());
  // rider flow: sample every rider at real speed before/while the first bus loads; each sample-to-sample step must be forward only
  await page.evaluate(() => BusJam.setSpeed(1));
  const frames = [await page.evaluate(() => BusJam.riderSamples(400))];
  await touchVehicle(sol1[0]);
  for (let i = 0; i < 40; i++) { await sleep(120); frames.push(await page.evaluate(() => BusJam.riderSamples(400))); }
  await page.evaluate(() => BusJam.setSpeed(8)); await sleep(300);
  let down = 0, toward = 0, bad = 0, checked = 0; const badEx = [];
  for (let f = 1; f < frames.length; f++) for (let a = 0; a < 2; a++) { const mb = new Map(frames[f][a].map(p => [p.pid, p])); for (const p of frames[f - 1][a]) { const q = mb.get(p.pid); if (!q) continue; checked++;
    const dx = q.x - p.x, dz = q.z - p.z; const onArm = p.z < -10.7 && q.z < -10.7;
    if (onArm) { if (dz > 0.005) down++; if (dz < -0.005 || Math.abs(dx) > 0.01) { bad++; badEx.push([p, q]); } }
    else { if (Math.abs(q.x) < Math.abs(p.x) - 0.005) toward++; if (Math.abs(q.x) > Math.abs(p.x) + 0.01) { bad++; badEx.push([p, q]); } } } }
  ok('riders flow down the arms toward the exit, no sideways/backward/spinning moves', down > 50 && bad === 0, { samples: frames.length, checked, movedDown: down, movedToCentre: toward, bad, ex: badEx.slice(0, 2) });
  const s1 = await page.evaluate(v => ({ moves: BusJam.state.moves, gone: !BusJam.state.inLot[v] }), sol1[0]);
  ok('touch tap drives a vehicle out', s1.moves === 1 && s1.gone, s1);
  await waitIdle();
  const s2 = await page.evaluate(() => ({ qi: BusJam.state.qi, people: BusJam.waitingRiders(), seatsLeftBadge: BusJam.state.parked.filter(Boolean).length }));
  ok('passengers boarded', s2.qi[0] + s2.qi[1] > 0 && s2.people < peopleBefore, { before: peopleBefore, ...s2 });
  // blocked vehicle does nothing
  const blocked = await page.evaluate(() => { const s = BusJam.state; const f = BusJam.core.freeVehicles(s); const b = s.inLot.findIndex((x, i) => x && !f.includes(i)); return b; });
  if (blocked >= 0) { const m0 = await page.evaluate(() => BusJam.state.moves); await touchVehicle(blocked); await sleep(200); ok('blocked vehicle stays put', await page.evaluate(([v, m0]) => BusJam.state.inLot[v] && BusJam.state.moves === m0, [blocked, m0])); }
  // finish level 1 with touch taps
  for (const v of sol1.slice(1)) { await touchVehicle(v); await sleep(120); }
  const lv1 = await page.evaluate(() => BusJam.info()); ok('level 1 is a big jam', lv1.vehicles >= 30, lv1);
  await page.waitForSelector('#win:not(.hidden)', { timeout: 300000 });
  await sleep(500); await page.screenshot({ path: OUT + 'screenshot-win.png' });
  const sv = await page.evaluate(() => BusJam.save());
  ok('level 1 completes, 3 stars saved, level 2 unlocked', sv.stars && sv.stars[0] === 3 && sv.unlocked >= 2, sv);

  // undo
  await page.tap('#win-next'); await sleep(600);
  const sol2 = await page.evaluate(() => BusJam.solve().solution);
  const before = await page.evaluate(() => JSON.stringify([BusJam.state.inLot, BusJam.state.qi, BusJam.state.parked]));
  await touchVehicle(sol2[0]); await sleep(200);
  await page.tap('#btn-undo'); await sleep(300);
  const after = await page.evaluate(() => JSON.stringify([BusJam.state.inLot, BusJam.state.qi, BusJam.state.parked]));
  ok('undo restores the position', before === after);
  await page.tap('#btn-restart'); await sleep(300);
  ok('restart resets', await page.evaluate(() => BusJam.state.moves === 0 && BusJam.state.qi[0] + BusJam.state.qi[1] === 0));

  // mid-level screenshot on a big level
  await page.evaluate(() => BusJam.startLevel(29)); await sleep(700);
  const sol20 = await page.evaluate(() => BusJam.solve().solution);
  await page.evaluate(() => BusJam.setSpeed(3));
  for (const v of sol20.slice(0, 6)) { await page.evaluate(v => BusJam.tapVehicle(v), v); await sleep(100); }
  await page.waitForFunction(() => BusJam.walking() >= 6, null, { timeout: 120000, polling: 50 }).catch(() => {});
  await page.screenshot({ path: OUT + 'screenshot-midlevel.png' });
  await page.evaluate(() => BusJam.setSpeed(8));
  await waitIdle(120000); await sleep(300);
  await page.screenshot({ path: OUT + 'screenshot-midlevel-parked.png' });

  // stuck -> shuffle rescue, on the hardest level: find a tap sequence that gets stuck
  await page.evaluate(() => BusJam.startLevel(35)); await sleep(600);
  const seq = await page.evaluate(() => {
    const C = BusJam.core; const lv = BusJam.state.level;
    for (let seed = 1; seed < 500; seed++) { const R = C.rng(seed); const s = C.newState(lv); const taps = [];
      for (;;) { if (C.isWon(s)) break; if (C.isStuck(s)) return taps; const f = C.freeVehicles(s); const v = f[Math.floor(R() * f.length)]; taps.push(v); C.tap(s, v); } }
    return null;
  });
  ok('found a losing tap sequence on level 36', !!seq, seq && seq.length);
  for (const v of seq) { await page.evaluate(v => BusJam.tapVehicle(v), v); await sleep(60); }
  await waitIdle(180000); await sleep(400);
  const stuckVisible = await page.isVisible('#stuck');
  ok('stuck panel offers shuffle (no game over)', stuckVisible && await page.evaluate(() => BusJam.core.isStuck(BusJam.state) && BusJam.mode === 'play'));
  await page.screenshot({ path: OUT + 'screenshot-stuck.png' });
  await page.tap('#stuck-shuffle'); await sleep(300);
  const rescue = await page.evaluate(() => { const r = BusJam.solve(true); return { stuck: BusJam.core.isStuck(BusJam.state), solvable: !!r.solution, sol: r.solution, shuffles: BusJam.state.shuffles }; });
  ok('shuffle rescues the stuck position (solver finds a win from here)', !rescue.stuck && rescue.solvable, { shuffles: rescue.shuffles, steps: rescue.sol && rescue.sol.length });
  await waitIdle(180000);
  await page.screenshot({ path: OUT + 'screenshot-after-shuffle.png' });
  for (const v of rescue.sol) { await page.evaluate(v => BusJam.tapVehicle(v), v); await sleep(60); }
  await page.waitForSelector('#win:not(.hidden)', { timeout: 400000 });
  const sv36 = await page.evaluate(() => BusJam.save());
  ok('finished level 36 after shuffle, 2 stars', sv36.stars[35] === 2, sv36.stars[35]);

  // sort booster
  await page.evaluate(() => BusJam.startLevel(30)); await sleep(500);
  const sortRes = await page.evaluate(async () => {
    const C = BusJam.core; const s = BusJam.state;
    // park vehicles until the front of the line doesn't match but someone further back does
    for (let k = 0; k < 6; k++) { const f = C.freeVehicles(s); if (!f.length || C.freeSpot(s) < 0) break; if (C.canSort(s)) break; BusJam.tapVehicle(f[f.length - 1]); }
    const can = C.canSort(s); const qi0 = s.qi[0] + s.qi[1]; if (can) BusJam.doSort(); return { can, boarded: s.qi[0] + s.qi[1] - qi0, sorts: s.sorts };
  });
  ok('sort booster moves matching passengers forward', !sortRes.can || sortRes.boarded > 0, sortRes);

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
