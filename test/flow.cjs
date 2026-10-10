// Captures a frame sequence of the rider track while buses load, then builds a GIF and a contact sheet.
const { chromium, devices } = require('playwright'); const fs = require('fs');
const URL = process.argv[2] || 'http://127.0.0.1:18791/bus-jam/'; const OUT = process.env.OUT || '/workspace/bus-jam/flow/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ ...devices['iPhone 13'] }); const p = await ctx.newPage();
  await p.goto(URL); await p.waitForFunction(() => window.BusJam); await sleep(800);
  await p.evaluate(() => { BusJam.startLevel(0); BusJam.setSpeed(1.5); }); await sleep(800);
  const sol = await p.evaluate(() => BusJam.solve().solution);
  for (const v of sol.slice(0, 7)) { await p.evaluate(v => BusJam.tapVehicle(v), v); await sleep(80); }
  await p.waitForFunction(() => BusJam.walking() > 0, null, { timeout: 60000, polling: 50 });
  for (let i = 0; i < 24; i++) { await p.screenshot({ path: `${OUT}frame-${String(i).padStart(2, '0')}.png`, clip: { x: 0, y: 0, width: 390, height: 330 } }); await sleep(150); }
  await b.close();
})();
