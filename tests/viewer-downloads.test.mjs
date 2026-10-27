import test from 'node:test';
import assert from 'node:assert/strict';

// Inside a claude.ai artifact, saves go through the viewer's `downloads` capability.
test('saveFile offers the file through window.claude downloads when present', async () => {
  const saves = [];
  globalThis.window = { claude: { use: async (name) => (name === 'downloads' ? { save: async (r) => { saves.push(r.filename); return { status: 'saved' }; } } : null) }, addEventListener() {} };
  globalThis.document = { readyState: 'loading', addEventListener() {}, getElementById: () => null, createElement: () => ({ append() {}, setAttribute() {}, replaceChildren() {}, insertBefore() {} }), querySelector: () => null, body: { prepend() {} } };
  const { saveFile } = await import('../dist/file-download.js');
  assert.equal((await saveFile('a,b\n1,2\n', 'list.csv', 'text/csv')).method, 'viewer');
  assert.equal((await saveFile('0\nSECTION\n', 'sheet-1.dxf', 'application/dxf')).name, 'sheet-1.zip');
  assert.deepEqual(saves, ['list.csv', 'sheet-1.zip']);
  delete globalThis.window; delete globalThis.document;
});

// A .dxf leaves the artifact as a .zip that unzips to the exact file.
test('zipOne makes a zip that unzip reads back byte for byte', async () => {
  const { zipOne } = await import('../dist/file-download.js');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path'), { execFileSync } = await import('node:child_process');
  const text = '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
  fs.writeFileSync(path.join(dir, 'a.zip'), Buffer.from(await zipOne('sheet 1 · 板材.dxf', new TextEncoder().encode(text)).arrayBuffer()));
  execFileSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); z.testzip(); z.extractall(sys.argv[2])', path.join(dir, 'a.zip'), dir]);
  assert.equal(fs.readFileSync(path.join(dir, 'sheet 1 · 板材.dxf'), 'utf8'), text);
});
