// Schedule collinear cuts together once their parent workpieces are available.
// Finished parts/offcuts can be set aside; uncut workpieces may never be crossed.
const EPS = 1e-7;
const lineKey = (node) => `${node.axis}:${(node[node.axis] + node.amount).toFixed(7)}`;
export function scheduleTimberPasses(root) {
  const jobs = [];
  function visit(node, parent = -1) {
    if (node.kind !== 'cut') return;
    const index = jobs.length;
    jobs.push({ node, parent, key: lineKey(node), index });
    visit(node.first, index); if (node.second) visit(node.second, index);
  }
  visit(root);
  const done = new Set(), passes = [];
  while (done.size < jobs.length) {
    const ready = jobs.filter((job) => !done.has(job.index) && (job.parent < 0 || done.has(job.parent)));
    const byLine = new Map();
    for (const job of ready) { if (!byLine.has(job.key)) byLine.set(job.key, []); byLine.get(job.key).push(job); }
    const choices = [];
    for (const [key, sameLine] of byLine) {
      const node = sameLine[0].node, across = node.axis === 'x' ? 'y' : 'x', extent = node.axis === 'x' ? 'h' : 'w', position = node[node.axis] + node.amount, blade = Math.max(...sameLine.map((job) => job.node.kerf));
      sameLine.sort((a, b) => a.node[across] - b.node[across]);
      let batch = [];
      const add = () => {
        if (!batch.length) return;
        const pending = jobs.filter((job) => job.key === key && !done.has(job.index)).length;
        choices.push({ jobs: batch, waiting: pending - batch.length, length: batch.at(-1).node[across] + batch.at(-1).node[extent] - batch[0].node[across] }); batch = [];
      };
      for (const job of sameLine) {
        if (batch.length) {
          const gapStart = batch.at(-1).node[across] + batch.at(-1).node[extent], gapEnd = job.node[across];
          const blocked = ready.some((other) => other.key !== key && position < other.node[node.axis] + other.node[node.axis === 'x' ? 'w' : 'h'] - EPS && position + blade > other.node[node.axis] + EPS && other.node[across] < gapEnd - EPS && other.node[across] + other.node[extent] > gapStart + EPS);
          if (blocked) add();
        }
        batch.push(job);
      }
      add();
    }
    // Do enabling cuts first rather than prematurely cutting one of several matching pieces.
    choices.sort((a, b) => a.waiting - b.waiting || b.jobs.length - a.jobs.length || b.length - a.length || a.jobs[0].index - b.jobs[0].index);
    const next = choices[0];
    for (const job of next.jobs) done.add(job.index);
    passes.push(next.jobs.map((job) => job.node));
  }
  const span = (pass) => { const across = pass[0].axis === 'x' ? 'y' : 'x', extent = pass[0].axis === 'x' ? 'h' : 'w'; return pass.at(-1)[across] + pass.at(-1)[extent] - pass[0][across]; };
  return { passes, count: passes.length, alignmentCost: passes.reduce((n, pass) => n + (pass.length - 1) ** 2, 0),
    // Length of the passes that need several loose workpieces held in line.
    alignmentLength: passes.reduce((n, pass) => n + (pass.length > 1 ? span(pass) : 0), 0),
    length: passes.reduce((n, pass) => n + span(pass), 0) };
}
export const cutSegments = (sheet) => sheet.cutSegments || sheet.cuts.flatMap((cut) => cut.segments || [cut]);

// Table saw: each workpiece is fed on its own, so nothing needs holding in line. Pieces that are
// ready at the same time and need the same fence distance share one step; when a cut produces
// another piece needing that distance, the next step keeps the fence where it is.
// The fence distance is the cut's offset from the workpiece's left or top edge.
const fenceKey = (node) => node.amount.toFixed(4);
export function scheduleFenceBatches(root) {
  const jobs = [];
  (function visit(node, parent = -1) {
    if (node.kind !== 'cut') return;
    const index = jobs.length; jobs.push({ node, parent, key: fenceKey(node), index });
    visit(node.first, index); if (node.second) visit(node.second, index);
  })(root);
  const done = new Set(), passes = [], area = (job) => job.node.w * job.node.h;
  let fence = null, setups = 0;
  while (done.size < jobs.length) {
    const available = jobs.filter((job) => !done.has(job.index) && (job.parent < 0 || done.has(job.parent)));
    let key = available.some((job) => job.key === fence) ? fence : null;
    if (key === null) {
      const groups = new Map();
      for (const job of available) { if (!groups.has(job.key)) groups.set(job.key, []); groups.get(job.key).push(job); }
      // Prefer a distance whose remaining cuts are all ready, then the one serving most pieces now,
      // then the biggest piece, so the sheet is broken down first.
      const choices = [...groups].map(([k, list]) => ({ k, count: list.length, waiting: jobs.filter((job) => job.key === k && !done.has(job.index)).length - list.length, largest: Math.max(...list.map(area)), first: Math.min(...list.map((job) => job.index)) }));
      choices.sort((a, b) => a.waiting - b.waiting || b.count - a.count || b.largest - a.largest || a.first - b.first);
      key = choices[0].k; setups++;
    }
    const pass = available.filter((job) => job.key === key).sort((a, b) => area(b) - area(a) || a.index - b.index);
    for (const job of pass) done.add(job.index);
    passes.push(pass.map((job) => job.node)); fence = key;
  }
  const length = passes.reduce((n, pass) => n + pass.reduce((m, node) => m + (node.axis === 'x' ? node.h : node.w), 0), 0);
  return { passes, count: passes.length, setups, feeds: jobs.length, alignmentCost: 0, alignmentLength: 0, length };
}
export const scheduleCuts = (root, saw = 'panel') => saw === 'table' ? scheduleFenceBatches(root) : scheduleTimberPasses(root);
