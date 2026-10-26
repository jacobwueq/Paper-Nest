// Reproduces Jacob's 26 Oct 2026 screenshot (workshop cabinet sample, manual layout):
// columns P1.1/P1.2 | P2.2/P3.1/P4.2 | P2.1/P3.2/P4.1, a 172.4 mm right strip and a 250.4 mm bottom strip.
export const sawProject = (saw = 'panel') => ({
  schema: 'paper-nest-timber-v1', name: 'Workshop cabinet',
  settings: { kerf: 3.2, trim: 5, direction: 'auto', saw, rotate: true, usePriorities: false },
  stocks: [{ label: 'Plywood sheet', material: 'Plywood', thickness: 18, length: 2440, width: 1220, qty: 2 }],
  parts: [
    { label: 'Side panel', material: 'Plywood', thickness: 18, length: 720, width: 450, qty: 2, priority: 0, grain: true },
    { label: 'Top / bottom', material: 'Plywood', thickness: 18, length: 764, width: 450, qty: 2, priority: 1, grain: true },
    { label: 'Shelf', material: 'Plywood', thickness: 18, length: 764, width: 420, qty: 2, priority: 1, grain: false },
    { label: 'Plinth', material: 'Plywood', thickness: 18, length: 764, width: 80, qty: 2, priority: 2, grain: false },
  ],
});
export const sawCommands = () => [
  ['P1.1', 5, 5, 'cross'], ['P1.2', 5, 458.2, 'rip'],
  ['P2.2', 728.2, 5, 'rip'], ['P3.1', 728.2, 458.2, 'rip'], ['P4.2', 728.2, 881.4, 'rip'],
  ['P2.1', 1495.4, 5, 'rip'], ['P3.2', 1495.4, 458.2, 'rip'], ['P4.1', 1495.4, 881.4, 'rip'],
].map(([partId, x, y, direction]) => ({ partId, board: 0, x, y, rotated: false, direction }));
