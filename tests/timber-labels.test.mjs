import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { planTimber, partLabels } from '../dist/timber-planner.js';
import { timberList } from '../benchmarks/timber-lists.mjs';

// Roadmap 2.3: one label per finished part, with the cut that releases it.
test('every placed part gets one label naming its sheet and releasing step', () => {
  for (const saw of ['panel', 'table', 'hybrid']) {
    const plan = planTimber(timberList(15, 22, saw)), labels = partLabels(plan);
    const placed = plan.sheets.flatMap((s) => s.parts.map((p) => p.id));
    assert.deepEqual(labels.map((l) => l.id).sort(), placed.sort(), saw);
    for (const l of labels) {
      const sheet = plan.sheets.find((s) => s.number === l.sheet);
      assert.ok(sheet.parts.some((p) => p.id === l.id));
      const cut = sheet.cuts.find((c) => c.step === l.step);
      assert.ok(cut?.releasedParts.includes(l.id), `${l.id} released at step ${l.step}`);
      assert.ok(!sheet.cuts.some((c) => c.step < l.step && c.releasedParts.includes(l.id)), 'first release');
      assert.equal(l.machine, saw === 'hybrid' ? cut.saw : null);
    }
    // Labels come in cutting order: by sheet, then by step.
    for (let i = 1; i < labels.length; i++) assert.ok(labels[i - 1].sheet < labels[i].sheet || (labels[i - 1].sheet === labels[i].sheet && labels[i - 1].step <= labels[i].step));
  }
});

test('the labels PDF has 21 labels per A4 page, in both languages', async () => {
  // The UMD builds define globals; load them into this realm so typed arrays match.
  for (const lib of ['pdf-lib.min.js', 'fontkit.umd.min.js']) vm.runInThisContext(fs.readFileSync(new URL(`../dist/vendor/pdf/${lib}`, import.meta.url), 'utf8'));
  const ctx = globalThis;
  const { createLabelsPDF } = await import('../dist/timber-pdf.js');
  const fontBytes = fs.readFileSync(new URL('../dist/vendor/pdf/PaperNestTC-Regular.ttf', import.meta.url));
  const plan = planTimber(timberList(15, 21, 'hybrid')), labels = partLabels(plan);
  for (const language of ['en', 'zh-Hant']) {
    const bytes = await createLabelsPDF({ name: 'Test' }, labels, { PDFLib: ctx.PDFLib, fontkit: ctx.fontkit, fontBytes, language });
    const doc = await ctx.PDFLib.PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), Math.ceil(labels.length / 21));
    const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
    assert.ok(Math.abs(w - 595.28) < 0.1 && Math.abs(h - 841.89) < 0.1, 'A4 portrait');
  }
});

test('PDF text keeps the font\'s own digit glyphs, so widths match (no "1 ,4 2 8")', async () => {
  for (const lib of ['fontkit.umd.min.js']) vm.runInThisContext(fs.readFileSync(new URL(`../dist/vendor/pdf/${lib}`, import.meta.url), 'utf8'));
  const { PDF_FONT_OPTIONS } = await import('../dist/timber-pdf.js');
  const font = globalThis.fontkit.create(fs.readFileSync(new URL('../dist/vendor/pdf/PaperNestTC-Regular.ttf', import.meta.url)));
  for (const text of ['P15.1', 'Plywood · 18 mm · 2440 × 1220 mm', 'S1 · 第 5 刀 · 鋸導尺 80 毫米']) {
    const shaped = font.layout(text, PDF_FONT_OPTIONS.features).glyphs.map((g) => g.id);
    const plain = [...text].map((c) => font.glyphForCodePoint(c.codePointAt(0)).id);
    assert.deepEqual(shaped, plain, text);
  }
});
