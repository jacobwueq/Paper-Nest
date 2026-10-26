import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { identifyParts } from '../dist/importers.js';

// Roadmap 1.6: Arrange no longer waits for "I've checked the part groups"; the import
// names the parts worth a second look instead.
const rect = (w, h, x = 0, y = 0, extra = {}) => ({ kind: 'poly', closed: true, vertices: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], ...extra });
const line = (x1, y1, x2, y2) => ({ kind: 'poly', closed: false, vertices: [{ x: x1, y: y1 }, { x: x2, y: y2 }] });

test('ordinary parts with holes and engraving are not flagged', () => {
  const [p] = identifyParts([rect(100, 50), { kind: 'circle', cx: 25, cy: 25, r: 4, closed: true }, line(10, 10, 80, 10)]);
  assert.deepEqual(p.review, { envelope: false, inside: 0 });
  const two = identifyParts([rect(100, 50), rect(20, 20, 150, 0)]);
  assert.ok(two.every((q) => !q.review.envelope && q.review.inside === 0));
});

test('shapes inside an inner outline are flagged: they fall out with the hole', () => {
  const [wall] = identifyParts([rect(200, 200), rect(100, 100, 50, 50), rect(30, 30, 80, 80)]);
  assert.equal(wall.review.inside, 1);
  const [panel] = identifyParts([rect(200, 200), rect(100, 100, 50, 50), line(60, 60, 120, 60), line(10, 10, 40, 10)]);
  assert.equal(panel.review.inside, 1, 'only the line in the hole, not the one on the panel');
});

test('a group without a closed loop around it is flagged as an envelope', () => {
  const [g] = identifyParts([rect(30, 20, 0, 0, { group: 'G' }), rect(20, 20, 50, 0, { group: 'G' })]);
  assert.equal(g.review.envelope, true);
  const [h] = identifyParts([rect(100, 100, 0, 0, { group: 'H' }), line(10, 10, 50, 10)].map((e) => ({ ...e, group: 'H' })));
  assert.equal(h.review.envelope, false);
});

test('the laser page has no tick box gate before Arrange', () => {
  const html = fs.readFileSync(new URL('../dist/laser.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="confirmed"|checked the part groups/);
  assert.match(html, /id="review-flags"/);
  assert.doesNotMatch(app, /\$\("confirmed"\)/);
});
