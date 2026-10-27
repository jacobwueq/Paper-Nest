# Paper Nest improvement roadmap / 改進路線

Working plan for improving cutting quality, speed and the workshop experience,
based on the 26 Oct 2026 survey ("Paper Nest — 改善調查"). Items are done one at a
time, in order, each as its own commit with its own tests. A phase starts only
when the previous phase's check passes.

依據 2026 年 10 月 26 日的改善調查。每次只做一項，每項一個提交、附自己的測試；
上一階段的檢查通過後，才開始下一階段。

## How each item is done / 每一項的做法

1. Read the item's **Done when** first. If it is not measurable, make it measurable
   before writing code.
2. Run the baseline: `node --test tests/*.test.mjs` and, for planning or speed items,
   `node scripts/benchmark-timber.mjs`. Keep the numbers.
3. Change one thing. New logic goes in its own module or function; existing
   behaviour is kept unless the item says it changes.
4. Add tests that fail without the change and pass with it.
5. Run the full suite and the benchmark again; record before → after in the commit
   message and in the item's **Result** line below.
6. `node scripts/set-version.mjs <next>`; update README if users see the change.
7. Commit (one item per commit), push `ui-redesign`, refresh the preview page.
8. Tick the item here.

## Ground rules / 底層規則

These keep the foundations tidy as features are added.

- **Layers stay separate.** Planning code (`timber-planner.js`, `timber-cut-*.js`,
  `geometry.js`, `compaction.js` …) has no DOM and no `t()` text. Words live in
  `timber-text.js` / `locale.js`. UI files call planners; they never compute plans.
- **One place per fact.** A setting is defined, defaulted and validated once
  (settings schema, item 0.4). A colour is a token in `theme.css`. A version is set
  by `scripts/set-version.mjs`, never by hand.
- **Measured, not guessed.** Planning and speed changes report benchmark numbers
  before and after. "Faster" or "better" without numbers does not count as done.
- **Deterministic tests.** No test depends on wall-clock time; time-bounded searches
  get a fixed-work mode for tests.
- **Old projects keep opening.** Saved projects and JSON files from earlier versions
  load unchanged; a new setting always has a default.
- **Risky algorithm changes start behind a switch.** The old path stays until the
  new one is at least as good on every benchmark list, then the old path is removed
  in a separate commit.
- **Both languages, both saws.** Every visible change is checked in English and
  Traditional Chinese; every timber planning change is checked with panel, table and
  hybrid saws.

## Phase 0 · Foundations / 底層整理

Check to finish the phase: full suite green on this machine, one command sets
versions, benchmark baseline committed. **Passed 26 Oct 2026** (235/235).

- [x] **0.1 One version for every script and stylesheet.**
  Today `?v=` tags are mixed (0.13.0 … 0.25.8) and were bumped by hand.
  Done when: `scripts/set-version.mjs` rewrites every `?v=` in `dist/`, and a test
  fails if any two differ.
  Result: 43 files set to 0.26.0; `tests/versions.test.mjs` guards it; two tests that
  pinned 0.13.0 now read `VERSION`.
- [x] **0.2 Timber benchmark in the repo.**
  Done when: `scripts/benchmark-timber.mjs` runs the 7 survey lists × 3 saws and
  writes sheets, lower bound, steps and timings; `benchmarks/timber-baseline.json`
  holds today's numbers.
  Result: lists in `benchmarks/timber-lists.mjs` (shared with tests); the script compares
  sheets, steps, time ratio and exact plan signature with the baseline. Re-run: identical plans.
- [x] **0.3 Fixed-work laser test.**
  The concave-arch test runs for 6 s and fails here by 4 mm.
  Done when: compaction accepts a fixed step budget for tests, the test uses it,
  and it passes on every run.
  Result: `fixedWorkClock()` in `compaction.js` turns `milliseconds` into a budget of
  clock reads. With it the arches end at 179 mm and 236 mm (limit 245) on every run;
  with the wall clock they ended at 249 mm. Five other test files still pass a
  `milliseconds` budget on the real clock; they pass today and move to fixed work
  when one of them is touched.
- [x] **0.4 Timber settings schema.**
  kerf, trim, direction, saw, hybridLimit, rotate, usePriorities are each handled
  in five places (validate, read, clean, render, sample).
  Done when: one table in `timber-settings.js` lists each setting's default, range
  and validation; the five places use it; old project files still load.
  Result: `TIMBER_SETTINGS` holds default, type, range, choices and message for all
  seven; the planner validates with it, the page reads/cleans/renders through one
  `SETTING_INPUTS` map, the sample starts from `defaultTimberSettings()`. Old files:
  missing or wrongly typed values take the default (a 0.13-era file opens as panel saw).
  21/21 benchmark plans identical. A test fails if the page repeats a default.

## Phase 1 · Quick wins / 快速改善

Check to finish the phase: the first plan for the 139-piece list takes under 1.5 s,
and every Phase 1 UI fix is visible in the preview in both languages. **Passed 26 Oct
2026**: 0.86 s; preview refreshed.

- [x] **1.1 Check sheets before ordering cuts.**
  Done when: plans skip cut ordering for layouts already worse on unplaced parts,
  sheets or stock area; chosen plans are identical to before on all 21 benchmark
  runs; quick plan at 139 pieces ≤ 1.5 s (was 2.9 s).
  Result: `primaryScore()` is known right after placement; `build()` returns a pruned
  stand-in when it loses to the best plan (quick plan) or the 8th best (evolving search,
  whose parents come from the best 8), so no ranking can change. 21/21 plans identical;
  quick plan at 139 pieces 2.6 s → 1.0 s on this machine (all lists 0.27–0.98× time);
  "Improve layout" tries in 4 s at 139 pieces 39 → 84. `planTimber(project, { pruning:
  false })` keeps the old path for tests.
- [x] **1.2 Remember cut orders per sheet.**
  Done when: a sheet with the same parts in the same places reuses its cut order
  within a search; plans identical; tries per second up again (record it).
  Result: `cachedSimplifyTimberCuts()` keys on every node's kind, rectangle, axis,
  amount and kerf plus the options; a hit returns a fresh copy bound to this sheet's
  parts. 30–50 % of sheets repeat in a 4 s search. 21/21 plans identical; 139 pieces
  1.0 s → 0.86 s; 4 s search at 139 pieces 84 → 127 tries (and found 237 steps
  instead of 238).
- [x] **1.3 Wording and settings tidy-up.**
  Auto Nest footer note matches the single "Use this layout" button; laser header
  shows the workspace name (version in the footer); timber Cutting direction and
  Use part priorities move into a More options fold.
  Done when: checked in both languages; no setting lost from saved projects.
  Result: Auto Nest and Manual notes name “Use this layout”; laser header says LASER
  CUTTING (was a stale 0.15.0) and all three footers show the version, set by
  `set-version.mjs` and guarded by a test; Cutting direction and Use part priorities
  sit in a More options fold (closes on Escape or a click elsewhere). Also: restored
  notice no longer mixes languages; “1 sheet” singular. Checked in both languages;
  direction/priorities survive reload.
- [x] **1.4 Offcuts back into stock.**
  Done when: each reusable offcut on Review has "Add to stock", which adds a stock
  row (material, thickness, size, qty 1, label "Offcut S1-W2"); undoable.
  Result: each reusable offcut has a tick box; one button adds the ticked ones
  ("Add 2 offcuts to stock"), so several can be kept without the plan closing after
  the first. Rows come from `offcutStockRow()` in the planner (length along grain,
  rounded down to 0.1 mm). `notifyUndo()` restores rows, settings and manual layout;
  it is reused by 1.5. Checked in both languages.
- [x] **1.5 Undo for deletions.**
  Done when: removing a part or stock row shows an undo notice that restores it.
  Result: table ✕ and parts-tray − both go through `removeRow()`, which names the row
  (“Removed part “Top / bottom”. Undo”) and restores rows, settings and manual layout.
  Checked in the browser for parts and stock, English and 中文.
- [x] **1.6 Laser: no tick box before Arrange.**
  Done when: Arrange runs without "I've checked the part groups"; parts whose detail
  lines may be unattached are flagged instead.
  Result: `groupingReview()` in the importer flags lines inside an inner outline
  (they drop out with the hole unless they are a separate part) and explicit groups
  without a closed loop (envelope outline). Flagged parts: dashed amber outline and
  "check grouping" in Part review; the Arrange panel names them with links. Holes and
  engraving on the panel itself are not flagged. Checked EN/中文; Arrange runs.

## Phase 2 · The workshop / 工場

Check to finish the phase: one sheet saved on the 139-piece list, and a full cut can
be followed on a phone in the workshop view.
*Revised 27 Oct after 2.4:* a pairwise bound shows 6/12 is already optimal (5 sheets)
and 15/21, 15/22, 30/31 sit on the area bound; refilling the k weakest sheets into
k − 1 failed for every list and k ≤ 5 (the waste is spread ~10–15 % over every sheet).
Saving a sheet at 139 pieces needs a global method, so that target moves to **3.1**.
Phase 2 now finishes when its items are done and no benchmark run gets worse. **Passed 27 Oct 2026** (264/264 tests; benchmark: none worse, 12/21 fewer steps).

- [x] **2.1 Sheet thumbnails with use %.** Replace the sheet dropdown with a strip.
  Result: Review shows one thumbnail per sheet (parts drawn, use % bar, least-used sheet in amber, material when several); arrow keys, Home/End move between sheets. Fits a 390 px phone without page scroll. Checked EN/中文.
- [x] **2.2 Workshop view.** Full screen, one step at a time, large measurement and
  fence edge, big Back/Next, screen kept awake; machine colour in Hybrid.
  Result: Review → "Workshop view ⤢" opens a full-screen dialog: sheet and step, machine badge (panel/table colours in Hybrid), progress bar, the setting in large type (`cutHeadline()`: measurement + edge to measure from, or fence distance + fence edge, and says when pieces differ), full instructions below, 64 px Back/Next. Step 0 of each sheet is edge preparation; Next runs into the next sheet. Arrow keys, Space, Esc; focus trapped; screen wake lock; closing returns Review to that sheet and step. Checked EN/中文, desktop and 390 px phone. New `[data-localized]` lets t()-made text skip the page translator.
- [x] **2.3 Printable part labels.** PDF of labels: part ID, size, sheet, releasing step.
  Result: More exports → Part labels PDF: `partLabels()` (planner) gives one label per placed part with sheet and releasing step (and machine in Hybrid), in cutting order; `createLabelsPDF()` lays them out 3 × 7 on A4 (63.5 × 38.1 mm stickers, corner marks for plain paper). Found and fixed a font bug affecting every PDF: default shaping swapped digit glyphs missing from the width table, so digits printed 1 em wide ("1 ,4 2 8"); `PDF_FONT_OPTIONS` turns that shaping off and a test checks the glyphs.
- [x] **2.4 Repack the weakest sheets.** A post-pass that tries to empty the least-used
  sheets into the gaps of others. Behind a switch until it never makes a plan worse.
  Result: `repackPlan()` keeps the plan's order for all other parts and puts the weakest sheet's parts last (largest first, then longest side first; current + 2 other strategies), for the 2 least-used sheets, up to 3 rounds; kept only when `compareTimberPlans` ranks it better. On by default in the quick plan and at the end of Improve layout (`repack: false` keeps the old path for tests). Benchmark: 0 runs worse; 12 of 21 runs 1–3 steps fewer; no sheet saved (see revised phase check); quick plan at 139 pieces 0.9–1.1 s. New baseline saved.
- [x] **2.5 Paste rows into the parts tray** from a spreadsheet; one parts list.
  Result: Ctrl/⌘ V anywhere on the timber page (outside text fields), or a multi-cell paste into the parts table/tray, adds part rows via `parsePastedParts()` (planner): header row read by name (EN/中文, units allowed), otherwise label + two largest numbers as size + whole number ≤ 500 as qty + leftover as thickness; tab, semicolon or comma separated. Skipped lines are counted, never guessed; a single value pasted into a field behaves as normal. Notice with Undo. Tray shows the hint. The tray and the detailed table are already one list (same rows).
- [x] **2.6 Laser collision grid.** Broad-phase grid so collision tests only check
  nearby parts; record candidate moves at 64 parts (was 42 in 1.8 s).
  Result: **Closed without the grid — measurement refuted the premise.** New `scripts/benchmark-laser64.mjs` (fixed work, exact result signature): of 57 s, layout scoring takes 56.3 s (98 %) and collision tests + no-fit polygons under 2 s. Each scored layout runs ~266 offcut histogram passes (the remnant beam search in `offcut.js`). Two exact speed-ups were tried and dropped: reusing the fixed parts' raster (−3 %) and caching the best utility (0 %). A real gain needs fewer or incremental histogram passes; that is new item **3.6**.
- [x] **2.7 Say why the table saw adds steps** on Review.
  Result: For Table saw and Hybrid plans, Review plans the same list for a panel saw in a worker (`timber-compare-worker.js`, cached per project) and `sawComparison()` explains: "Why 125 steps: a panel saw would cut this list in 116 steps. One panel-saw pass can run straight through several pieces lined up together, but a table saw guides one piece at a time along the fence, so the table saw needs 129 separate feeds. In return …". When the table saw or Hybrid is not slower (e.g. 15/21, the sample cabinet) it says so instead of inventing a reason. EN/中文.

## Phase 3 · Bigger bets / 較大型項目

Each starts with a short spike (prototype + numbers) before any change to `dist/`.

- [x] **3.1 Sheet-by-sheet filling with re-weighting** (sequential value correction).
  Result: Spike: one round of sheet-by-sheet filling already gives 17 sheets at 139 pieces on all saws (whole-list greedy: 18). Built as `valueCorrection()` + `finishSheets()` (each sheet's own parts re-laid for fewest cuts) on a new `place()` split out of `build()` (plans unchanged, 21/21). Runs inside Improve layout from half the time/tries, at most 8 rounds or 15 % of the time, only when sheets > area bound, all parts fit and priorities are off; kept only if it ranks better; the usual search then resumes. Fixed-tries comparison: 0 of 21 runs worse, 3 save a sheet (50/41: 18 → 17 on panel/table/hybrid, +12–24 cuts). Manual Adjust can replay these plans. The phase-2 sheet target is met here.
- [x] **3.2 Stage limit and stock cost** (multistage along length/width; cheapest material).
  Result: **Stock cost done; stage limit split off as 3.2b.** Spike found that offcut rows in stock (e.g. from 1.4 "Add to stock") were never used: each counted as one more sheet. Plans now rank stock area before the number of sheets (`primaryScore`); with one stock size the order is unchanged (21/21 plans identical). With three offcut rows added, 6/11, 15/21 and 30/32 each cut one fewer new full sheet; an offcut that saves nothing stays in stock. Area stands in for price; a per-row price can be added if wanted. Stage limit: not built — mainly matters for production saws; kept as 3.2b until a workshop need is confirmed.
- [ ] **3.2b Stage limit** (2- or 3-stage guillotine: strips, then crosscuts, then trims). Only if the workshop asks for it; spike first.
- [x] **3.3 Laser part-in-part** (parts inside holes). Done when the sample walls hold
  parts inside their openings.
  Result: Spike then build, behind a setting (More options → "Place small parts inside openings", off by default). `partHoles()` finds closed loops inside the outline on the outline's layer (sample walls: one 28 × 53 mm opening each; score lines ignored). `insideHole()`/`separated()` allow a part wholly inside a hole with the gap to every hole edge; compaction adds hole corner/centre candidates; holes are sent precomputed to the worker. Test: three 20 × 40 tabs move into the sample walls' openings (used height 139 → 105 mm). Browser: an imported drawing of two frames moved two squares into an opening. Option off: laser benchmark signature unchanged.
- [ ] **3.4 Keep no-fit polygons between runs.**
- [ ] **3.5 Fast discretised placement** as the laser search's inner loop (spike first).
- [ ] **3.6 Faster offcut scoring for the laser search** (from 2.6). Scoring is 98 % of
  compaction time: ~266 grid histogram passes per scored layout in the remnant beam.
  Spike: resume each beam child's histogram from the first row its new rectangle
  touches (exact), or a coarse first pass that only re-scores close calls. Done when
  `benchmark-laser64.mjs` gives the same signature at least 2× faster.

## Log / 紀錄

| Date | Item | Result |
| --- | --- | --- |
| 2026-10-26 | Roadmap written | Baseline: 228/229 tests pass (concave-arch test fails by 4 mm); quick plan 2.9 s at 139 pieces |
| 2026-10-26 | 0.1 One version | Five versions in use (0.13.0–0.25.8) → one (0.26.0); 229/230 tests pass |
| 2026-10-26 | 0.2 Timber benchmark | Baseline saved: 21 runs; quick plan 2.6–2.7 s at 139 pieces on this machine |
| 2026-10-26 | 0.3 Fixed-work test | `fixedWorkClock()`; concave-arch test passes 3/3 runs; 230/230 tests pass |
| 2026-10-26 | 0.4 Settings schema | `timber-settings.js`; 235/235 tests; 21/21 plans identical; old-format project reopens in the browser. Phase 0 done |
| 2026-10-26 | 1.1 Sheets-first pruning | 237/237 tests; 21/21 plans identical; 139 pieces 2.6 s → 1.0 s; 4 s search 39 → 84 tries |
| 2026-10-26 | 1.2 Cut-order cache | 239/239 tests; 21/21 plans identical; 139 pieces 0.86 s (baseline 2.6 s); 4 s search 127 tries (baseline 39) |
| 2026-10-26 | 1.3 Wording & settings | 240/240 tests; version 0.27.0 shown in footers; settings fold checked EN/中文 |
| 2026-10-26 | 1.4 Offcuts → stock | 242/242 tests; add 2 offcuts → 3 stock rows → Undo → 1 row, in the browser |
| 2026-10-26 | 1.5 Undo deletions | 243/243 tests; tray and table removals undo in the browser |
| 2026-10-26 | 1.6 Laser flags | 247/247 tests; nested-part SVG flagged, sample not; Arrange runs without a tick. Phase 1 done |
| 2026-10-27 | 2.1 Sheet thumbnails | 248/248 tests; strip replaces dropdown |
| 2026-10-27 | 2.2 Workshop view | 251/251 tests; checked EN/中文, desktop and phone |
| 2026-10-27 | 2.3 Part labels | 254/254 tests; also fixes digit spacing in all PDFs |
| 2026-10-27 | 2.4 Repack weakest sheets | 257/257 tests; 12/21 runs fewer steps, none worse; no sheet saved; new baseline |
| 2026-10-27 | 2.5 Paste rows | 261/261 tests; browser: paste, undo, header, junk, 中文 |
| 2026-10-27 | 2.6 Laser collision grid | closed: scoring is 98 % of laser time, collisions < 2 %; benchmark added; work moved to 3.6 |
| 2026-10-27 | 2.7 Table-saw note | 264/264 tests; note checked for table/hybrid/panel, EN/中文. Phase 2 done |
| 2026-10-27 | 3.1 Sheet-by-sheet filling | 267/267 tests; 139 pieces 18 → 17 sheets on all saws; 0/21 worse at fixed tries |
| 2026-10-27 | 3.2 Stock area before sheet count | 270/270 tests; offcut rows now replace a new full sheet; single-size plans unchanged |
| 2026-10-27 | 3.3 Part-in-part | 274/274 tests; sample walls hold parts in their openings; off by default |
