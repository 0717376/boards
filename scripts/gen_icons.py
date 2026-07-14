"""Generate PWA icons: violet rounded square with the app's hand-drawn squiggle-arrow doodle."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")  # run: uv run --with pillow python scripts/gen_icons.py
os.makedirs(OUT, exist_ok=True)

VIOLET = (105, 101, 219, 255)
PAPER = (253, 252, 249, 255)

def bezier(p0, c1, c2, p3, n=60):
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt**2 * t * c1[0] + 3 * mt * t**2 * c2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt**2 * t * c1[1] + 3 * mt * t**2 * c2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts

# doodle path in its native 120x90 grid (same as the dashboard empty state)
seg1 = bezier((32, 55), (42, 30), (55, 30), (62, 44))
seg2 = bezier((62, 44), (69, 58), (82, 62), (90, 36))
arrow = [(93.5, 44.5), (90, 36), (83.5, 40.5)]

def draw_icon(size, content_scale, bg, fg, rounded, ss=4):
    S = size * ss  # supersample for clean antialiased strokes
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = S * 0.22 if rounded else 0
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=bg)

    # fit doodle bbox (x 32..93.5, y 30..62) into the safe area
    bw, bh = 93.5 - 32, 62 - 30
    span = S * content_scale
    s = span / bw
    ox = (S - bw * s) / 2 - 32 * s
    oy = (S - bh * s) / 2 - 30 * s
    T = lambda p: (p[0] * s + ox, p[1] * s + oy)

    w = max(3, int(S * 0.05))
    path = [T(p) for p in seg1 + seg2[1:]]
    d.line(path, fill=fg, width=w, joint="curve")
    d.line([T(arrow[0]), T(arrow[1])], fill=fg, width=w)
    d.line([T(arrow[1]), T(arrow[2])], fill=fg, width=w)
    for p in (path[0], path[-1], T(arrow[0]), T(arrow[1]), T(arrow[2])):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=fg)
    return img.resize((size, size), Image.LANCZOS)

draw_icon(512, 0.58, VIOLET, PAPER, rounded=True).save(f"{OUT}/icon-512.png")
draw_icon(192, 0.58, VIOLET, PAPER, rounded=True).save(f"{OUT}/icon-192.png")
draw_icon(180, 0.58, VIOLET, PAPER, rounded=False).save(f"{OUT}/icon-180.png")  # iOS masks it itself
draw_icon(512, 0.42, VIOLET, PAPER, rounded=False).save(f"{OUT}/maskable-512.png")  # safe zone padding
print("icons written:", sorted(os.listdir(OUT)))
