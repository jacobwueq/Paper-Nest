import test from 'node:test';
import assert from 'node:assert/strict';

// Inside a claude.ai artifact, saves go through the viewer's `downloads` capability.
test('saveFile offers the file through window.claude downloads when present', async () => {
  const saves = [];
  globalThis.window = { claude: { use: async (name) => (name === 'downloads' ? { save: async (r) => { saves.push(r.filename); return { status: 'saved' }; } } : null) }, addEventListener() {} };
  globalThis.document = { readyState: 'loading', addEventListener() {}, getElementById: () => null, createElement: () => ({ append() {}, setAttribute() {}, replaceChildren() {}, insertBefore() {} }), querySelector: () => null, body: { prepend() {} } };
  const { saveFile } = await import('../dist/file-download.js');
  assert.equal((await saveFile('a,b\n1,2\n', 'list.csv', 'text/csv')).method, 'viewer');
  assert.equal((await saveFile('0\nSECTION\n', 'sheet-1.dxf', 'application/dxf')).name, 'sheet-1.dxf.txt');
  assert.deepEqual(saves, ['list.csv', 'sheet-1.dxf.txt']);
  delete globalThis.window; delete globalThis.document;
});
