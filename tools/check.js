// Vérifications statiques : syntaxe de tous les scripts, manifeste valide, fichiers référencés présents.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
let errors = 0;
const fail = (m) => { console.error('✗', m); errors++; };

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'))) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { fail(`syntaxe : ${path.relative(ROOT, f)}\n${e.stderr}`); }
}

const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
if (m.manifest_version !== 3) fail('manifest_version doit valoir 3');
if (!/^\d+(\.\d+){0,3}$/.test(m.version)) fail(`version invalide : ${m.version}`);
const refs = [
  m.background?.service_worker && `src/${m.background.service_worker.replace(/^src\//, '')}`,
  m.action?.default_popup, m.options_page,
  ...Object.values(m.icons || {}), ...Object.values(m.action?.default_icon || {}),
  ...(m.content_scripts || []).flatMap((c) => c.js || []),
].filter(Boolean);
for (const r of refs) if (!fs.existsSync(path.join(ROOT, r))) fail(`fichier référencé absent : ${r}`);

const html = walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.html'));
for (const f of html) {
  const src = fs.readFileSync(f, 'utf8');
  for (const [, ref] of src.matchAll(/(?:src|href)="(?!https?:|#|chrome|data:)([^"]+)"/g)) {
    const target = ref.startsWith('/') ? path.join(ROOT, ref) : path.resolve(path.dirname(f), ref);
    if (!fs.existsSync(target.split('#')[0])) fail(`${path.relative(ROOT, f)} : lien cassé vers ${ref}`);
  }
}

if (errors) { console.error(`\n${errors} problème(s)`); process.exit(1); }
console.log(`✓ vérifications OK (version ${m.version})`);
