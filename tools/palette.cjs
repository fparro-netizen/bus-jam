// Renders the palette with the game's lighting (serve/probe) and prints the sampled sRGB colour of each surface as JSON.
const { chromium } = require('playwright');
(async () => {
  const pal = process.argv[2]; const out = process.argv[3]; const light = process.argv[4] || '{}';
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1200, height: 420 } })).newPage();
  await p.goto('http://127.0.0.1:18791/probe/?pal=' + encodeURIComponent(pal) + '&light=' + encodeURIComponent(light));
  await p.waitForFunction(() => window.RESULT, null, { timeout: 30000 });
  if (out) await p.screenshot({ path: out });
  console.log(JSON.stringify(await p.evaluate(() => window.RESULT))); await b.close();
})();
