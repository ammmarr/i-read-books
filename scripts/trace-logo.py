"""Turns the one-line drawing (assets/logo-source.jpg) into src/assets/logo.json:
smooth centre-line stroke paths, in pen order, that the app animates.

    python scripts/trace-logo.py assets/logo-source.jpg src/assets/logo.json

Needs Python with numpy + opencv-python. Then run `node scripts/make-app-assets.mjs`.
Steps: Lanczos x4 -> threshold -> Zhang-Suen skeleton -> drop staircase pixels
-> graph of real junctions -> join branches straight through crossings -> heal
small gaps -> pen order -> smooth -> RDP -> Catmull-Rom cubic beziers.
"""
import json, sys
import numpy as np
import cv2

SRC, OUT = sys.argv[1], sys.argv[2]
S = 4
THR = int(sys.argv[3]) if len(sys.argv) > 3 else 140

g = cv2.imread(SRC, cv2.IMREAD_GRAYSCALE)
H0, W0 = g.shape
big = cv2.resize(g, (W0 * S, H0 * S), interpolation=cv2.INTER_LANCZOS4)
ink = (big < THR).astype(np.uint8)
n, lab, stats, _ = cv2.connectedComponentsWithStats(ink, 8)
keep = np.zeros(n, bool)
keep[1:] = stats[1:, cv2.CC_STAT_AREA] > 40 * S * S
ink = keep[lab].astype(np.uint8)
dist = cv2.distanceTransform(ink, cv2.DIST_L2, 5)


def zhang_suen(img):
    img = img.copy()
    while True:
        changed = False
        for step in (0, 1):
            P = np.pad(img, 1)
            p2, p3, p4 = P[:-2, 1:-1], P[:-2, 2:], P[1:-1, 2:]
            p5, p6, p7 = P[2:, 2:], P[2:, 1:-1], P[2:, :-2]
            p8, p9 = P[1:-1, :-2], P[:-2, :-2]
            B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
            seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            A = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.uint8) for i in range(8))
            c1, c2 = (p2 * p4 * p6, p4 * p6 * p8) if step == 0 else (p2 * p4 * p8, p2 * p6 * p8)
            m = (img == 1) & (B >= 2) & (B <= 6) & (A == 1) & (c1 == 0) & (c2 == 0)
            if m.any():
                img[m] = 0
                changed = True
        if not changed:
            return img


sk = zhang_suen(ink)
H, W = sk.shape
# neighbours in clockwise order starting north
RING = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]


def ring(y, x):
    return [sk[y + dy, x + dx] if 0 <= y + dy < H and 0 <= x + dx < W else 0 for dy, dx in RING]


# Remove staircase pixels: a pixel whose removal keeps everything 8-connected
# and that isn't a line end (crossing number 1, 2+ neighbours, neighbours stay linked).
ys, xs = np.nonzero(sk)
for y, x in zip(ys.tolist(), xs.tolist()):
    r = ring(y, x)
    B = sum(r)
    if B < 2:
        continue
    A = sum(1 for i in range(8) if r[i] == 0 and r[(i + 1) % 8] == 1)
    if A != 1:
        continue
    # the set neighbours form one contiguous arc; deleting p keeps them connected
    # only if that arc has no gap — true when A == 1. Keep real 2-neighbour
    # chain pixels whose neighbours aren't adjacent to each other.
    idx = [i for i in range(8) if r[i]]
    if B == 2 and abs(idx[0] - idx[1]) not in (1, 7):
        continue
    if B == 2 and (idx[0] % 2 == 1 and idx[1] % 2 == 1):
        continue
    if B <= 3:
        sk[y, x] = 0

ys, xs = np.nonzero(sk)
pix = set(zip(ys.tolist(), xs.tolist()))


def nbrs(p):
    y, x = p
    return [(y + dy, x + dx) for dy, dx in RING if (y + dy, x + dx) in pix]


def crossing(p):
    r = [1 if (p[0] + dy, p[1] + dx) in pix else 0 for dy, dx in RING]
    return sum(1 for i in range(8) if r[i] == 0 and r[(i + 1) % 8] == 1), sum(r)


node_px = set()
end_px = set()
for p in pix:
    A, B = crossing(p)
    if B == 1:
        end_px.add(p)
    elif A >= 3 or B >= 4:
        node_px.add(p)

# cluster adjacent node pixels into one node
cluster_of, clusters = {}, []
for p in node_px:
    if p in cluster_of:
        continue
    cid = len(clusters)
    stack, mem = [p], []
    cluster_of[p] = cid
    while stack:
        q = stack.pop()
        mem.append(q)
        for r in nbrs(q):
            if r in node_px and r not in cluster_of:
                cluster_of[r] = cid
                stack.append(r)
    clusters.append(mem)
for p in end_px:
    cluster_of[p] = len(clusters)
    clusters.append([p])
is_end = {cluster_of[p] for p in end_px}

edges, seen = [], set()
for cid, mem in enumerate(clusters):
    for m in mem:
        for s in nbrs(m):
            if s in cluster_of:
                if cluster_of[s] != cid and (min(m, s), max(m, s)) not in seen:
                    seen.add((min(m, s), max(m, s)))
                    edges.append([cid, cluster_of[s], [m, s]])
                continue
            if s in seen:
                continue
            path, prev, cur, end = [m, s], m, s, None
            seen.add(s)
            while True:
                nn = [r for r in nbrs(cur) if r != prev]
                hit = [r for r in nn if r in cluster_of and not (cluster_of[r] == cid and len(path) < 4)]
                if hit:
                    end = hit[0]
                    path.append(end)
                    break
                nn = [r for r in nn if r not in seen and r not in cluster_of]
                if not nn:
                    break
                # prefer 4-neighbours (stays on the line, no corner cutting)
                nn.sort(key=lambda r: abs(r[0] - cur[0]) + abs(r[1] - cur[1]))
                prev, cur = cur, nn[0]
                seen.add(cur)
                path.append(cur)
            edges.append([cid, cluster_of[end] if end is not None else None, path])
for p in pix:  # closed loops without nodes
    if p in seen or p in cluster_of:
        continue
    path, prev, cur = [p], None, p
    seen.add(p)
    while True:
        nn = [r for r in nbrs(cur) if r != prev and r not in seen]
        if not nn:
            break
        prev, cur = cur, nn[0]
        seen.add(cur)
        path.append(cur)
    edges.append([None, None, path])
print('px', len(pix), 'nodes', len(clusters) - len(end_px), 'ends', len(end_px), 'edges', len(edges), file=sys.stderr)

# union nodes joined by very short edges: one crossing drawn as two junctions
parent = list(range(len(clusters)))


def find(a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a


SHORT = 5 * S
for a, b, p in edges:
    if a is not None and b is not None and a != b and a not in is_end and b not in is_end and len(p) <= SHORT:
        parent[find(a)] = find(b)
edges = [[None if a is None else find(a), None if b is None else find(b), p] for a, b, p in edges]
edges = [e for e in edges if not (e[0] is not None and e[0] == e[1] and len(e[2]) <= SHORT * 2)]
is_end = {find(c) for c in is_end}

# prune spurs (thinning hairs at corners): short edge from a junction to a free end
SPUR = 4 * S
while True:
    degree = {}
    for a, b, p in edges:
        for c in (a, b):
            if c is not None:
                degree[c] = degree.get(c, 0) + 1
    out = []
    for a, b, p in edges:
        fa, fb = (a is None or a in is_end), (b is None or b in is_end)
        other = b if fa else a
        if len(p) < SPUR and fa != fb and other is not None and degree.get(other, 0) >= 3:
            continue
        out.append([a, b, p])
    if len(out) == len(edges):
        break
    edges = out

members = {}
for i, mem in enumerate(clusters):
    members.setdefault(find(i), []).extend(mem)
center = {k: np.array(v, float).mean(axis=0) for k, v in members.items()}

inc = {}
for i, (a, b, p) in enumerate(edges):
    if a is not None:
        inc.setdefault(a, []).append((i, 0))
    if b is not None:
        inc.setdefault(b, []).append((i, 1))


def leaving(i, end):
    p = edges[i][2]
    q = p if end == 0 else p[::-1]
    k = min(len(q) - 1, 10 * S)
    a, b = np.array(q[min(2, len(q) - 1)], float), np.array(q[k], float)
    d = b - a
    nn = np.linalg.norm(d)
    return d / nn if nn else d


pair = {}
for node, items in inc.items():
    if node in is_end or len(items) < 2:
        continue
    dirs = {it: leaving(*it) for it in items}
    cand = sorted((float(np.dot(dirs[a], dirs[b])), a, b) for ii, a in enumerate(items) for b in items[ii + 1:])
    left = set(items)
    for sc, a, b in cand:
        if a in left and b in left and (sc < -0.3 or len(items) == 2):
            pair[a], pair[b] = b, a
            left -= {a, b}

used, chains = set(), []


def walk(i, end):
    pts = []
    while True:
        used.add(i)
        a, b, p = edges[i]
        seq = p if end == 0 else p[::-1]
        sn, xn = (a, b) if end == 0 else (b, a)
        if not pts and sn is not None and sn not in is_end:
            pts.append(tuple(center[sn]))
        pts.extend(tuple(map(float, q)) for q in seq)
        if xn is None or xn in is_end:
            break
        pts.append(tuple(center[xn]))
        nx = pair.get((i, 1 - end))
        if nx is None or nx[0] in used:
            break
        i, end = nx
    return pts


starts = [(i, e) for i, (a, b, p) in enumerate(edges) for e, nd in ((0, a), (1, b)) if nd is None or nd in is_end or (i, e) not in pair]
for i, e in starts:
    if i not in used:
        chains.append(walk(i, e))
for i in range(len(edges)):
    if i not in used:
        chains.append(walk(i, 0))
chains = [c for c in chains if len(c) > 3 * S]

# ── heal: join chain ends that continue each other across a small gap ──
def end_dir(c, which):
    q = c if which == 1 else c[::-1]
    k = min(len(q) - 1, 8 * S)
    a, b = np.array(q[-1 - k], float), np.array(q[-1], float)
    d = b - a
    nn = np.linalg.norm(d)
    return d / nn if nn else d


GAP = 9 * S
chains = [list(c) for c in chains if len(c) > 1]
while True:
    best = None
    for i, a in enumerate(chains):
        for ea in (0, 1):
            pa = np.array(a[-1] if ea else a[0], float)
            da = end_dir(a, ea)
            for j, b in enumerate(chains):
                if j == i and len(chains) > 0:
                    continue
                for eb in (0, 1):
                    pb = np.array(b[-1] if eb else b[0], float)
                    gap = np.linalg.norm(pb - pa)
                    if gap > GAP:
                        continue
                    db = end_dir(b, eb)
                    if float(np.dot(da, db)) > -0.35:
                        continue
                    if gap > S:
                        u = (pb - pa) / gap
                        if float(np.dot(da, u)) < 0.2 or float(np.dot(db, -u)) < 0.2:
                            continue
                    score = gap + 4 * S * (1 + float(np.dot(da, db)))
                    if best is None or score < best[0]:
                        best = (score, i, ea, j, eb)
    if best is None:
        break
    _, i, ea, j, eb = best
    a, b = chains[i], chains[j]
    a = a if ea == 1 else a[::-1]
    b = b if eb == 0 else b[::-1]
    merged = a + b
    chains = [c for k, c in enumerate(chains) if k not in (i, j)] + [merged]

# T-joins: a free end close to another line snaps onto it
SNAP = 6 * S
for i, a in enumerate(chains):
    for ea in (0, 1):
        pa = np.array(a[-1] if ea else a[0], float)
        bestd, bestp = None, None
        for j, b in enumerate(chains):
            B = np.array(b, float)
            if j == i:
                # own interior, but away from this end
                B = B[: max(0, len(B) - 12 * S)] if ea == 1 else B[12 * S:]
                if not len(B):
                    continue
            d = np.hypot(*(B - pa).T)
            k = int(np.argmin(d))
            if d[k] > 0.6 * S and d[k] < SNAP and (bestd is None or d[k] < bestd):
                bestd, bestp = d[k], tuple(B[k])
        if bestp is not None:
            if ea == 1:
                a.append(bestp)
            else:
                a.insert(0, bestp)
chains.sort(key=len, reverse=True)
print('chains', len(chains), [len(c) for c in chains], file=sys.stderr)


def smooth(pts, sigma):
    a = np.array(pts, float)
    if len(a) < 7:
        return a
    r = int(sigma * 3)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.pad(a, ((r, r), (0, 0)), mode='edge')
    o = np.stack([np.convolve(pad[:, d], k, mode='valid') for d in range(2)], axis=1)
    o[0], o[-1] = a[0], a[-1]
    return o


def rdp(a, eps):
    if len(a) < 3:
        return a
    s, e = a[0], a[-1]
    d = e - s
    nn = np.hypot(*d)
    dd = np.hypot(*(a - s).T) if nn == 0 else np.abs(d[0] * (a[:, 1] - s[1]) - d[1] * (a[:, 0] - s[0])) / nn
    i = int(np.argmax(dd))
    if dd[i] > eps:
        return np.vstack([rdp(a[: i + 1], eps)[:-1], rdp(a[i:], eps)])
    return np.vstack([s, e])


ya, xa = np.nonzero(ink)
PAD = 6
ox, oy = xa.min() / S - PAD, ya.min() / S - PAD
vw, vh = (xa.max() - xa.min()) / S + 2 * PAD, (ya.max() - ya.min()) / S + 2 * PAD
OFF = 0.5 - 0.5 / S  # pixel-centre alignment of the x4 grid


def to_path(pts):
    a = rdp(smooth(pts, 1.6 * S), 0.18 * S)
    P = [(x / S + OFF - ox, y / S + OFF - oy) for y, x in a]
    if len(P) < 2:
        return ''
    f = lambda v: f'{v:.1f}'.rstrip('0').rstrip('.')
    d = [f'M{f(P[0][0])} {f(P[0][1])}']
    for i in range(len(P) - 1):
        p0 = P[i - 1] if i else P[i]
        p1, p2 = P[i], P[i + 1]
        p3 = P[i + 2] if i + 2 < len(P) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d.append(f'C{f(c1[0])} {f(c1[1])} {f(c2[0])} {f(c2[1])} {f(p2[0])} {f(p2[1])}')
    return ''.join(d)


# Pen order: start at the lowest-left line end (the left arm), then always
# continue with the nearest unused chain end — reversing chains as needed.
def first_last(c):
    return np.array(c[0], float), np.array(c[-1], float)


rest = list(chains)
start_i = max(range(len(rest)), key=lambda k: max(rest[k][0][0], rest[k][-1][0]) - 0.5 * min(rest[k][0][1], rest[k][-1][1]))
c0 = rest.pop(start_i)
if c0[0][0] < c0[-1][0]:  # begin at its lower end (larger y)
    c0 = c0[::-1]
ordered = [c0]
while rest:
    tail = np.array(ordered[-1][-1], float)
    best = min(tuple((np.linalg.norm(np.array(c[0], float) - tail), k, False) for k, c in enumerate(rest)) + tuple((np.linalg.norm(np.array(c[-1], float) - tail), k, True) for k, c in enumerate(rest)))
    _, k, rev = best
    c = rest.pop(k)
    ordered.append(c[::-1] if rev else c)
chains = ordered
paths = [p for p in (to_path(c) for c in chains) if p]
sw = float(np.median(dist[sk == 1])) * 2 / S
json.dump({'w': round(vw, 1), 'h': round(vh, 1), 'paths': paths}, open(OUT, 'w'), separators=(',', ':'))
print('viewBox', round(vw, 1), round(vh, 1), 'stroke', round(sw, 2), 'paths', len(paths), 'chars', sum(map(len, paths)), file=sys.stderr)
