// Laser compaction at 64 parts with a fixed amount of work (roadmap 2.6 / 3.6).
//   node scripts/benchmark-laser64.mjs [distDir] [budget]
// 64 sample parts are shelf-packed on a 900 × 700 mm sheet (46 % full), then one
// compactLayout run with fixedWorkClock(0.05): `budget` ms of clock = budget / 0.05
// clock reads, the same work on any machine. Prints wall time, where the time went
// and a signature of the result, so two versions can be compared exactly.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dist = pathToFileURL(path.resolve(process.argv[2] || new URL('../dist', import.meta.url).pathname) + '/').href;
const budget = Number(process.argv[3] || 300);
const { compactLayout, fixedWorkClock } = await import(dist + 'compaction.js');
const { sampleParts, bounds, validateLayout, area } = await import(dist + 'geometry.js');
const source = sampleParts();
const parts = Array.from({ length: 64 }, (_, i) => ({ ...structuredClone(source[i % source.length]), id: 'p' + i }));
const width = 900, height = 700, gap = 2, margin = 5;
const settings = { width, height, margin, gap, rotations: 4, scale: 1, allowMirror: false, minOffcutSide: 20 };
let x = margin, y = margin, rowH = 0; const placements = [];
for (const p of parts) {
  const b = bounds(p.outer);
  if (x + b.w > width - margin) { x = margin; y += rowH + gap + 1; rowH = 0; }
  placements.push({ id: p.id, x: x - b.x, y: y - b.y, angle: 0, scale: 1, sheet: 0 });
  x += b.w + gap + 1; rowH = Math.max(rowH, b.h);
}
if (validateLayout(parts, placements, settings).length) throw new Error('Invalid benchmark seed');
const t0 = performance.now();
const r = compactLayout(parts, placements, settings, { milliseconds: budget, passes: 2, now: fixedWorkClock(0.05), profile: true });
const ms = performance.now() - t0;
let signature = 0;
for (const c of r.placements.map((t) => `${t.id}:${t.x.toFixed(3)},${t.y.toFixed(3)},${t.angle}`).join(';')) signature = (signature * 31 + c.charCodeAt(0)) >>> 0;
const c = r.profile?.counts || {};
console.log(JSON.stringify({
  wallMs: Math.round(ms), sheetFillPercent: Math.round(100 * parts.reduce((s, p) => s + Math.abs(area(p.outer)), 0) / (width * height)),
  candidates: c.generatedCandidates, collisionTests: c.collisionTests, layoutsScored: c.layoutScoringComputations, offcutAnalyses: c.offcutAnalyses,
  inclusiveMs: Object.fromEntries(Object.entries(r.profile?.inclusiveMs || {}).map(([k, v]) => [k, Math.round(v)])), signature,
}));
