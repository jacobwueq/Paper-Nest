"""Laser stress test drawing: 80 irregular parts (the importer's limit) for an A2 sheet.

    python3 scripts/make-laser-test.py   -> examples/laser-test/laser-test-a2-80-parts.svg / .dxf

Big parts have large cut-through openings (frames, rings, gears) and 32 small parts are
sized to fit inside them, to test "Place small parts inside openings". Shapes are
deliberately irregular (noisy outlines, concave pockets, stars, gears). Score lines are
on a separate layer and must not count as holes. Deterministic: same file every run.
"""
import math, random, pathlib

rng = random.Random(2610)
OUT = pathlib.Path(__file__).resolve().parent.parent / "examples" / "laser-test"
parts = []  # each: {"name", "loops": [closed point lists], "scores": [open point lists]}

def radial(cx, cy, r, n, noise, smooth=3, phase=None):
    """Closed noisy outline around (cx, cy): a sum of a few random harmonics."""
    harm = [(k, rng.uniform(-noise, noise) / k ** 0.7, rng.uniform(0, 2 * math.pi)) for k in range(2, 2 + smooth)]
    return [(cx + (r * (1 + sum(a * math.sin(k * t + p) for k, a, p in harm))) * math.cos(t),
             cy + (r * (1 + sum(a * math.sin(k * t + p) for k, a, p in harm))) * math.sin(t))
            for t in (2 * math.pi * i / n for i in range(n))]

def ellipse_blob(cx, cy, rx, ry, n, noise):
    harm = [(k, rng.uniform(-noise, noise) / k, rng.uniform(0, 2 * math.pi)) for k in (2, 3, 5)]
    out = []
    for i in range(n):
        t = 2 * math.pi * i / n
        f = 1 + sum(a * math.sin(k * t + p) for k, a, p in harm)
        out.append((cx + rx * f * math.cos(t), cy + ry * f * math.sin(t)))
    return out

def star(cx, cy, r_out, r_in, points, twist=0):
    return [(cx + (r_out if i % 2 == 0 else r_in) * math.cos(math.pi * i / points + twist),
             cy + (r_out if i % 2 == 0 else r_in) * math.sin(math.pi * i / points + twist)) for i in range(2 * points)]

def gear(cx, cy, r_tip, r_root, teeth):
    pts = []
    for i in range(teeth):
        a = 2 * math.pi * i / teeth
        for da, r in ((0, r_root), (0.18, r_tip), (0.32, r_tip), (0.5, r_root)):
            t = a + da * 2 * math.pi / teeth
            pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    return pts

def circle(cx, cy, r, n=48):
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]

def poly(points, dx=0, dy=0):
    return [(x + dx, y + dy) for x, y in points]

def add(name, loops, scores=()):
    parts.append({"name": name, "loops": loops, "scores": list(scores)})

# 6 picture frames: wavy rounded outline ~170 x 130 with a large irregular opening.
for i in range(6):
    add(f"Frame {i+1}", [ellipse_blob(0, 0, 88, 68, 72, 0.06), ellipse_blob(rng.uniform(-6, 6), rng.uniform(-4, 4), 58, 42, 60, 0.12)],
        [[(-80, 0), (-68, 0)], [(68, 0), (80, 0)]])
# 4 gears: 16 teeth, a 50 mm bore and four small bolt holes.
for i in range(4):
    add(f"Gear {i+1}", [gear(0, 0, 62, 54, 16), circle(0, 0, 25)] + [circle(38 * math.cos(a), 38 * math.sin(a), 4, 16) for a in (0.4, 2.0, 3.5, 5.1)])
# 4 rings with lumpy edges.
for i in range(4):
    add(f"Ring {i+1}", [radial(0, 0, 56, 64, 0.08), radial(0, 0, 38, 56, 0.1)])
# 2 deep U-shaped arches (concave pockets, no hole).
for i in range(2):
    w, h, t = 140, 100, 22
    add(f"Arch {i+1}", [[(0, 0), (w, 0), (w, h), (w - t, h), (w - t, t + 10), (w / 2 + 12, t), (w / 2 - 12, t), (t, t + 10), (t, h), (0, h)]])
# 8 stars, 5 to 8 points.
for i in range(8):
    p = 5 + i % 4
    add(f"Star {i+1}", [star(0, 0, rng.uniform(32, 44), rng.uniform(14, 20), p, rng.uniform(0, 1))])
# 10 organic blobs.
for i in range(10):
    add(f"Blob {i+1}", [radial(0, 0, rng.uniform(24, 40), 48, 0.25, smooth=4)])
# 8 zigzags, L and T shapes.
for i in range(8):
    k = i % 4
    if k == 0: pts = [(0, 0), (120, 0), (120, 18), (18, 18), (18, 90), (0, 90)]
    elif k == 1: pts = [(0, 0), (110, 0), (110, 20), (65, 20), (65, 85), (45, 85), (45, 20), (0, 20)]
    elif k == 2: pts = [(0, 0), (30, 0), (50, 30), (70, 0), (100, 0), (130, 45), (100, 45), (80, 15), (60, 45), (40, 45), (20, 15), (0, 15)]
    else: pts = [(0, 0), (90, 0), (90, 60), (60, 60), (60, 30), (30, 30), (30, 75), (0, 75)]
    add(f"Bracket {i+1}", [pts], [[(5, 5), (25, 5)]] if k == 0 else [])
# 6 leaves with a vein score line.
for i in range(6):
    L = rng.uniform(70, 95); W = L * 0.42
    pts = [(L * (1 - math.cos(math.pi * s)) / 2, W / 2 * math.sin(math.pi * s) * (1 if j == 0 else -1))
           for j in (0, 1) for s in ([k / 24 for k in range(25)] if j == 0 else [1 - k / 24 for k in range(1, 24)])]
    add(f"Leaf {i+1}", [pts], [[(6, 0), (L - 6, 0)]])
# 32 small parts sized for the openings: little stars, pebbles, triangles, crescents
# and washers (a washer's own hole can hold the tiniest pebble).
for i in range(32):
    k = i % 5
    if k == 0: loops = [star(0, 0, rng.uniform(13, 18), rng.uniform(6, 8), 5, rng.uniform(0, 1))]
    elif k == 1: loops = [radial(0, 0, rng.uniform(9, 15), 32, 0.2)]
    elif k == 2: s = rng.uniform(22, 32); loops = [[(0, 0), (s, 0), (s * rng.uniform(0.2, 0.8), s * 0.8)]]
    elif k == 3:
        r = rng.uniform(12, 16); outer = circle(0, 0, r, 40); inner = circle(r * 0.45, 0, r * 0.8, 40)
        loops = [[p for p in outer if math.hypot(p[0] - r * 0.45, p[1]) > r * 0.8] + [p for p in reversed(inner) if math.hypot(p[0], p[1]) <= r]]
    else: r = rng.uniform(13, 17); loops = [circle(0, 0, r, 40), circle(0, 0, r * 0.45, 28)]
    add(f"Small {i+1}", loops)

assert len(parts) == 80, len(parts)

# Lay the parts out loosely on a big drawing (the app re-nests them); no two overlap.
def bbox(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)
x = y = 10; row = 0; W = 1000
placed = []
for part in parts:
    x0, y0, x1, y1 = bbox(part["loops"][0])
    if x + (x1 - x0) > W - 10: x = 10; y += row + 12; row = 0
    dx, dy = x - x0, y - y0
    placed.append({**part, "loops": [poly(l, dx, dy) for l in part["loops"]], "scores": [poly(s, dx, dy) for s in part["scores"]]})
    x += (x1 - x0) + 12; row = max(row, y1 - y0)
H = math.ceil(y + row + 10)

fmt = lambda v: f"{v:.3f}".rstrip("0").rstrip(".")
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{H}mm" viewBox="0 0 {W} {H}">',
       '<!-- Paper Nest laser stress test: 80 irregular parts for an A2 (594 x 420 mm) sheet. Black = cut, blue = score. -->']
for i, p in enumerate(placed):
    svg.append(f'<g id="part-{i+1}" data-name="{p["name"]}">')
    for loop in p["loops"]:
        svg.append(f'<path d="M{" L".join(fmt(a) + " " + fmt(b) for a, b in loop)} Z" fill="none" stroke="#000000" stroke-width="0.2"/>')
    for s in p["scores"]:
        svg.append(f'<path data-layer="SCORE" d="M{" L".join(fmt(a) + " " + fmt(b) for a, b in s)}" fill="none" stroke="#1f5fbf" stroke-width="0.2"/>')
    svg.append("</g>")
svg.append("</svg>")
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "laser-test-a2-80-parts.svg").write_text("\n".join(svg) + "\n")

# DXF R12-style ASCII with LWPOLYLINE entities, millimetres, y flipped to CAD orientation.
d = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"]
def lw(points, layer, closed, color):
    out = ["0", "LWPOLYLINE", "8", layer, "62", str(color), "90", str(len(points)), "70", "1" if closed else "0"]
    for a, b in points: out += ["10", fmt(a), "20", fmt(H - b)]
    return out
for p in placed:
    for loop in p["loops"]: d += lw(loop, "CUT", True, 7)
    for s in p["scores"]: d += lw(s, "SCORE", False, 5)
d += ["0", "ENDSEC", "0", "EOF"]
(OUT / "laser-test-a2-80-parts.dxf").write_text("\n".join(d) + "\n")
print("80 parts,", sum(len(p["loops"]) - 1 for p in parts), "holes, drawing", W, "x", H, "mm")
