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
  return { passes, count: passes.length, alignmentCost: passes.reduce((n, pass) => n + (pass.length - 1) ** 2, 0), length: passes.reduce((n, pass) => { const across = pass[0].axis === 'x' ? 'y' : 'x', extent = pass[0].axis === 'x' ? 'h' : 'w'; return n + pass.at(-1)[across] + pass.at(-1)[extent] - pass[0][across]; }, 0) };
}
export const cutSegments = (sheet) => sheet.cutSegments || sheet.cuts.flatMap((cut) => cut.segments || [cut]);
