"""
SURFACE INVENTORY — SR 11-7 'model inventory' applied to every screen.

For each surface (terminal tab, page, overlay) walk its import graph and record:
  - the /api endpoints its code reads  (the INFORMATION it shows)
  - its section headings               (how many things it asks the reader to take in)
  - code size                          (maintenance cost)
Then compare surfaces pairwise: shared endpoints = the same information shown in
two places. High overlap is a merge candidate; zero unique endpoints means the
surface adds no information of its own.

Run: python3 research/surface-inventory.py → research/surface-inventory.json
"""
import json, os, re, itertools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "client", "src")
SURFACES = {
    "NEXUS board": "pages/nexus.tsx", "CHART": "components/charting/chart-lab-nexus.tsx", "FLOW": "components/flow/flow-board.tsx",
    "GEX": "components/gex/gex-hub-nexus.tsx", "LEAPS": "components/hunt/leaps-nexus.tsx", "CRYPTO": "components/crypto/crypto-nexus.tsx",
    "CATALYST": "components/catalyst/catalyst-nexus.tsx", "BOT": "components/bot/bot-nexus.tsx", "POSITIONS": "pages/positions-heatmap.tsx",
    "JOURNAL": "pages/shells/journal-shell.tsx", "Slate": "pages/slate.tsx", "Radar": "pages/radar.tsx", "Performance": "pages/performance.tsx",
    "Alerts": "pages/alerts.tsx", "How-to": "pages/how-to.tsx", "Settings": "pages/settings.tsx", "Research": "pages/shells/research-shell.tsx",
    "Ticker workup": "components/workup/ticker-workup.tsx",
}
SKIP = ("components/ui/", "lib/", "hooks/use-toast", "contexts/")

def resolve(frm, spec):
    if spec.startswith("@/"): base = os.path.join(SRC, spec[2:])
    elif spec.startswith("."): base = os.path.normpath(os.path.join(os.path.dirname(frm), spec))
    else: return None
    for ext in ("", ".tsx", ".ts", "/index.tsx", "/index.ts"):
        if os.path.isfile(base + ext): return base + ext
    return None

def walk(entry, depth=4):
    seen, stack = set(), [(os.path.join(SRC, entry), 0)]
    while stack:
        f, d = stack.pop()
        if f in seen or not f: continue
        seen.add(f)
        if d >= depth: continue
        s = open(f, encoding="utf-8", errors="ignore").read()
        for spec in re.findall(r"""(?:from|import\()\s*['"]([^'"]+)['"]""", s):
            r = resolve(f, spec)
            if r and not any(k in os.path.relpath(r, SRC) for k in SKIP): stack.append((r, d + 1))
    return seen

def norm_api(a):
    a = a.split("?")[0]
    a = re.sub(r"\$\{[^}]*\}", ":p", a)
    return a.rstrip("/")

out = {}
for name, entry in SURFACES.items():
    files = walk(entry)
    apis, heads, lines = set(), set(), 0
    for f in files:
        s = open(f, encoding="utf-8", errors="ignore").read(); lines += s.count("\n")
        for a in re.findall(r"""['"`](/api/[A-Za-z0-9_\-/:${}.]+)""", s): apis.add(norm_api(a))
    entry_src = open(os.path.join(SRC, entry), encoding="utf-8", errors="ignore").read()
    heads |= set(re.findall(r'className="sec-(?:num|title)"[^>]*>\s*([^<{]{3,40})', entry_src))
    out[name] = {"files": len(files), "lines": lines, "apis": sorted(apis), "sections": sorted(h.strip() for h in heads)}

names = list(out)
pairs = []
for a, b in itertools.combinations(names, 2):
    A, B = set(out[a]["apis"]), set(out[b]["apis"])
    if not A or not B: continue
    inter = A & B
    j = len(inter) / len(A | B)
    pairs.append({"a": a, "b": b, "jaccard": round(j, 2), "shared": sorted(inter)})
pairs.sort(key=lambda p: -p["jaccard"])
for n in names:
    others = set().union(*[set(out[m]["apis"]) for m in names if m != n])
    out[n]["unique"] = sorted(set(out[n]["apis"]) - others)
res = {"surfaces": out, "overlap": pairs[:25]}
json.dump(res, open(os.path.join(ROOT, "research", "surface-inventory.json"), "w"), indent=2)
print(f"{'surface':15s} files  lines  apis unique sections")
for n in names:
    o = out[n]; print(f"{n:15s} {o['files']:5d} {o['lines']:6d} {len(o['apis']):5d} {len(o['unique']):6d} {len(o['sections']):5d}")
print("\nTop overlaps:")
for p in pairs[:14]: print(f"  {p['a']:14s} ~ {p['b']:14s} J={p['jaccard']}  shared={len(p['shared'])} {p['shared'][:5]}")
