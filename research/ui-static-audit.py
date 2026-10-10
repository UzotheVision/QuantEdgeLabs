"""
UI STATIC AUDIT — the "conceptual soundness" half of the UI/UX validation.
Scans client/src for design-system violations and accessibility anti-patterns,
and measures the production bundle. Complements research/ui-probe.js (runtime).

Run: python3 research/ui-static-audit.py  → research/ui-static-results.json
"""
import json, os, re, glob, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "client", "src")
files = [f for f in glob.glob(os.path.join(SRC, "**", "*.tsx"), recursive=True)]
css = [f for f in glob.glob(os.path.join(SRC, "**", "*.css"), recursive=True)]

def rel(p): return os.path.relpath(p, ROOT)

C = collections.Counter
hexes, px, faded, palette, per_file = C(), C(), C(), C(), collections.defaultdict(C)
icon_btn_no_label, click_non_semantic, img_no_alt, inline_style = [], [], [], 0
PALETTE = re.compile(r"\b(?:text|bg|border|from|to|via|ring|fill|stroke)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b")
for f in files:
    s = open(f, encoding="utf-8", errors="ignore").read()
    r = rel(f)
    for m in re.findall(r"#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b", s):
        hexes[m.lower()] += 1; per_file[r]["hex"] += 1
    for m in re.findall(r"text-\[(\d+(?:\.\d+)?)px\]", s):
        px[float(m)] += 1; per_file[r]["px"] += 1
        if float(m) < 11: per_file[r]["sub11"] += 1
    for m in re.findall(r"text-[a-z-]+(?:-\d{2,3})?/(\d{2})\b|text-\[var\(--[a-z0-9-]+\)\]/(\d{2})\b", s):
        v = int(m[0] or m[1]);
        if v < 90: faded[v] += 1; per_file[r]["faded"] += 1
    for m in PALETTE.findall(s):
        palette[m] += 1; per_file[r]["palette"] += 1
    # icon-only shadcn buttons without an accessible name
    for m in re.finditer(r"<Button\b[^>]*size=\"icon\"[^>]*>", s):
        if "aria-label" not in m.group(0) and "title=" not in m.group(0):
            icon_btn_no_label.append(r)
    for m in re.finditer(r"<(div|span|li|td|tr)\b[^>]*onClick=", s):
        tag = m.group(0)
        if "role=" not in tag and "tabIndex" not in tag and "onKeyDown" not in tag:
            click_non_semantic.append(r)
    for m in re.finditer(r"<img\b[^>]*>", s):
        if "alt=" not in m.group(0): img_no_alt.append(r)
    inline_style += len(re.findall(r"style=\{\{", s))

css_hex = C()
tokens_defined = 0
for f in css:
    s = open(f, encoding="utf-8", errors="ignore").read()
    tokens_defined += len(re.findall(r"^\s*--[a-z0-9-]+\s*:", s, re.M))
    for m in re.findall(r"#[0-9a-fA-F]{6}\b", s): css_hex[m.lower()] += 1

# bundle
assets = glob.glob(os.path.join(ROOT, "dist", "public", "assets", "*"))
def kb(p): return round(os.path.getsize(p) / 1024)
js = sorted([(os.path.basename(a), kb(a)) for a in assets if a.endswith(".js")], key=lambda x: -x[1])
cssb = sorted([(os.path.basename(a), kb(a)) for a in assets if a.endswith(".css")], key=lambda x: -x[1])
imgs = sorted([(os.path.basename(a), kb(a)) for a in assets if re.search(r"\.(png|jpe?g|webp|svg|gif)$", a)], key=lambda x: -x[1])

worst = sorted(per_file.items(), key=lambda kv: -(kv[1]["hex"] + kv[1]["palette"] + kv[1]["faded"] * 2 + kv[1]["sub11"] * 2))[:12]
res = {
    "files": len(files), "cssFiles": len(css), "cssTokensDefined": tokens_defined,
    "hardcodedHexInTsx": sum(hexes.values()), "distinctHexInTsx": len(hexes), "topHex": hexes.most_common(10),
    "distinctHexInCss": len(css_hex),
    "tailwindPaletteUses": sum(palette.values()), "paletteHues": palette.most_common(),
    "arbitraryPxSizes": dict(sorted(px.items())), "sub11pxUses": sum(v for k, v in px.items() if k < 11),
    "fadedTextUses": sum(faded.values()), "fadedByOpacity": dict(sorted(faded.items())),
    "iconButtonsWithoutName": len(icon_btn_no_label), "iconButtonFiles": C(icon_btn_no_label).most_common(8),
    "clickableNonSemantic": len(click_non_semantic), "clickableNonSemanticFiles": C(click_non_semantic).most_common(8),
    "imgWithoutAlt": len(img_no_alt), "inlineStyleObjects": inline_style,
    "worstFiles": [{"file": k, **dict(v)} for k, v in worst],
    "bundle": {"jsTotalKB": sum(k for _, k in js), "jsChunks": len(js), "largestJs": js[:8], "cssTotalKB": sum(k for _, k in cssb), "largestImages": imgs[:6]},
}
json.dump(res, open(os.path.join(ROOT, "research", "ui-static-results.json"), "w"), indent=2)
print(json.dumps({k: v for k, v in res.items() if k not in ("worstFiles",)}, indent=1)[:4000])
print("WORST", json.dumps(res["worstFiles"][:8]))
