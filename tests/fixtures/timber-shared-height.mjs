// Reproduces the user's 2440 × 1220 screenshot. P1 is on another material;
// the board shown contains P2.1–P2.4, P3.1–P3.2 and P4.1–P4.2.
export const sharedHeightProject = () => ({
  schema: 'paper-nest-timber-v1', name: 'Shared-height screenshot',
  settings: { kerf: 3.2, trim: 0, direction: 'auto', rotate: false },
  stocks: [{ label: 'Sheet', material: 'Plywood', thickness: 18, length: 2440, width: 1220, qty: 1 }],
  parts: [{ label: 'Other material', material: 'MDF', thickness: 18, length: 720, width: 450, qty: 2, priority: 1, grain: true },
    ...[['Upper and left', 764, 450, 4], ['Shelves', 764, 420, 2], ['Rails', 764, 80, 2]].map(([label, length, width, qty]) => ({ label, material: 'Plywood', thickness: 18, length, width, qty, priority: 1, grain: true }))],
});
export const sharedHeightCommands = () => [
  ['P2.1', 0, 0, 'cross'], ['P2.2', 0, 453.2, 'rip'], ['P4.1', 0, 906.4, 'rip'], ['P4.2', 0, 989.6, 'rip'],
  ['P2.3', 767.2, 0, 'rip'], ['P2.4', 1534.4, 0, 'rip'], ['P3.1', 767.2, 453.2, 'cross'], ['P3.2', 1534.4, 453.2, 'cross'],
].map(([partId, x, y, direction]) => ({ partId, board: 0, x, y, rotated: false, direction }));
