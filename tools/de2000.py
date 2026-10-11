# CIEDE2000 between rendered palette colours (sampled by tools/palette.cjs). usage: de2000.py '<pal json>' '<light json>'
import json, math, subprocess, sys, itertools
def lab(rgb):
    def lin(c): c /= 255; return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = map(lin, rgb)
    X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047; Y = 0.2126 * r + 0.7152 * g + 0.0722 * b; Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116
    return 116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))
def de(l1, l2):
    L1, a1, b1 = l1; L2, a2, b2 = l2
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2); Cb = (C1 + C2) / 2; G = 0.5 * (1 - math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
    a1p, a2p = a1 * (1 + G), a2 * (1 + G); C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1 = math.degrees(math.atan2(b1, a1p)) % 360; h2 = math.degrees(math.atan2(b2, a2p)) % 360
    dL = L2 - L1; dC = C2p - C1p
    dh = 0 if C1p * C2p == 0 else (h2 - h1 if abs(h2 - h1) <= 180 else h2 - h1 - 360 if h2 - h1 > 180 else h2 - h1 + 360)
    dH = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dh / 2))
    Lb = (L1 + L2) / 2; Cbp = (C1p + C2p) / 2
    hb = h1 + h2 if C1p * C2p == 0 else ((h1 + h2) / 2 if abs(h1 - h2) <= 180 else (h1 + h2 + 360) / 2 if h1 + h2 < 360 else (h1 + h2 - 360) / 2)
    T = 1 - 0.17 * math.cos(math.radians(hb - 30)) + 0.24 * math.cos(math.radians(2 * hb)) + 0.32 * math.cos(math.radians(3 * hb + 6)) - 0.2 * math.cos(math.radians(4 * hb - 63))
    dth = 30 * math.exp(-((hb - 275) / 25) ** 2); Rc = 2 * math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    SL = 1 + 0.015 * (Lb - 50) ** 2 / math.sqrt(20 + (Lb - 50) ** 2); SC = 1 + 0.045 * Cbp; SH = 1 + 0.015 * Cbp * T; RT = -math.sin(math.radians(2 * dth)) * Rc
    return math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH))
NAMES = ['green', 'yellow', 'blue', 'pink', 'purple', 'red', 'black', 'cyan', 'orange', 'mystery']
def run(pal, light='{}', shot=None):
    out = subprocess.run(['node', 'tools/palette.cjs', json.dumps(pal), shot or '', light], capture_output=True, text=True, cwd='/workspace/bus-jam').stdout
    res = json.loads(out); rep = {}
    for surf in ['roof', 'side', 'head', 'rider']:
        labs = [lab(r[surf]) for r in res]; n = 10 if surf in ('roof', 'side') else 9  # mystery gray only applies to buses
        pairs = sorted((de(labs[i], labs[j]), NAMES[i], NAMES[j]) for i, j in itertools.combinations(range(n), 2))
        rep[surf] = pairs[:4]
    # badge: flat, unlit
    labs = [lab(tuple(int(h[k:k + 2], 16) for k in (1, 3, 5))) for h in pal[:9]]
    rep['flat'] = sorted((de(labs[i], labs[j]), NAMES[i], NAMES[j]) for i, j in itertools.combinations(range(9), 2))[:4]
    return res, rep
if __name__ == '__main__':
    pal = json.loads(sys.argv[1]); light = sys.argv[2] if len(sys.argv) > 2 else '{}'
    res, rep = run(pal, light, sys.argv[3] if len(sys.argv) > 3 else None)
    for k, v in rep.items(): print(k.ljust(6), ' '.join('%.1f %s/%s' % p for p in v))
    for r in res: print(NAMES[r['i']].ljust(8), 'roof', r['roof'], 'head', r['head'], 'side', r['side'])
