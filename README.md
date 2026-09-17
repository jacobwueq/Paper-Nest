# Paper Nest / 紙材排料

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


## Pair clusters / 成對組件

`dist/pair-cluster.js` is a non-recursive prototype. `createPairCluster` accepts
two valid declared sharing parts, unions their transformed outlines with Clipper,
and returns a macro `outer`, an initial pose, and two original `children`
references plus relative placements. It rejects disconnected unions, unions with
holes, recursive children and pairs linked to a third part. It never substitutes a
convex hull for the union. Interior zero-clearance is checked before construction.

`compactPairClusters` feeds that exterior to the existing `pocketTranslations`
configuration-space placement source with the normal gap. It expands each trial
through `expandPairCluster`, validates the original children against the complete
layout, and applies the unchanged global scoring priorities. Only improvements
are accepted. Jobs inspect existing shared pairs before ordinary single-part
search; newly formed pairs are available on the next continuation job. The macro
is temporary; final UI placements and exporters receive original child IDs,
entities, local shared-edge references and composed transforms. The helper
`expandClusterLayout` also exposes this conversion directly.

第一版只做 pair，使用兩件 union 嘅真實外輪廓。內部指定共邊零間距，外部維持一般 gap；
候選還原原始零件後再做完整驗證及評分。拒絕含孔、多區域、遞迴及連到第三件嘅組合。
新形成嘅共邊 pair 會喺下一次延續計算參與整體移動，匯出一直使用原本 child geometry。

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
