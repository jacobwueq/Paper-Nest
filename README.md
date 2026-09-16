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

Worker and parent share `dist/engine/util/offcut.js`. Both rank: unplaced count,
sheet count, largest single clear rectangle (descending), the sum of squared areas
of up to six clear rectangles (descending, with no 15% threshold), occupied bounding
area, and part-centre dispersion. Greedy placement first preserves a large edge
rectangle, with cached bounds to avoid rescanning all vertices at every candidate.
The final fitness also finds interior rectangles using a conservative occupancy
grid. Thin contours cannot disappear between samples. Offcuts reserve margins and
part clearance; holes are excluded. Grid approximation can underestimate concave
or curved free space. A global maximum or arbitrary-shaped offcut is not guaranteed.

預設直接使用完整 1° 角度範圍，先用緊密方向建立排位，沒有分階段旋轉等待。
搜尋最多改善 20 秒，結果即時顯示並可匯出。前後端同用餘料評分：先放齊零件，
再減少板材張數，然後最大化單塊長方形餘料、集中其餘空間，最後縮小零件佔用範圍及拉近零件。
網格估算保守保留輪廓及間距，可能低估曲線和凹形空間，未保證全域最佳或任意形狀餘料。

`dist/compaction-worker.js` runs a bounded coordinate-descent pass alongside the
nesting worker. It slides parts to contact, tries permitted rotations and handedness,
and reinserts them at candidate gaps. Full geometric clearance and shared fitness
validate every accepted move. Completed passes resume from the best current layout;
stop, reimport, changed settings and offcut selection terminate both workers.
The 15% threshold affects only the displayed/exportable rectangles, never fitness.

背景收緊程序會逐件移近、轉動及重新試位。每次接受移動均核對幾何間距及完整評分；
停止或變更設定會同時停止兩個運算程序。15% 只用於顯示及切割框輸出。

## Recoverable material and transforms / 回收餘料及圖形變換

Each numbered offcut must cover at least 15% of the full original sheet area.
Greedy extraction reserves each rectangle before finding the next, so they do not
overlap. Optional export includes only selected frames: closed DXF polylines in
a green `OFFCUT_CUT` layer (uniquely suffixed on a source-layer collision), or an
SVG group. Export revalidates clearance against parts and selected frames.
Selecting cuts freezes the current layout; cutting frames are disabled by default.

User-selected uniform scale defaults to 100%. Optional mirroring defaults off and
transforms the complete group, including holes and engraving. Mirrored orientations
use angle + 360 internally to distinguish NFP cache entries; continuation preserves
handedness. DXF export adjusts arc sweeps, polyline bulges and circle radii.

每塊餘料至少佔原板面積 15%，逐塊保留，互不重疊。可選擇輸出所選封閉切割框，
DXF 使用獨立綠色 `OFFCUT_CUT` layer，SVG 使用同名 group。匯出前重新核對間距。
比例預設 100%，鏡像預設關閉；孔洞、文字輪廓及刻線跟隨整組變換。
測試包括多塊餘料、15% 門檻、選擇性輸出、切割框碰撞、鏡像弧線及縮放往返。
