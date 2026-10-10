// Renders icons/icon.svg to PNGs, then inlines them as data URIs (apple-touch-icon in index.html, icons in the manifest),
// because the GitHub connector used for publishing can only write text files.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const site = path.join(__dirname, '..', 'site');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const svg = fs.readFileSync(path.join(site, 'icons/icon.svg'), 'utf8');
  await p.setContent('<html><body></body></html>');
  const out = {};
  for (const S of [180, 192, 512]) {
    out[S] = await p.evaluate(async ([svg, S]) => {
      const img = new Image(); img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))); await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = S; c.getContext('2d').drawImage(img, 0, 0, S, S); return c.toDataURL('image/png');
    }, [svg, S]);
    fs.mkdirSync(path.join(__dirname, '..', 'icons-png'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '..', 'icons-png', `icon-${S}.png`), Buffer.from(out[S].split(',')[1], 'base64'));
  }
  await b.close();
  const tplPath = path.join(site, 'index.html');
  let html = fs.readFileSync(tplPath, 'utf8').replace(/<link rel="apple-touch-icon" href="[^"]*">/, `<link rel="apple-touch-icon" href="${out[180]}">`);
  fs.writeFileSync(tplPath, html);
  const manifest = {
    name: 'Bus Jam', short_name: 'Bus Jam', description: 'Clear the parking lot jam and fill every bus. All spots open, free boosters, no ads.',
    start_url: './', scope: './', display: 'standalone', orientation: 'portrait', background_color: '#2b6cb0', theme_color: '#2b6cb0',
    icons: [{ src: out[192], sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: out[512], sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
  fs.writeFileSync(path.join(site, 'manifest.webmanifest'), JSON.stringify(manifest, null, 1));
  console.log('sizes', Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])));
})();
