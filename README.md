# Paper Nest / 紙材排料

Working browser prototype for full-scale paper laser nesting. 本機瀏覽器紙材排料試作版。

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

## Rotation refinement / 旋轉精排

Default: 15° for 10s → 5° for 15s → 1° for 35s. Later stages inherit the best
validated part order and angles. Fine stages mostly mutate nearby angles, retaining
some global exploration. Continue adds 30s at 1° in Auto mode; manual modes retain
their selected angle grid. Stop cancels the disposable engine and retains the result.
The parent compares layouts lexicographically: unplaced parts, sheet count, total
occupied width. The engine uses the same priorities. Original entities only receive
rigid rotation and translation; 1° is a search grid, not fabrication accuracy.

預設依次用 15°、5°、1° 搜尋，承接最佳零件次序及角度。自動模式可繼續 30 秒精排；
手選模式沿用設定級距。隨時可停止，保留有效最佳排位。優先放齊零件，其次減少板材張數，
再收窄佔用闊度。原始圖元只會旋轉和平移；1° 並不表示加工精度或保證最佳解。
