// Génère les icônes PNG de l'extension à partir des logos SVG (assets/). Usage : node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
let puppeteer;
try { puppeteer = require('puppeteer'); } catch { puppeteer = require(path.join(execSync('npm root -g').toString().trim(), 'puppeteer')); }
const ROOT = path.resolve(__dirname, '..');
const big = fs.readFileSync(path.join(ROOT, 'assets/logo.svg'), 'utf8');
const small = fs.readFileSync(path.join(ROOT, 'assets/logo-small.svg'), 'utf8');
(async () => {
  const b = await puppeteer.launch({ headless: true });
  const p = await b.newPage();
  for (const size of [16, 32, 48, 128]) {
    const svg = size <= 32 ? small : big;
    await p.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: path.join(ROOT, 'icons', `icon${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  // Aperçu agrandi pour relecture
  await p.setViewport({ width: 520, height: 150 });
  await p.setContent(`<html><body style="margin:0;display:flex;gap:24px;align-items:center;padding:12px;background:#dfe3ea">${[128, 48, 32, 16].map((s) => `<img src="data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'icons', `icon${s}.png`)).toString('base64')}" width="${s}" height="${s}">`).join('')}<div style="background:#202124;padding:10px;border-radius:8px;display:flex;gap:10px">${[32, 16].map((s) => `<img src="data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'icons', `icon${s}.png`)).toString('base64')}" width="${s}" height="${s}">`).join('')}</div></body></html>`);
  if (process.argv[2]) await p.screenshot({ path: process.argv[2] });
  await b.close();
  console.log('icônes générées');
})().catch((e) => { console.error(e); process.exit(1); });
