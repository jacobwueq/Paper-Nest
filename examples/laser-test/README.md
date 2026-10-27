# Laser stress test / 鐳射壓力測試

`laser-test-a2-80-parts.svg` and `.dxf` (same drawing): 80 irregular parts, the most the
importer accepts, for an **A2 sheet (594 × 420 mm)**. Regenerate with
`python3 scripts/make-laser-test.py` (same file every time).

| Parts | Shape | Openings |
| --- | --- | --- |
| 6 frames | wavy outline ~176 × 136 mm | one irregular opening ~115 × 85 mm |
| 4 gears | 16 teeth, Ø 124 mm | Ø 50 mm bore + four Ø 8 mm bolt holes |
| 4 rings | lumpy, Ø ~112 mm | lumpy opening Ø ~77 mm |
| 2 arches | deep U, 140 × 100 mm | none (concave pocket) |
| 8 stars, 10 blobs, 8 brackets, 6 leaves | 5–8 points, noisy, L/T/zigzag, pointed | none |
| 32 small parts | stars, pebbles, triangles, crescents, washers | washers: small hole |

Blue lines (layer SCORE) are score lines and must not count as openings.

**What to try / 測試方法**
1. Laser cutting → import → Sheet A2 → Arrange. A first layout appears within about
   2 s (all 80 parts, 3 sheets); compaction then tightens it.
2. Repeat with More options → **Place small parts inside openings**. The first layout
   already has about 27 parts inside the frames, gears and rings; compaction also
   moves parts into openings on other sheets.
3. Compare sheets, "Area %" and time. Use "Tighten layout" for more time.

**Findings (v0.32.0)** — the nesting engine (SVGnest) had not finished a single layout
of these shapes within its 20 s budget, even with only 20 of them, so before 0.32.0
the page said "No valid layout found". The instant shelf layout fixes that. With 80
detailed parts, compaction is slow: each move's pocket search builds no-fit polygons
from outlines with 60–200 vertices. Faster pocket search for detailed outlines is the
next thing to improve.
