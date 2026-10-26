// Sets one version on every cache-busting `?v=` tag in dist/ (scripts, stylesheets,
// module imports, worker URLs) and records it in VERSION. Never bump tags by hand.
//   node scripts/set-version.mjs 0.26.0   → set a new version
//   node scripts/set-version.mjs --check  → exit 1 if any tag differs from VERSION
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const TAG = /(\?v=)\d+\.\d+\.\d+/g;

export function distFiles(dir = dist) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'vendor') out.push(...distFiles(full)); }
    else if (/\.(js|mjs|html|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}
export function versionsInUse() {
  const found = new Map();
  for (const file of distFiles()) for (const match of fs.readFileSync(file, 'utf8').matchAll(TAG)) {
    const version = match[0].slice(3);
    if (!found.has(version)) found.set(version, new Set());
    found.get(version).add(path.relative(root, file));
  }
  return found;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const arg = process.argv[2];
  const recorded = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
  if (arg === '--check') {
    const found = versionsInUse();
    const stray = [...found].filter(([v]) => v !== recorded);
    if (stray.length) {
      for (const [v, files] of stray) console.error(`?v=${v} (expected ${recorded}) in ${[...files].join(', ')}`);
      process.exit(1);
    }
    console.log(`All ?v= tags are ${recorded}.`);
  } else {
    if (!/^\d+\.\d+\.\d+$/.test(arg || '')) { console.error('Usage: node scripts/set-version.mjs <major.minor.patch> | --check'); process.exit(2); }
    let changed = 0;
    for (const file of distFiles()) {
      const before = fs.readFileSync(file, 'utf8'), after = before.replace(TAG, `$1${arg}`);
      if (after !== before) { fs.writeFileSync(file, after); changed++; }
    }
    fs.writeFileSync(path.join(root, 'VERSION'), arg + '\n');
    console.log(`Set ?v=${arg} in ${changed} files.`);
  }
}
