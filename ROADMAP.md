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
and every Phase 1 UI fix is visible in the preview in both languages.

- [ ] **1.1 Check sheets before ordering cuts.**
  Done when: plans skip cut ordering for layouts already worse on unplaced parts,
  sheets or stock area; chosen plans are identical to before on all 21 benchmark
  runs; quick plan at 139 pieces ≤ 1.5 s (was 2.9 s).
- [ ] **1.2 Remember cut orders per sheet.**
  Done when: a sheet with the same parts in the same places reuses its cut order
  within a search; plans identical; tries per second up again (record it).
- [ ] **1.3 Wording and settings tidy-up.**
  Auto Nest footer note matches the single "Use this layout" button; laser header
  shows the workspace name (version in the footer); timber Cutting direction and
  Use part priorities move into a More options fold.
  Done when: checked in both languages; no setting lost from saved projects.
- [ ] **1.4 Offcuts back into stock.**
  Done when: each reusable offcut on Review has "Add to stock", which adds a stock
  row (material, thickness, size, qty 1, label "Offcut S1-W2"); undoable.
- [ ] **1.5 Undo for deletions.**
  Done when: removing a part or stock row shows an undo notice that restores it.
- [ ] **1.6 Laser: no tick box before Arrange.**
  Done when: Arrange runs without "I've checked the part groups"; parts whose detail
  lines may be unattached are flagged instead.

## Phase 2 · The workshop / 工場

Check to finish the phase: one sheet saved on the 139-piece list, and a full cut can
be followed on a phone in the workshop view.

- [ ] **2.1 Sheet thumbnails with use %.** Replace the sheet dropdown with a strip.
- [ ] **2.2 Workshop view.** Full screen, one step at a time, large measurement and
  fence edge, big Back/Next, screen kept awake; machine colour in Hybrid.
- [ ] **2.3 Printable part labels.** PDF of labels: part ID, size, sheet, releasing step.
- [ ] **2.4 Repack the weakest sheets.** A post-pass that tries to empty the least-used
  sheets into the gaps of others. Behind a switch until it never makes a plan worse.
- [ ] **2.5 Paste rows into the parts tray** from a spreadsheet; one parts list.
- [ ] **2.6 Laser collision grid.** Broad-phase grid so collision tests only check
  nearby parts; record candidate moves at 64 parts (was 42 in 1.8 s).
- [ ] **2.7 Say why the table saw adds steps** on Review.

## Phase 3 · Bigger bets / 較大型項目

Each starts with a short spike (prototype + numbers) before any change to `dist/`.

- [ ] **3.1 Sheet-by-sheet filling with re-weighting** (sequential value correction).
- [ ] **3.2 Stage limit and stock cost** (multistage along length/width; cheapest material).
- [ ] **3.3 Laser part-in-part** (parts inside holes). Done when the sample walls hold
  parts inside their openings.
- [ ] **3.4 Keep no-fit polygons between runs.**
- [ ] **3.5 Fast discretised placement** as the laser search's inner loop (spike first).

## Log / 紀錄

| Date | Item | Result |
| --- | --- | --- |
| 2026-10-26 | Roadmap written | Baseline: 228/229 tests pass (concave-arch test fails by 4 mm); quick plan 2.9 s at 139 pieces |
| 2026-10-26 | 0.1 One version | Five versions in use (0.13.0–0.25.8) → one (0.26.0); 229/230 tests pass |
| 2026-10-26 | 0.2 Timber benchmark | Baseline saved: 21 runs; quick plan 2.6–2.7 s at 139 pieces on this machine |
| 2026-10-26 | 0.3 Fixed-work test | `fixedWorkClock()`; concave-arch test passes 3/3 runs; 230/230 tests pass |
| 2026-10-26 | 0.4 Settings schema | `timber-settings.js`; 235/235 tests; 21/21 plans identical; old-format project reopens in the browser. Phase 0 done |
