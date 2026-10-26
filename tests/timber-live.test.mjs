import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVisualDraft } from '../dist/timber-visual.js';

test('visual project draft keeps valid placement data and strips unrelated fields', () => {
  const command = { partId: 'P1.2', board: 1, x: 5, y: 10, rotated: false };
  assert.deepEqual(normalizeVisualDraft({ mode: 'manual', selected: 4, commands: [{ ...command, ignored: '<script>' }] }), { mode: 'manual', selected: 4, commands: [command] });
  assert.deepEqual(normalizeVisualDraft({ mode: 'invalid', selected: -5, commands: [{ ...command, x: Infinity }, { ...command, board: -1 }, { ...command, partId: 'invalid' }] }), { mode: 'preview', selected: 0, commands: [] });
  assert.equal(normalizeVisualDraft({ commands: Array.from({ length: 501 }, () => command) }).commands.length, 0);
});
test('live preview worker returns revision-tagged plans and readable validation errors', async () => {
  const messages = []; globalThis.self = { postMessage: (data) => messages.push(data) };
  await import('../dist/timber-live-worker.js');
  const project = { settings: { kerf: 3.2, trim: 5, direction: 'auto', rotate: true }, stocks: [{ label: 'Sheet', material: 'Plywood', thickness: 18, length: 2440, width: 1220, qty: 2 }], parts: [{ label: 'Side', material: 'Plywood', thickness: 18, length: 720, width: 450, qty: 2, priority: 1, grain: false }] };
  const firstTask = self.onmessage({ data: { revision: 7, project } });
  assert.equal(messages[0].revision, 7); assert.equal(messages[0].plan.placed, 2);
  project.parts[0].width = 0;
  await self.onmessage({ data: { revision: 8, project } });
  await firstTask;
  const failure = messages.find((m) => m.revision === 8);
  assert.match(failure.error, /dimensions/); assert.equal(failure.plan, undefined);
  assert.equal(messages.at(-1).revision, 8, 'cancelled search cannot publish an older final result');
  delete globalThis.self;
});
