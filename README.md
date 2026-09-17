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

Production approval still requires Jacob's representative DXF and an AutoCAD reopen/dimension check. Native text/font fidelity, complex blocks, manual placement, hole nesting and common-line cutting are subsequent work.

正式使用前，仍要 Jacob 嘅代表性 DXF，並用 AutoCAD 重新開啟及核對尺寸。原生文字／字體、複雜 block、手動排位、孔內排料及共線切割屬後續工作。

## Direct nesting and reusable offcuts / 直接排料及餘料

The full configured angle grid is available immediately (default 1°). Initial
candidates use compact edge-aligned orientations. There are no timed rotation
stages. Results appear and can be exported during the 20-second improvement budget;
continuation inherits the best part order and angles.

Worker and parent share `dist/engine/util/offcut.js`. Ranking: place all parts,
minimise sheet count, maximise the combined area of up to two usable rectangular
offcuts per sheet, then favour the largest primary rectangle, reduce occupied
bounds and part-centre dispersion. The fast initial placement compacts the envelope;
complete candidates and contour repair use the shared full score.

Horizontal and vertical grid splits jointly search both rectangles instead of
fixing the largest first. Exact edge-strip alternatives are also compared. A
conservative grid has at most 256 cells on the longest edge. Both offcuts reserve
part clearance and mutual clearance; holes are excluded. Grid approximation and
the time-limited placement search do not guarantee a global optimum.

預設直接使用完整 1° 角度範圍，搜尋最多改善 20 秒，可承接結果繼續。
優先放齊零件、減少板材張數，再最大化每板最多兩塊長方形餘料嘅合計面積；
合計相同時保留更大第一塊，然後收緊零件。共同搜尋橫向及縱向分割，
亦比較精確邊帶。網格估算及限時排料未保證全域最佳。

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
applies consistently to optimisation, display and export. Up to two mutually clear
rectangles are retained on each sheet. Optional export includes only selected frames: closed DXF polylines in
a green `OFFCUT_CUT` layer (uniquely suffixed on a source-layer collision), or an
SVG group. Export revalidates clearance against parts and selected frames.
Selecting cuts freezes the current layout; cutting frames are disabled by default.

User-selected uniform scale defaults to 100%. Optional mirroring defaults off and
transforms the complete group, including holes and engraving. Mirrored orientations
use angle + 360 internally to distinguish NFP cache entries; continuation preserves
handedness. DXF export adjusts arc sweeps, polyline bulges and circle radii.

餘料兩邊均需達到所選最短邊尺寸（預設 20 mm，0 不限）；每板最多兩塊，互不重疊。可選擇輸出所選封閉切割框，
DXF 使用獨立綠色 `OFFCUT_CUT` layer，SVG 使用同名 group。匯出前重新核對間距。
比例預設 100%，鏡像預設關閉；孔洞、文字輪廓及刻線跟隨整組變換。
測試包括多塊餘料、最短邊尺寸、選擇性輸出、切割框碰撞、鏡像弧線及縮放往返。
