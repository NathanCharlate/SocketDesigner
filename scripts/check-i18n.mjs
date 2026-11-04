// Lists the t('…') strings used in src/ that have no French translation, and unused translations.
import fs from 'fs';
import path from 'path';
import fr from '../src/locales/fr.js';

const files = [];
const walk = (dir) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') && !p.includes('locales')) files.push(p);
  }
};
walk('src');

const used = new Set();
const re = /(?<![\w.])t\('((?:[^'\\]|\\.)*)'/g;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(re)) used.add(m[1].replace(/\\(.)/g, '$1'));
}
// Warnings produced in geometry code are translated at display time.
for (const m of fs.readFileSync('src/geom/socket.js', 'utf8').matchAll(/warnings\.push\('((?:[^'\\]|\\.)*)'\)/g)) used.add(m[1]);

const missing = [...used].filter((k) => !(k in fr));
const unused = Object.keys(fr).filter((k) => !used.has(k));
console.log(`${used.size} strings, ${missing.length} missing, ${unused.length} unused`);
for (const k of missing) console.log('  missing:', k);
for (const k of unused) console.log('  unused :', k);
process.exitCode = missing.length ? 1 : 0;
