// The seven generated cut lists used by the 26 Oct 2026 survey: cabinet panels,
// shelves, rails and small blocks on 2440 × 1220 mm plywood. Deterministic from the seed,
// so tests and benchmarks can compare plans exactly.
const rng = (seed) => () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

export const TIMBER_LISTS = [[6, 11], [6, 12], [15, 21], [15, 22], [30, 31], [30, 32], [50, 41]];

export function timberList(types, seed, saw = 'panel') {
  const r = rng(seed), parts = [];
  for (let i = 0; i < types; i++) {
    const kind = r();
    const [L, W] = kind < .3 ? [600 + r() * 1400, 300 + r() * 400] : kind < .6 ? [300 + r() * 600, 200 + r() * 300] : kind < .85 ? [400 + r() * 1200, 50 + r() * 100] : [80 + r() * 200, 60 + r() * 150];
    parts.push({ label: `T${i + 1}`, material: 'Plywood', thickness: 18, length: Math.round(L), width: Math.round(W), qty: 1 + Math.floor(r() * 4), priority: 1, grain: r() < .4 });
  }
  return { schema: 'paper-nest-timber-v1', name: `bench ${types}/${seed}`,
    settings: { kerf: 3.2, trim: 5, direction: 'auto', saw, rotate: true, usePriorities: false },
    stocks: [{ label: 'Sheet', material: 'Plywood', thickness: 18, length: 2440, width: 1220, qty: 200 }], parts };
}

// Total part area over usable sheet area (kerf ignored): no plan can use fewer sheets.
export function areaLowerBound(project) {
  const stock = project.stocks[0], t = project.settings.trim;
  const usable = (stock.length - 2 * t) * (stock.width - 2 * t);
  return Math.ceil(project.parts.reduce((n, p) => n + p.qty * p.length * p.width, 0) / usable);
}

// What a plan is judged on; equal signatures = identical plans for benchmark purposes.
export const planSignature = (plan) => JSON.stringify({
  sheets: plan.sheets.map((s) => s.parts.map((p) => `${p.id}@${p.x.toFixed(3)},${p.y.toFixed(3)}${p.rotated ? 'r' : ''}`).sort()),
  cuts: plan.sheets.map((s) => s.cuts.map((c) => c.segments.map((m) => `${m.workpiece}:${m.axis}${m.offset.toFixed(3)}`).join('+'))),
  unplaced: plan.unplaced.map((p) => p.id),
});
