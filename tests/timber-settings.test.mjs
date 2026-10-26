import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TIMBER_SETTINGS, validateTimberSettings, cleanTimberSettings, defaultTimberSettings, settingValue } from '../dist/timber-settings.js';
import { planTimber, validateProject } from '../dist/timber-planner.js';

const project = (settings) => ({ schema: 'paper-nest-timber-v1', name: 'settings', settings,
  stocks: [{ label: 'Sheet', material: 'Plywood', thickness: 18, length: 2440, width: 1220, qty: 2 }],
  parts: [{ label: 'Side', material: 'Plywood', thickness: 18, length: 720, width: 560, qty: 2, priority: 1, grain: false }] });

test('defaults are the sample project settings, in saved-file order', () => {
  assert.deepEqual(defaultTimberSettings(), { kerf: 3.2, trim: 5, direction: 'auto', saw: 'panel', rotate: true, usePriorities: false });
  assert.deepEqual(Object.keys(cleanTimberSettings({ saw: 'hybrid' })), ['kerf', 'trim', 'direction', 'saw', 'hybridLimit', 'rotate', 'usePriorities']);
  for (const f of TIMBER_SETTINGS) assert.doesNotThrow(() => validateTimberSettings({ ...defaultTimberSettings(), [f.key]: f.default }), f.key);
});

test('each invalid setting gives its own message', () => {
  const ok = defaultTimberSettings();
  const cases = [
    [{ kerf: -1 }, /Kerf and edge trim/], [{ trim: 101 }, /Kerf and edge trim/], [{ kerf: undefined }, /Kerf and edge trim/],
    [{ direction: 'diagonal' }, /cutting direction/], [{ direction: undefined }, /cutting direction/],
    [{ saw: 'band' }, /panel saw, a table saw or hybrid/],
    [{ saw: 'hybrid', hybridLimit: 50 }, /100 and 10,000 mm/], [{ hybridLimit: Number.NaN }, /100 and 10,000 mm/],
    [{ rotate: 'yes' }, /rotation and grain/], [{ usePriorities: 1 }, /priorities must be enabled/],
  ];
  for (const [change, message] of cases) {
    assert.throws(() => validateTimberSettings({ ...ok, ...change }), message, JSON.stringify(change));
    assert.throws(() => validateProject(project({ ...ok, ...change })), message, JSON.stringify(change));
  }
  assert.throws(() => validateTimberSettings(null), /Kerf and edge trim/);
});

test('optional settings may be missing; the planner uses their defaults', () => {
  const old = { kerf: 3.2, trim: 5, direction: 'auto', rotate: true };
  assert.doesNotThrow(() => validateTimberSettings(old));
  assert.equal(settingValue(old, 'saw'), 'panel');
  assert.equal(settingValue({ saw: 'hybrid' }, 'hybridLimit'), 1220);
  const before = planTimber(project({ ...old, saw: 'panel', usePriorities: false }));
  const after = planTimber(project(old));
  assert.equal(after.sheets[0].saw, 'panel');
  assert.deepEqual(after.sheets.map((s) => s.cuts.length), before.sheets.map((s) => s.cuts.length));
});

test('cleaning keeps drafts as typed and fills what is missing', () => {
  // A project saved before saw types existed (0.13.x) opens as a panel-saw project.
  assert.deepEqual(cleanTimberSettings({ kerf: 3, trim: 4, direction: 'rip', rotate: false, usePriorities: true }),
    { kerf: 3, trim: 4, direction: 'rip', saw: 'panel', rotate: false, usePriorities: true });
  // hybridLimit exists only for the hybrid saw; a hybrid file without it gets 1220 mm.
  assert.equal(cleanTimberSettings({ saw: 'table', hybridLimit: 900 }).hybridLimit, undefined);
  assert.equal(cleanTimberSettings({ saw: 'hybrid', hybridLimit: 900 }).hybridLimit, 900);
  assert.equal(cleanTimberSettings({ saw: 'hybrid' }).hybridLimit, 1220);
  // An out-of-range number is kept so the person sees and fixes it; a wrong type is replaced.
  assert.equal(cleanTimberSettings({ kerf: 250 }).kerf, 250);
  assert.equal(cleanTimberSettings({ kerf: '3' }).kerf, 3.2);
  assert.equal(cleanTimberSettings({ direction: 'diagonal', rotate: 'yes' }).direction, 'auto');
  assert.equal(cleanTimberSettings({ rotate: 'yes' }).rotate, true);
});

test('the timber page has an input for every setting and no setting handled by hand', () => {
  const page = fs.readFileSync(new URL('../dist/timber.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../dist/timber.html', import.meta.url), 'utf8');
  const inputs = Object.fromEntries([...page.match(/const SETTING_INPUTS = \{([^}]*)\}/)[1].matchAll(/(\w+): '([\w-]+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(inputs).sort(), TIMBER_SETTINGS.map((f) => f.key).sort());
  for (const id of Object.values(inputs)) assert.match(html, new RegExp(`id="${id}"`), id);
  // Defaults and choice lists are not repeated in the page code.
  assert.doesNotMatch(page, /kerf: 3\.2|\['auto', 'rip', 'cross'\]|\['table', 'hybrid'\]\.includes|hybridLimit \?\? 1220/);
});
