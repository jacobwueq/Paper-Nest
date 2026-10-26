# Paper Nest / 紙材排料

## Workspaces / 工作模式

The start page now offers **Timber cutting** (`timber.html`) or **Laser cutting**
(`laser.html`). Sites sign-in and audience rules are unchanged. Both workspaces
have a link back to the chooser. The original DXF/SVG laser application, nesting
engine and exporters remain in the laser workspace.

The timber workspace follows four tabs: **1 · Setup**, **2 · Auto Nest**,
**3 · Manual Adjust** and **4 · Review & Export**, with Back/Next controls.
Setup keeps live size previews. Auto Nest focuses on the optimised layout;
New manual layouts carry over the automatic positions, rotations and guillotine
splits instead of starting from an empty sheet; existing manual work is retained.
Undo recent placements to revise them.
Manual adjustment is optional: Review & Export can confirm the automatic layout
directly. Steps stay disabled until their required data/layout is available.
Navigation preserves inputs and pauses cutting playback when leaving Review.
Arrow keys move focus between enabled tabs; Enter activates the focused tab.

The timber workspace handles rectangular **sheet timber and panels** (plywood,
MDF, etc.), in millimetres. Enter finite stock quantities and required finished
part sizes. Material names (ignoring case/outer whitespace) and thickness must
match. Grain follows stock length; grain-locked parts cannot rotate. Saw kerf
and per-edge trim are separate settings. Automatic planning ignores input order
and per-part priorities by default. Enable **Use part priorities** explicitly to
allocate scarce stock to High before Normal and Low. Rip-first, crosscut-first
and automatic split directions are supported.

### Live visual timber workspace / 即時可視化

The timber page opens with a parts tray and a scaled sheet canvas (default stock
2440 × 1220 mm). Edit the selected part's size, quantity, material and grain lock
in the inspector; tray shapes update immediately and the live nesting estimate
updates after a short debounce. Stock dimensions and quantity can be edited next
to the canvas. Live stats show part types, total pieces, estimated used sheets
and unplaced pieces, plus used-sheet counts by material/thickness. Estimates
respect available stock; unplaced counts remain visible when stock is insufficient.
The detailed stock/cutting-list tables and CSV import are under an expandable panel.

Use **Place parts** for manual placement: select a part and click a green free
region, or use **Place one**. Placements snap to the free region's top-left corner
and split it into guillotine regions, preserving kerf, grain constraints and valid
cutting dependencies. Undo removes the last placement; Clear removes manual
placements. Optional 90° rotation respects grain locks. Top/isometric views,
zoom and Fit are available. This is a rectangular cutting workspace, not a 3D
modelling editor. Isometric view is a visualization of the same 2D cutting plan.

**Use layout & cut guide** confirms the currently shown automatic or manual plan
for the existing cutting guide, CSV and print outputs. Geometry changes reset
manual placements to avoid stale cuts; renaming parts does not. Manual placement
commands and selected part are included in local storage and project JSON files.
Live automatic preview runs in a module Web Worker, with a yielding fallback
when workers are unavailable; revision checks discard stale preview responses.
It returns an initial plan, then continues comparing alternatives in the background
for a bounded budget. **Improve layout** starts a longer search from the current
best; **Stop optimisation** stops it. Confirming a layout freezes that exact plan
for the cutting guide. Starting another search invalidates the old cutting guide.
The largest reusable remnant's dimensions are shown next to the sheet counts.

`dist/timber-planner.js` generates guillotine cut trees with kerf-aware residual
rectangles. Its initial pass compares 24 combinations of canonical part sorts,
placement fits, stock sizes, orientations and split directions; background search
then explores more strategies and mutations of the best candidate orders. Input
row order does not control placement. Candidate comparison is lexicographic:
unplaced count (or explicitly enabled priorities), unplaced area, used sheet count,
used stock area, then descending reusable remnant areas R1, R2, R3, etc. A larger
collection of small scraps cannot compensate for a smaller R1. Remnants must have
both edges at least 50 mm, matching the display. Compact occupied bounds and cut
length only break remaining ties. This follows the laser workspace's material
preservation approach while retaining timber's guillotine-cut constraints.
It is a bounded heuristic and does not guarantee the global optimum.
Numbered cuts respect parent-workpiece dependencies. The guide measures from a
workpiece's left/top edge to the finished edge, with the blade on the waste side.
Edge preparation precedes the numbered sequence. Confirm machine capacity,
blade setup and workpiece support before using a plan in the workshop.

Results include per-sheet SVG previews, selectable highlighted cuts, offcuts,
part labels/workpiece references, CSV cutting lists and cut guides, and a print
view containing every used sheet (also suitable for browser Save as PDF).
Every cut line and its sequence number is visible on the sheet layout and print
view without selecting a step. Selecting a step adds red emphasis while keeping
all other numbers visible. Number badges avoid one another; crowded layouts use
leader lines and an expanded right margin when needed.

Reusable offcuts (both edges ≥ 50 mm) on Review can be ticked and added to stock in
one go ("Add 2 offcuts to stock"): each becomes a stock row labelled `Offcut S1-W2`
with the sheet's material and thickness, its length along the sheet's grain, sizes
rounded down to 0.1 mm and quantity 1. The notice has Undo.
Review 上可剔選可用餘料（兩邊 ≥ 50 mm）一次加入板材，每塊成為一行「Offcut S1-W2」，
物料及厚度同原板，長度沿原板木紋，尺寸向下取至 0.1 mm，數量 1；提示內可撤銷。
The final sheet layout also offers **Play cuts**, Pause, previous/next cut,
Restart and a fixed 2× playback speed. Clicking a cutting-sequence instruction
starts playback immediately from that cut, with earlier cuts already separated. A moving marker traces each cut within its current
workpiece; finished cuts turn green and the matching guide instruction follows
the selected step. Playback starts after edge preparation. It pauses for printing
or a hidden page and resets when the sheet or plan changes. Print/PDF outputs
keep the full static numbered plan. Reduced-motion preferences use step highlights
without the moving marker.
**Separate pieces** is on by default during playback. After the cutting stroke,
the released sections slide apart before the next cut starts. The simulation
follows the guillotine workpiece tree, so later cuts and labels move with their
parent sections. Nested layouts reserve room for their separated descendants to
avoid overlaps. Restart reassembles the board; toggling the option switches to the
flat plan at the same playback position. Gaps are illustrative and do not change
part sizes, saved projects, CSV data or the static print/PDF geometry. Reduced
motion snaps to each separated state instead of animating the movement.
Cutting lists support CSV import with `length,width,qty` columns; optional
`label,material,thickness,priority,grain` columns use the downloadable template.
CSV defaults are Plywood, 18 mm, Normal priority and unlocked grain. A CSV import
replaces the part list. Exported per-piece lists use compatible dimension headers.
Projects save in browser local storage independently from the laser workspace;
JSON project download/open allows portable backups. There is no server project
storage. Limits: 100 part rows, 500 pieces, 50 stock rows and 200 sheets.

Run the timber correctness tests with `node tests/timber-planner.test.mjs`.


## Current sheet, docking and offcut controls / 現行板材、接合及餘料設定

- Landscape A4 297×210, A3 420×297 (initial selection), A2 594×420 and A1 841×594 mm.
- `cluster-docking.js` moves an entire existing contact component using real child
  straight-edge contact events. Original relative transforms stay intact. The
  connected result may exceed the four-part **new assembly** limit. Candidate work
  is bounded to 256 unique poses and a quarter of the cluster-stage deadline;
  continuation resumes the attachment queue. Full-layout validation and scoring
  still determine acceptance; this is not an exhaustive optimiser.
- Local multi-part junctions are accepted only when independently validated shared
  edges connect the incident parts at that exact point. Unrelated corner touches,
  interior overlap and remote clearance violations remain invalid.
- `offcutShapeWeight` is 0.35 in the UI, adjustable from 0 to 0.5. Offcut value is
  `w*h*(1-weight + weight*4*w*h/(w+h)^2)`. The bounded discount favours broader
  remnants without making a tiny square beat a much larger useful rectangle.
  Extraction and global ranking use this same value. Raw displayed/exported
  dimensions and area are unchanged. Zero (also the lower-level API fallback)
  exactly restores legacy area-only ranking described in older sections below.
- Multi-part tests include docking two pairs into a 2×2 junction and two triples
  into a six-part contact network. Export retains each original child and removes
  each shared cutting interval only once.

板材提供 A4–A1；已有 cluster 可保持內部排位，沿其他邊接到另一組，形成超過四件嘅網絡。
新組合搜尋仍設四件上限，接合另有候選及時間限制，唔保證全局最佳。
共用交點必須有同一位置嘅合法共邊連接證據，意外碰角及其他間距違規仍拒絕。
餘料比例偏好預設 0.35；0 代表舊式純面積排序。綠框提取同排位評分用同一綜合價值，
實際尺寸、面積及匯出 geometry 不會因評分而改變。

Working browser prototype for paper laser nesting, defaulting to original scale. 本機瀏覽器紙材排料試作版，預設保持原尺寸。

## Architecture / 架構

- `dist/importers.js`: strict ASCII DXF and SVG adapters; part ownership. 嚴格匯入及零件歸屬。
- `dist/geometry.js`: millimetre geometry, collision validation, retained drawing entities. 毫米座標、碰撞檢查及原始圖元。
- `dist/engine/`: MIT SVGNest in a disposable iframe with Web Workers; only collision contours enter the solver. 引擎只處理碰撞輪廓。
- `dist/exporters.js`: transforms original geometry; DXF retains arcs/bulges/layers and part GROUPs. 輸出保留曲線、layers 及群組。
- `dist/app.js`: review → configure → nest → export; no file uploads or backend state. 無圖檔上載或後端儲存。

Serve `dist/` with any HTTP static server. No installation or build is needed. Run checks with `node --test tests/*.test.mjs`.

以 HTTP server 提供 `dist/` 即可；無需安裝或 build。幾何測試指令同上。

## Release gates / 驗收

Automated fixtures cover scale, units, holes, engraving, closed line chains, groups, spacing, sheet bounds, arcs and unsupported content. Browser QA covers sample nesting, DXF/SVG imports, multiple sheets, export and agent controls. See `dist/about.html` for exact supported content and limitations.

測試包括尺寸、單位、孔洞、刻線、封閉線段、群組、間距、板邊、圓弧及不支援內容。完整支援範圍見 about 頁。

Production approval still requires Jacob's representative DXF and an AutoCAD reopen/dimension check. Native text/font fidelity, complex blocks, manual placement, hole nesting and production cutting-order validation are subsequent work.

正式使用前，仍要 Jacob 嘅代表性 DXF，並用 AutoCAD 重新開啟及核對尺寸。原生文字／字體、複雜 block、手動排位、孔內排料及共線切割屬後續工作。

## Direct nesting and reusable offcuts / 直接排料及餘料

The full configured angle grid is available immediately (default 1°). Initial
candidates use compact edge-aligned orientations. There are no timed rotation
stages. Results appear and can be exported during the 20-second improvement budget;
continuation inherits the best part order and angles.

Worker and parent share `dist/engine/util/offcut.js`. Ranking: place all parts,
minimise sheet count, then compare descending offcut areas lexicographically:
R1 first, then R2, R3 and so on. Extra small offcuts cannot compensate for a
smaller primary rectangle. Missing sequence entries count as zero. Equivalent
sequences are decided by occupied bounds and part-centre dispersion.

Extraction repeatedly reserves the largest clear rectangle until none meets
the selected minimum short edge. There is no fixed offcut-count limit. Equal-area
positions are compared through subsequent rectangles: up to 32 spatially spread
candidates and eight tied continuations are retained. These limits bound search
alternatives, not output count. The conservative grid uses at most 256 cells on
the longest edge, supplemented by exact edge strips. Part and mutual clearances
are preserved; holes are excluded. Approximation, bounded tie exploration and
the time-limited placement search do not guarantee a global optimum.

預設直接使用完整 1° 角度範圍，搜尋最多改善 20 秒，可承接結果繼續。
優先放齊零件、減少板材張數，再由最大餘料 R1 起逐塊比較 R2、R3……；
細餘料唔能夠抵銷最大塊縮細。序列相同時再收緊零件。
逐塊搜尋直到冇符合最短邊尺寸嘅長方形，不限兩塊或六塊。
同面積候選會比較後續餘料；最多保留 32 個分散候選及八條同分延續路徑，
限制係搜尋分支而非餘料數量。網格估算及限時搜尋未保證全域最佳。

`dist/compaction-worker.js` runs a bounded coordinate-descent pass alongside the
nesting worker. It slides parts to contact, tries permitted rotations and handedness,
and searches actual contour contact positions, including disconnected concave pockets.
Single-part candidates receive full scoring without a bounding-box proxy veto.
A resumable two-part repair search can relocate distant partners together; its
bounded beam and time budget remain heuristic. Full geometric clearance and shared fitness
validate every accepted move. Completed passes resume from the best current layout;
stop, reimport, changed settings and offcut selection terminate both workers.
No area-percentage threshold is used.

背景收緊程序按真實輪廓搜尋凹位，並可同時移開兩件零件重新排列。
單件候選位置不再由外框代理評分篩走；雙件搜尋使用有限候選及時間，未保證全域最佳。
每次接受完整排列均核對幾何間距及完整評分；
停止或變更設定會同時停止兩個運算程序；不使用面積百分比門檻。

## Recoverable material and transforms / 回收餘料及圖形變換

Both sides of each offcut must meet the user-selected minimum short edge
(default 20 mm; 0 removes this size restriction). This physical-size condition
applies consistently to optimisation, display and export. All extracted mutually clear rectangles are retained on each sheet. Optional export includes only selected frames: closed DXF polylines in
a green `OFFCUT_CUT` layer (uniquely suffixed on a source-layer collision), or an
SVG group. Export revalidates clearance against parts and selected frames.
Selecting cuts freezes the current layout; cutting frames are disabled by default.

User-selected uniform scale defaults to 100%. Optional mirroring defaults off and
transforms the complete group, including holes and engraving. Mirrored orientations
use angle + 360 internally to distinguish NFP cache entries; continuation preserves
handedness. DXF export adjusts arc sweeps, polyline bulges and circle radii.

餘料兩邊均需達到所選最短邊尺寸（預設 20 mm，0 不限）；逐塊提取，互不重疊，冇固定數量上限。可選擇輸出所選封閉切割框，
DXF 使用獨立綠色 `OFFCUT_CUT` layer，SVG 使用同名 group。匯出前重新核對間距。
比例預設 100%，鏡像預設關閉；孔洞、文字輪廓及刻線跟隨整組變換。
測試包括多塊餘料、最短邊尺寸、選擇性輸出、切割框碰撞、鏡像弧線及縮放往返。

## Common-edge geometry preprocessing / 共邊幾何預處理

`dist/common-edge.js` adds source-aware exterior straight edges with endpoints,
length, unit direction, angle, outward normal and part/contour/edge provenance.
DXF bulges and curved SVG samples are excluded; SVG imports retain source line
segments separately. Polygon-only callers must supply genuine straight polygons.
Hole edges can be represented by `extractPolygonEdges`, but sharing candidates
currently exclude holes and conservative hull segments without source support.

`edgeCompatibility` checks parallelism, opposite facing and minimum useful length;
its `maxOverlap` is the potential after alignment, not the current spatial overlap.
`sharedSection` checks the actual collinear overlap at supplied placements.
`commonEdgeCandidates` generates endpoint events with exact collinearity on the
existing rotation grid, retaining scale and handedness. No along-edge sampling.
The compaction pipeline retains its scoring gate. By default, its original
clearance gate still rejects shared contact. With `commonEdgeMode: true`, explicit
candidate contact declarations pass through `dist/common-contact.js` instead.
Shared-edge scoring and export-only line cleanup are described below;
kerf compensation remains separate. Debugging uses
`onCandidate` and `commonEdgeCandidateCount`; generator output identifies both
edges, the fixed pose, endpoint event and verified shared interval.

共邊預處理只辨認有原圖依據嘅外輪廓直邊，不將曲線取樣或保守 hull 邊當成切線。
支援可調角度容差、反向朝向、不等長及部分重合；潛在共享長度同實際重合分開計算。
端點事件產生旋轉及平移候選，遵守角度網格、比例及鏡像；保留 NFP 候選來源。
預設保留原有間距及評分；API 設定 `commonEdgeMode: true` 先啟用指定共邊驗證。
共邊評分及 export-only 共線清理見下文；未加入 kerf 補償。


### Explicit shared-boundary clearance / 指定共邊間距

`contactFromCandidate` records source edge references and the exact shared interval
in both parts' local coordinates. `commonContactClearance` validates those
references and transforms, rejects interior overlap and any contact outside the
declared interval, and checks all remaining boundary segments against normal gap.
Clipper intersection uses a 0.000001 mm coordinate grid with a perimeter-based
rounding allowance; this is numerical tolerance, not fabrication kerf.

At a shared endpoint, directly incident straight boundary rays necessarily begin
at zero distance. Only their first gap-length run-out is excluded from distance
checks. Extra touching remains forbidden, and remote segments get no exemption.
This conservative rule can reject acute-angle contacts that remain too close
after the run-out. Collinear subdivision does not enlarge the allowance.

`replacePlacement` removes stale outgoing and incoming contact declarations when
moving a part. The compactor and final layout validator use the same enabled
validation path. Missing/false `commonEdgeMode` uses the original clearance path,
ignoring contact metadata. The website now exposes common-edge mode, its weight, pair clusters and independent export cleanup.
Export-only shared-line cleanup is now available separately, as described below.

共邊記錄綁定原始直邊及兩件零件各自座標內嘅指定區間；移動後失效嘅記錄會被清除或拒絕。
指定區間以外嘅接觸、面積重疊及其他邊間距不足會被拒絕。
共邊端點只豁免直接相連直邊最初一段 gap 長度；其他位置唔會獲得整對零件豁免。
急角若仍然太近會保守拒絕。關閉功能完全沿用原有驗證；網站現提供共邊、權重、pair cluster 及匯出去重控制。
匯出共線去重現已獨立實作，見下文。


### Common-edge scoring / 共邊評分

With `commonEdgeMode: true`, `evaluateLayout` retains lexicographic priorities:

1. Fewer unplaced parts.
2. Fewer sheets.
3. Larger reusable offcuts, largest first.
4. Smaller total occupied bounding area.
5. Lower cutting cost: `cutLengthWeight * estimatedCutLength - commonEdgeWeight * sharedLength`.
6. Existing positional compactness tie-breaker.

Both weights default to 1 and accept finite non-negative numbers. Set both to 0
to disable cutting preference. No weight can override an earlier material or
bounding decision. This is intentionally conservative: even a small material
improvement takes precedence over cutting savings. The base nesting worker keeps
its material search; the compaction candidate scorer and main-thread acceptance
use this extended score. The compaction worker receives entity data when enabled,
so its cutting estimate agrees with the main thread.

The returned `cutting` report includes `rawCutLength`, `sharedLength`,
`estimatedCutLength` and `pierceCount: null`. Native lines/arcs/circles use physical
lengths; SVG curves use sampled length estimates. Source details are included in
the raw path total. Only validated declared shared intervals with matching
fabrication operations earn credit, unioned to avoid double counting. Estimated
length is raw length minus the credited shared length. Pierce count is not
inferred from contour or edge count because no cutting-order planner exists.
Disabled mode retains the original five-component score.

先比較排入完整度、板材數、由大至小餘料、bounding area，再比較切割成本，最後比較原有
位置緊密度。共邊權重再高都唔會壓過前面嘅物料條件。兩個權重預設 1，可設為 0；
pierce count 未有刀路規劃依據，回傳 null。只有有效且加工設定相容嘅共邊先會扣減估計切線長度。

### Export-only partial common-line cleanup / 匯出階段部分共線清理

`mergeCommonLines` in `dist/common-line.js` accepts transformed mm segments.
It groups collinear coincident lines, splits at all overlap endpoints, canonicalises
direction and emits every covered interval once. Default distance tolerance is
0.000001 mm; angular parallelism tolerance is 1e-10 in unit-vector cross product.
Endpoint-only touching has no shared length. Tiny non-shared tails and gaps are
retained. Output includes source ownership for each interval.

Both exporters accept `{ mergeCommonLines: true, lineTolerance: 1e-6 }`,
independently of placement mode; the default follows `settings.commonEdgeMode`.
An explicit false preserves original export behaviour. Cleanup only edits an
export copy via `prepareCommonLineExport`; source polygons, placements, holes
and their topology are untouched. Export paths can become open segments and a
shared section belongs to its first source group, so cleaned files are cutting
geometry rather than complete per-part closed CAD contours.

All straight source segments, including polylines and SVG L/Z commands, are
compared after scale, reflection, rotation and translation. Bulge arcs, circles
and cubic SVG curves remain curves. New SVG imports retain normalised commands
and physical matrices for exact curve reconstruction; older SVG imports with
straight segments must be re-imported before cleanup. Different layers, colours
or operation settings are never merged. Recovery outlines are cleaned separately
within their own operation. Kerf compensation and cutting order are not changed.

匯出時先用最終 mm 座標偵測重合，再按 overlap 端點拆段；例如 0–100 加 30–70，
輸出 0–30、30–70 一次、70–100。原始零件輪廓及 topology 不變；清理後嘅切割輸出
會拆成開放線段，共邊只歸其中一個來源 group。不同加工設定不合併，曲線保留；
舊 SVG 資料若缺少 command metadata，需要重新匯入。未改 kerf 或切割順序。


## Multi-part clusters / 多件共邊組合

`dist/multi-cluster.js` builds a bounded compatibility graph, retains alternative
pair memberships, and expands selected candidates to three and four parts.
`clusterBeamWidth` defaults to 8, `maxClusterParts` to 4, and minimum shared
length to 1 mm. Per-node neighbours, contact events and phase time budgets are
bounded; a worker continuation resumes the seed-pair queue. This is a heuristic,
not an exhaustive optimal solver.

`createPartCluster` in `dist/pair-cluster.js` validates every child pair and unions
real exterior polygons with Clipper. It accepts 2–4 original children, rejecting
disconnected and holed unions. `expandPairCluster` retains its legacy name but
restores every original child, its source entities and composed transform.
Normal external clearance and final full-layout validation still apply.
The old `compactPairClusters` path remains when multi-part search is disabled.

Local beam ranking considers bbox utilisation, an explicitly approximate narrow
void measure, cutting length, connected-contour pierce lower bound and perimeter.
The ordinary search branch remains available until the end of the job, when its
full layout is compared with the cluster alternative. Acceptance uses the unchanged
full-sheet lexicographic score: unplaced count,
sheet count, largest-first reusable rectangles, bounding area, cutting cost and
compactness. More sharing cannot override a worse material score. Limited search
time can nevertheless produce a different result than the legacy search.

Exact diagonal contact rotations are enabled independently of the ordinary angle
grid, except with rotation locked. New options are `multiPartClusteringEnabled`,
`maxClusterParts`, `clusterBeamWidth`, `diagonalCommonEdgesEnabled` and
`preserveRemnantSplitLines`. The UI enables the first, fourth and fifth by default;
common-edge nesting itself remains opt-in.

`remnant-policy.js` separates source part boundaries, common cuts, remnant
boundaries and generated split lines. Selected offcut cutting rectangles can be
reserved during continuation; turning preservation off releases them. Unselected
green display rectangles never become obstacles. Exported shared segments record
all source owners; partial straight overlaps work at arbitrary angles.

Enable **Record nesting diagnostics** before arranging, then download the JSON.
Each worker job includes bounded detailed events, aggregate counts, recent
selection decisions and final placements/score. Limits and deadlines are reported;
not every candidate is guaranteed to be visited or retained in the trace.

多件搜尋保留不同 pair 組合，再擴展至三、四件，並按真實 union 外輪廓參與現有排位。
候選數量及時間均有上限，唔保證全局最佳。每個接受結果仍要通過全板驗證及原有物料優先評分。
斜邊用精確接觸角度；內部指定共邊零間距，其他外邊保持正常 gap。原始 child geometry 保留。
已選餘料切割框可喺繼續排位時保留或釋放；單純顯示綠框唔會成為障礙。
診斷下載包含生成、拒絕、評分、剪枝及時間上限資料；詳細事件有數量上限。

Regression tests: `node --test tests/*.test.mjs`.
Benchmark: `node scripts/benchmark-multipart.mjs` (three isolated runs per case,
8/24/100 parts, original v0.9.2 source versus new features disabled/enabled).
Full report: `outputs/multipart-review.md`; raw results: `outputs/multipart-benchmark.json`.

## Profiling and repeatable benchmarks / 效能量度

`compactLayout(..., {profile:true, optimise:false})` provides uncached counters and
inclusive timings. Default optimisations are bounded per-job caches (5,000 entries
per category): transformed contours/edges, source edges, shared-pair validation,
Minkowski sums and complete layout scores. Exact duplicate candidate requests are
rejected before validation; existing candidate sources, angle grid, spacing and
offcut grid resolution are unchanged. Cache keys include transforms, contact
metadata and settings; caches are destroyed after every synchronous job.

The offcut histogram uses typed-array stacks and avoids allocating rectangles
that cannot change its result. The retained pre-optimisation collector is
`benchmarks/baseline/offcut.js`, used only for reproducible comparisons.

Run with Node:
- `node --test tests/*.test.mjs`
- `node scripts/benchmark-common-edge.mjs` (8/24/64 parts, baseline/off/on/pairs,
  three repetitions; writes results under outputs)
- `node scripts/benchmark-offcuts.mjs` (identical fixed-work offcut outputs)

The full benchmark recreates an instrumented baseline in ignored work/ using the
current candidate sources with optimisations disabled and the original collector.
Each case runs two 900 ms jobs; this measures time-bounded throughput and retained
layout quality, not completion time or a global optimum. One indivisible geometric
or scoring call can overrun its budget. Counts include candidate requests before
deduplication and collision API calls including memo hits; computation/cache-hit
counters distinguish actual work. Material utilisation is summed exterior part
area divided by sheet area, including enclosed detail holes in that exterior
area. It stays constant when the same parts occupy one sheet, so largest offcut
and occupied bounding area are reported separately.

量度包含所有要求嘅項目；collision calls 包含 cache hit，實際 computations 另列。
同一批零件用一張板時總面積利用率固定，必須同最大餘料及 bounding area 一齊比較。
固定時間搜尋唔代表完成時間或最佳解；單次完整幾何／評分計算可能超出時間預算。
目前最值得再優化嘅方向係增量餘料佔用格／row spans，重用未移動零件嘅資料，
保持現有解析度，而唔係減少候選或降低精度。

## v0.9.1 profiling / 第二輪效能量度

Offcut collection now reuses the unchanged input-part occupancy mask within each
collection and removes duplicate continuation states before their expensive
analysis. Resolution, candidate sources, tie retention and ranking are unchanged.
A frozen v0.9 collector tests complete-report equivalence.

餘料計算重用單次 collection 內原始零件佔用格，並提前排除重複分割狀態；
解析度、候選來源、保留平手方案數量及評分規則不變。

Reproduce the current-baseline comparison:

- `node scripts/benchmark-v09.mjs` (reconstructs published v0.9 from Git; three runs
  each of baseline OFF/new OFF/baseline ON/new ON at 8/24/64 parts)
- `node scripts/benchmark-v09-offcuts.mjs` (fixed-work exact-output comparison)
- `node scripts/check-v09-search-parity.mjs` (after baseline reconstruction)

These measure the compaction stage, with four orientations and no pair clusters;
they do not measure the complete browser workflow or guarantee 360-angle timings.
24/64-part fixed-work offcut calculation was about 1.94/1.99× faster on the tested
machine; eight-part speed was unchanged. Whole-workflow improvement is smaller.

以上係四方向、關閉 pair clusters 嘅 compaction 測試，唔係完整瀏覽器流程或
360 方向速度保證。24／64 件固定工作量餘料計算約快 1.94／1.99 倍；8 件不變。
完整流程改善幅度較細。原始數據及雙語報告會寫入 outputs。

## DXF compatibility / DXF 相容性

The R2004 exporter writes a complete document skeleton (APPID and other symbol
tables, block records, model/paper space, layouts and dictionaries), unique
handles and explicit model-space owners. Layers include valid plot-style and
material references; Unicode names use R2004 ASCII escapes. The initial view is
centred on the sheet. Browser exports have no new runtime dependencies.

R2004 輸出包含完整 tables、model/paper space、layouts、ownership 同有效 layer
plot-style references；中文字用 DXF Unicode escapes。初始視圖對準板材。

The skeleton is generated by `scripts/generate-dxf-template.py` with ezdxf 1.4.4
(development only); format the resulting module with Prettier. Run Node tests,
then `scripts/validate-dxf.py work/dxf-fixtures/*.dxf` with ezdxf installed for
independent audit. `scripts/audit-dxf.scr` counts entities, checks units and runs
AUDIT without repairs in AutoCAD Core Console; it exits without saving.

AutoCAD 2027's native reader rejected the previous file with `Error in APPID
Table`; native testing also identified missing layer PlotStyleName (390).
The repaired sample and common-line/offcut exports open with 0 audit errors,
0 fixes and 0 erased entities. Illustrator GUI verification remains outstanding.


## Manual workspace

Setup, Auto Nest, Manual Edit and Export have separate panels. Collapse Settings or maximise the canvas for more working space; use wheel zoom, Fit, and Space-drag to pan.

After nesting, Manual Edit supports drag, Shift-selection, custom rotation, magnetic straight/diagonal partial-edge snapping, grouping, detaching, locks and 100-step undo/redo. Snapping projects onto the shared line while preserving movement along it. Within the 10-screen-pixel capture range, edge endpoints align along that line; away from endpoints, sliding remains free. Sheet-margin snapping uses the actual rotated exterior of the selection and honours the configured margin (including zero). Every candidate retains normal collision, clearance and lock validation. Invalid positions remain previews and are rejected on release. Rotate & Snap requires an explicit click.

Manual placements become the export source. Export rebuilds common lines from final geometry. Lock a selection before Re-optimise unlocked to preserve its exact transforms. This refinement uses the existing compaction search; it is not a guarantee of a globally optimal re-nest.

Area percentage measures part footprint divided by sheet area, so moving the same parts on the same sheet does not change that percentage; bounding extent, reusable offcuts and shared cutting length show layout improvements. Editing history is session-only and is reset by a new import or a fresh Auto Nest.


### Automatic alignment

With enhanced common-edge nesting enabled, each compaction job first checks nearby shared edges and endpoint alignments for individual parts and existing contact groups. This pass has a bounded share of the search budget and only accepts improvements under the existing global score; it does not increase common-edge weight or relax spacing. Manual rejection messages retain the actual validator reason after release. Clearance simplification deduplicates consecutive vertices before removing collinear points, preserving genuine corners in imported and sample contours.


## Four-step workflow and separation strategy

1. Setup: import/review groups, set sheet, spacing, margin, rotation and common-edge/remnant rules. Material is a descriptive choice, not a machine preset. Separation kerf only protects parts from added recovery cuts; it does not offset part outlines.
2. Auto Nest: confirm groups and run nesting.
3. Manual Adjust: optional move, snap, group and lock.
4. Review & Export: choose full remnant frames or quick full-sheet separation, select cuts, compare additional and estimated total lengths, then export.

Quick separation is post-processing only. At most one horizontal and one vertical cut are proposed, outside the occupied exterior envelope and at least half the configured kerf away from all parts, plus a 0.01 mm numerical guard. Candidates recover an outer strip meeting the minimum offcut-side setting. No safe outer strip means no proposal. Lines reach the physical sheet edges regardless of margin. This conservative first version rejects contact with existing part/common boundaries rather than merging into those boundaries. Duplicate selected separation lines are canonicalised. Both exporters revalidate final geometry and use a separate SEPARATION_CUT layer/group; they reject simultaneous full-frame and quick-cut output. Cut-order execution remains controlled by the laser software.


## Downloads and language (0.22)

Use the header’s English / 繁體中文 switch on the chooser and both workspaces.
The preference stays in the browser. Timber instructions, playback labels,
CSV cutting-guide operations and PDF/print guides follow the selected language.
Switching language preserves inputs, the layout, selected sheet and playback step.
Part names and material values remain user data. CSV column keys stay stable.

Timber has a direct Download PDF action in Review & Export, in addition to Print.
The PDF contains every used sheet with numbered cuts and the corresponding
step-by-step guide, using an embedded Traditional Chinese font. PDF libraries and
the font load locally on demand; no external document service is used.

Timber CSV, project JSON, PDF and laser SVG/DXF/diagnostics exports share a save
helper. It uses the browser save picker when available. The fallback retains a
visible download link and its Blob URL so the user can retry the save, and offers
opening the workspace in a browser tab when an embedded browser restricts saving.
Cancelling the picker does not trigger a second download.

Validation: 27 Node test files passed; DOM interaction checks covered every export
button, picker success/cancel/fallback, language changes during playback, unchanged
project values and the four-step flow. Generated English and Traditional Chinese
PDFs were parsed and the Chinese guide was visually inspected. These DOM checks
do not verify delivery to a real browser’s download folder.


## Timber cut minimisation (0.23)

Timber now compares placed parts, stock sheets/area, then actual cut count before
ranking reusable offcuts. Thirty initial layout seeds include a cut-count strategy.
Each candidate also searches for a simpler guillotine tree at the same part
positions: matching edges can be cut across the current panel before the parts
are separated. The search is bounded and always retains the original valid tree;
it does not claim a globally minimal cut count.

A repeated four-part grid on a 100 × 100 panel with 3 mm kerf drops from seven
cuts to five. Two 40 × 40 parts on an 83 × 100 panel need two cuts: one shared
40 mm width-setting cut, then one cut that releases both finished pieces. The
sample cabinet drops from twelve cuts to eleven while using the same one sheet.

Live statistics include cut count. Review explains shared edges, cuts removed
from the initial placement sequence, and cuts that release two finished pieces.
Numbering, prerequisites, board separation, PDF, print and CSV all use the revised
tree. CSV adds shared_part_edges, released_parts and instructions columns. Manual
editing retains its placement regions and commands, so Auto Nest → Manual Adjust,
undo and saved project replay keep the same positions and rotations.

Regression checks cover matching dimensions, differing part lengths, kerf, trim,
grain, cut dependencies, area conservation, search budget fallback, cut priority,
manual replay and bilingual keep-both instructions. DOM interaction checks cover
shared-cut numbering, animation, exports, language switching and the four-step
workflow. Full browser visual QA is unavailable in this environment.


## Continuous shared cutting passes (0.24)

The cutting model now separates individual workpiece splits from physical saw
passes. Root-cut alternatives and whole-line sweep trees are compared by scheduled pass count, alignment
work, then the earlier cut/offcut criteria. The scheduler waits for matching
collinear workpieces to become available instead of cutting the first one early.
It groups them into one pass only when no other uncut workpiece blocks the path.
This remains a bounded heuristic, without a guarantee of a global optimum.

The user's 2440 × 1220 screenshot is a regression fixture. At the same finished
part positions, the upper 764 × 450 panels now receive one horizontal cut at
450 mm across the remaining 2298.4 mm panel after removing the right-hand strip,
before column separation. This matches the order proposed in the screenshot. The layout needs
eight shared passes instead of the previous ten steps. One pass can split more
than one workpiece, so the former n−1 binary-split lower bound is no longer a
lower bound on physical passes. An exact 2 × 2 grid needs two registered passes.

Shared passes require the listed workpieces to remain aligned in their original
sheet positions; completed parts and offcuts outside the pass are set aside.
These conditions appear in English and Traditional Chinese instructions, playback
notes, print and PDF guides. No stacking is assumed. One number labels each pass;
all its member segments are drawn and the saw trace advances across them in order.
The simulation opens every member split at the end of that pass. Material/kerf
accounting uses all member segments rather than counting only the representative.

CSV has one row per pass, lists all input/output workpiece IDs, and adds
alignment_required and segments_json. Measurements that differ between members
are left blank in the common columns and recorded per workpiece in the detailed
instructions and JSON. PDF guides paginate long shared-pass instructions.

Validation: all 28 Node test files passed, including the screenshot, live-frontier
availability, blocking workpieces, material area, kerf, numbering, trace sequencing,
separation, manual replay and existing laser regressions. DOM checks cover the
same eight-pass fixture, CSV/print/PDF agreement, Traditional Chinese, playback and
four-step navigation. Full browser visual QA is unavailable in this environment.


## Interface colour language and actions (0.25)

`dist/theme.css` holds one shared set of colour names, loaded before every other
stylesheet. Timber uses an orange accent and laser (paper) uses blue; everything
else is neutral. Fixed meanings in both workspaces: green = reusable offcut,
red = current/selected cut, amber = warning.

Each step shows one main (filled) button. In timber, steps 2 and 3 share a single
forward action, **Use this layout · Review & Export**, which confirms the shown
layout exactly as the former in-canvas confirm button did; **Adjust manually first**
opens step 3. Review shows **Download PDF** with Print and both CSVs under
**More exports**. In laser, Tighten layout and Re-optimise unlocked are secondary
and a disabled Next stays quiet. No planning, nesting or export logic changed.

The laser and about pages show one language at a time (`data-single-language`).
`locale.js` pairs an English label with the Chinese text right after it (text,
`<small>`, `<span>` or a `<br>` line) and `locale.css` hides the other language;
the text stays in the page. Inline glosses such as `Shared / 共邊 12 mm` keep the
matching side. Laser setup shows drawing, sheet size, gap and margin; everyday
adjustments sit under **More options** and search tuning under **Expert settings**.


## Saw type and cut order (0.25)

Timber Setup has a **Saw** setting, saved with the project (older projects default to
panel saw). The finished parts and their positions can be the same; what changes is
how the cutting guide orders and groups the cuts.

- **Panel saw · long lines first** (vertical wall saw, track saw). Pieces stay where
  they are, so one pass may run through several workpieces held in line. Waste strips
  come off first, then a straight line that crosses the whole panel is cut while the
  panel is still one piece, and the pieces either side are then divided in the same
  order so later cuts pass through them together. Among plans with the same number of
  passes, fewer and shorter "keep aligned" passes win. Candidate trees now treat a
  kerf-wide gap between neighbouring parts as part of one straight line and include a
  sweep that reuses lines already cut, in the order they were cut.
- **Table saw · fence settings**. The blade stays still and each piece is pushed past
  it, so no step asks for pieces to be held in line. Plans rip the sheet into strips
  along the grain before crosscutting (the widest crosscut is kept as narrow as
  possible, also when choosing the automatic layout), then use as few fence settings
  and feeds as they can. The kept piece goes between the fence and the blade; when both
  sides are kept, the narrower side does. Pieces that are ready together and need the
  same fence distance share one step ("Fence at 450 mm · 3 pieces, one after another");
  when a cut produces another piece needing that distance, the next step says
  "fence unchanged". Fence capacity is not limited. The cut-guide CSV adds `saw`,
  `fence_mm` and `fence_edge`.

- **Hybrid · panel saw, then table saw**. The panel saw breaks the sheet down while a
  workpiece is longer than **Table saw for pieces up to** (1,220 mm by default, shown only
  in Hybrid); once a piece is that size or smaller, it and everything cut from it go to
  the table saw. All panel-saw steps come first, using the panel-saw rules; the rest use
  the table-saw rules. Each step starts with its machine, and the first table-saw step
  says to move the pieces across. Plans compare total steps, then pieces held in line,
  then fence settings.

In Hybrid, cut numbers and lines on the sheet (and in the PDF) use one colour per
machine: steel blue for the panel saw, violet for the table saw. Filled = completed,
outline = still to cut, red = current cut. The legend and the step list use the same
colours.

The ⓘ button beside **Saw** opens a floating explainer (`dist/timber-saw-help.js`): why
the board-still / blade-still difference changes the cut order, with a small diagram
of each saw (panel saw from the front, table saw from above, hybrid as long lines then
short cuts) and a button to choose it. It closes with ×, Escape or a click outside.

The 26 Oct 2026 screenshot is a regression fixture (`tests/timber-saw-modes.test.mjs`):
on a panel saw the order is bottom strip, right strip, the 450 mm line across the
2,254.4 mm panel, then the 720 and 764 mm column cuts through both strips.
