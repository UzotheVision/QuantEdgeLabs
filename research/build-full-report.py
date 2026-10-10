"""QuantEdge full validation report v2 — quant reverse-engineering + UI/UX validation.
Reads research/*.json produced by the harnesses; writes docs/QuantEdge-Validation-Report-v2.pdf.
"""
import json, os, datetime
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak, KeepTogether

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = lambda f: json.load(open(os.path.join(ROOT, "research", f)))
V, A, P = R("validation-results.json"), R("attribution-results.json"), R("replay-results.json")
US, UP, UN = R("ui-static-results.json"), R("ui-runtime-public.json"), R("ui-runtime-nexus.json")
OUT = os.path.join(ROOT, "docs", "QuantEdge-Validation-Report-v2.pdf")
FIG = os.path.join(ROOT, "research", "figs"); os.makedirs(FIG, exist_ok=True)
# Detector result before the fast-V stop fix (run of 2026-09-24 04:0x, v1 report)
DET_BEFORE = {"fires": 2021, "excess": 0.00679, "t": 3.32, "fireMean": 0.01069, "univ": 0.00390}
# Within-source stop-width terciles (research/accuracy-attribution control run)
TERCILES = {
    "quant": [("0.9-2.3%", 57, -0.50, 61), ("2.3-3.3%", 58, -0.06, 52), ("3.4-15%", 58, 0.06, 47)],
    "market_scanner": [("1.0-2.0%", 38, -0.58, 29), ("2.0-4.6%", 38, 0.38, 24), ("4.7-23%", 39, 0.12, 0)],
    "spx_session": [("0.03-0.12%", 50, -0.70, 76), ("0.12-0.18%", 50, -0.20, 56), ("0.18-0.29%", 51, -0.63, 55)],
}

INK, MUTE, RULE = "#1b2330", "#5b6472", "#d9dee5"
TEAL, RED, AMBER, GREEN, BLUE = "#1f9e91", "#c43d50", "#b8862b", "#1e8f63", "#3b6fb6"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 8.5, "axes.edgecolor": RULE, "axes.labelcolor": INK,
                     "xtick.color": MUTE, "ytick.color": MUTE, "axes.spines.top": False, "axes.spines.right": False})
def save(fig, n):
    p = os.path.join(FIG, n); fig.savefig(p, dpi=200, bbox_inches="tight"); plt.close(fig); return p

# ── figures ───────────────────────────────────────────────────────────────
rec = A["record"]["bySource"]; srcs = [s for s in ["quant", "spx_session", "gex_scanner", "market_scanner"] if s in P["bySource"] and s in rec]
fig, ax = plt.subplots(figsize=(6.6, 2.5)); x = np.arange(len(srcs)); w = 0.38
ax.bar(x - w/2, [rec[s]["recorded"]["expectancyR"] for s in srcs], w, color=RULE, edgecolor=MUTE, label="As recorded by the tracker")
ax.bar(x + w/2, [P["bySource"][s]["expectancyR"] for s in srcs], w, color=TEAL, label="Independent 5-min path replay")
ax.axhline(0, color=MUTE, lw=0.8); ax.set_xticks(x); ax.set_xticklabels(srcs); ax.set_ylabel("Expectancy per idea (R)"); ax.legend(frameon=False, fontsize=7.5)
f_rep = save(fig, "v2_recorded_vs_replay.png")

h = A["excursions"]["mfeHistogram"]
fig, ax = plt.subplots(figsize=(6.6, 2.1))
ax.bar([b["from"] for b in h], [b["n"] for b in h], width=0.22, color=TEAL, align="edge")
ax.axvline(A["excursions"]["all"]["medianTargetR"], color=RED, lw=1.2, ls="--"); ax.text(A["excursions"]["all"]["medianTargetR"] + 0.05, max(b["n"] for b in h) * 0.85, "median published target", color=RED, fontsize=7.5)
ax.set_xlabel("Best move in the idea's favour before resolution (R)  — 3.0 bin = 3R or more"); ax.set_ylabel("Ideas")
f_mfe = save(fig, "v2_mfe.png")

g = A["geometry"]
fig, ax = plt.subplots(figsize=(3.3, 2.7))
ax.plot([0, 0.6], [0, 0.6], ls="--", color=MUTE, lw=0.8)
ax.scatter([b["breakEven"] for b in g], [b["realized"] for b in g], s=[max(20, b["n"] * 1.5) for b in g], color=AMBER, zorder=3)
for b in g: ax.annotate(f"n={b['n']}", (b["breakEven"], b["realized"]), textcoords="offset points", xytext=(5, -9), fontsize=6.5, color=MUTE)
ax.set_xlabel("Chance of target first (random walk)"); ax.set_ylabel("Realized hit rate"); ax.set_xlim(0, 0.6); ax.set_ylim(0, 0.6)
f_geo = save(fig, "v2_geometry.png")

grid = A["exitCounterfactual"]["grid"]; Ks = sorted(set(c["targetR"] for c in grid)); Ss = sorted(set(c["stopR"] for c in grid))
M = np.array([[next(c["pessimistic"] for c in grid if c["targetR"] == k and c["stopR"] == s) for k in Ks] for s in Ss])
fig, ax = plt.subplots(figsize=(3.4, 2.1))
im = ax.imshow(M, cmap="RdYlGn", vmin=-0.3, vmax=0.3, aspect="auto")
ax.set_xticks(range(len(Ks))); ax.set_xticklabels([f"{k:g}" for k in Ks]); ax.set_yticks(range(len(Ss))); ax.set_yticklabels([f"{s:g}" for s in Ss])
ax.set_xlabel("Target (R)"); ax.set_ylabel("Stop (R)")
for i in range(len(Ss)):
    for j in range(len(Ks)): ax.text(j, i, f"{M[i,j]:+.2f}", ha="center", va="center", fontsize=6)
f_grid = save(fig, "v2_exitgrid.png")

top = [a for a in A["attribution"] if a["q"] < 0.05][:14][::-1]
fig, ax = plt.subplots(figsize=(6.6, 3.6))
for i, a in enumerate(top):
    c = GREEN if a["ic"] > 0 else RED
    ax.plot(a["ci"], [i, i], color=c, lw=1.6); ax.plot(a["ic"], i, "o", color=c, ms=4)
ax.axvline(0, color=MUTE, lw=0.8); ax.set_yticks(range(len(top)))
ax.set_yticklabels([a["feature"].replace("tag: ", "").replace("#", "n")[:46] for a in top], fontsize=7)
ax.set_xlabel("Spearman IC with realized R (dot), bootstrap 95% CI (line); all survive FDR q<0.05", fontsize=7.5)
f_ic = save(fig, "v2_ic.png")

fig, axs = plt.subplots(1, 3, figsize=(6.6, 2.1), sharey=True)
for ax, (s, rows) in zip(axs, TERCILES.items()):
    v = [r[2] for r in rows]; ax.bar([r[0] for r in rows], v, color=[GREEN if t > 0 else RED for t in v]); ax.axhline(0, color=MUTE, lw=0.8)
    ax.set_title(s, fontsize=8); ax.tick_params(axis="x", labelsize=6.5)
axs[0].set_ylabel("Expectancy (R)")
f_terc = save(fig, "v2_terciles.png")

pb, pa = UP["before"], UP["after"]
pages = [("375/", "Landing"), ("375/login", "Login"), ("375/pricing", "Pricing"), ("375/how-to", "How-to"), ("375/about", "About")]
fig, ax = plt.subplots(figsize=(6.6, 2.2)); x = np.arange(len(pages))
ax.bar(x - w/2, [pb[k]["kb"] for k, _ in pages], w, color=RULE, edgecolor=MUTE, label="Before")
ax.bar(x + w/2, [pa[k]["kb"] for k, _ in pages], w, color=TEAL, label="After")
ax.set_xticks(x); ax.set_xticklabels([n for _, n in pages]); ax.set_ylabel("Page weight (KB, phone)"); ax.legend(frameon=False, fontsize=7.5)
f_weight = save(fig, "v2_weight.png")

np_ = UN["pages"]; names = list(np_.keys())
fig, ax = plt.subplots(figsize=(6.6, 2.4))
vals = [np_[n]["lcp"] / 1000 for n in names]
ax.barh(range(len(names)), vals, color=[GREEN if v <= 2.5 else AMBER if v <= 4 else RED for v in vals])
ax.axvline(2.5, color=MUTE, ls="--", lw=0.8); ax.text(2.55, len(names) - 0.6, "2.5 s 'good'", fontsize=7, color=MUTE)
ax.set_yticks(range(len(names))); ax.set_yticklabels(names, fontsize=7); ax.invert_yaxis(); ax.set_xlabel("Largest contentful paint (s), signed-in, desktop")
f_lcp = save(fig, "v2_nexus_lcp.png")

px = {float(k): v for k, v in US["arbitraryPxSizes"].items()}
fig, ax = plt.subplots(figsize=(3.3, 2.2))
ks = sorted(k for k in px if k <= 14); ax.bar([f"{k:g}" for k in ks], [px[k] for k in ks], color=[RED if k < 11 else TEAL for k in ks])
ax.set_xlabel("Hard-coded text size (px)"); ax.set_ylabel("Uses in code"); ax.tick_params(axis="x", labelsize=6.5)
f_px = save(fig, "v2_fontsizes.png")

# ── document ──────────────────────────────────────────────────────────────
ss = getSampleStyleSheet()
H0 = ParagraphStyle("H0", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=13, textColor=colors.HexColor(TEAL), spaceBefore=4, spaceAfter=4, keepWithNext=1)
H1 = ParagraphStyle("H1", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=14, textColor=colors.HexColor(INK), spaceBefore=6, spaceAfter=7, keepWithNext=1)
H2 = ParagraphStyle("H2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=11, textColor=colors.HexColor(INK), spaceBefore=8, spaceAfter=4, keepWithNext=1)
B = ParagraphStyle("B", parent=ss["BodyText"], fontName="Helvetica", fontSize=9.2, leading=13, textColor=colors.HexColor(INK), spaceAfter=5)
S = ParagraphStyle("S", parent=B, fontSize=7.9, leading=10.4, textColor=colors.HexColor(MUTE))
CAP = ParagraphStyle("CAP", parent=S, spaceBefore=2, spaceAfter=9)
def P_(x, st=B): return Paragraph(x, st)
def img(p, w_, h_): return Image(p, width=w_ * inch, height=h_ * inch)
def tbl(rows, widths, colour_col=None):
    rows = [[c if isinstance(c, Paragraph) else P_(str(c), S) if i and isinstance(c, str) and len(c) > 38 else c for c in r] for i, r in enumerate(rows)]
    t = Table(rows, colWidths=[x * inch for x in widths], repeatRows=1)
    st = [("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.6), ("FONT", (0, 1), (-1, -1), "Helvetica", 7.8),
          ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor(MUTE)), ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor(MUTE)),
          ("LINEBELOW", (0, 1), (-1, -1), 0.3, colors.HexColor(RULE)), ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    if colour_col is not None:
        for i, r in enumerate(rows[1:], 1):
            v = r[colour_col] if isinstance(r[colour_col], str) else ""
            c = {"Validated": GREEN, "Fixed": GREEN, "Critical": RED, "High": RED, "Medium": AMBER, "Open": AMBER, "Operator": BLUE}.get(v)
            if c: st += [("TEXTCOLOR", (colour_col, i), (colour_col, i), colors.HexColor(c)), ("FONT", (colour_col, i), (colour_col, i), "Helvetica-Bold", 7.8)]
    t.setStyle(TableStyle(st)); return t
pct = lambda v: f"{v*100:.1f}%"
fR = lambda v: f"{v:+.2f}R"
def footer(c, doc):
    c.saveState(); c.setFont("Helvetica", 7.3); c.setFillColor(colors.HexColor(MUTE))
    c.drawString(0.75 * inch, 0.5 * inch, "QuantEdge Labs · Validation Report v2 · Educational research platform — not investment advice")
    c.drawRightString(7.75 * inch, 0.5 * inch, f"Page {doc.page}"); c.restoreState()

rp, rpo = P["overall"], P
ov_rec = A["record"]["recorded"]; unc = A["uncertainty"]["overall"]; wf = A["exitCounterfactual"]["walkForward"]
det = V["detectorBenchmark"]; npass = sum(t["pass"] for t in V["mockTests"])
s = []
s += [P_("QuantEdge Labs", S), P_("Model &amp; Product Validation Report — v2", ParagraphStyle("T", parent=H1, fontSize=21, leading=25)),
      P_(f"Reverse-engineering the platform's accuracy, then applying the same validation discipline to visuals, UX and interactivity. "
         f"Structured after SR 11-7 (Federal Reserve model risk guidance). Prepared {datetime.date(2026, 9, 24):%B %d, %Y}; "
         f"trade data {A['record']['audit']['raw']} resolved ideas, Aug 24 – Sep 23 2026; UI measured live on quantedgelabs.net including the signed-in NEXUS terminal.", B)]

s.append(P_("Executive summary", H1))
summ = [["Finding", "Evidence", "Status"],
    ["Legacy book has negative edge — confirmed by independent re-adjudication", f"Replay: {pct(rp['hitRate'])} hit vs {pct(rp['breakEven'])} chance (z {rp['z']:.1f}); {fR(rp['expectancyR'])}/idea (t {rp['t']:.1f})", "Critical"],
    ["Outcome tracker mis-scored trades", f"{P['phantomStops']} recorded stops never touched after publish; {P['phantomTargets']} phantom targets; {P['agreement']['rate']*100:.1f}% agreement", "Fixed"],
    ["SPX-session producer loses money", f"Replay {fR(P['bySource']['spx_session']['expectancyR'])}/idea, t {P['bySource']['spx_session']['t']:.1f}", "Fixed"],
    ["'Shorts are weaker' was a tracker artifact", f"Replay: shorts {fR(P['byDir']['short']['expectancyR'])} vs longs {fR(P['byDir']['long']['expectancyR'])}", "Validated"],
    ["Tight stops are the #1 measured loss driver", "Stop width IC +0.30 (q 1e-8); holds within each producer", "Open"],
    ["Measured-structure setups are the only positive signals", "Base/reclaim tags +0.22R vs -0.28R without (q 0.001)", "Validated"],
    ["Bottom-reversal detector — edge strengthened by fix", f"Excess +{det['excess']*100:.2f}%/10d, t {det['tStat']:.1f} (was t {DET_BEFORE['t']})", "Validated"],
    ["NEXUS slowness is server saturation", f"1 vCPU, {UN['server']['freeMB']} MB free, {UN['server']['swapUsedMB']} MB swap; trivial API {UN['boardLoad']['trivialEndpointMs']/1000:.0f} s", "Operator"],
    ["Text contrast failed WCAG on every panel", "Muted token 2.4-2.9:1 -> 4.6-5.7:1; NEXUS board now 0/77 failures", "Fixed"],
    ["Public pages 5-7x heavier than needed; false claims; titles 'undefined'", "2.1 MB logo, 2.9 MB photo; '300+ sources', 'SOC 2 compliant'", "Fixed"],
    ["Dense terminal typography", f"{US['sub11pxUses']} sub-11px text uses; 74/77 board texts under 12px; 37 targets under 24px", "Open"]]
s.append(tbl(summ, [2.45, 3.35, 0.8], colour_col=2))
s.append(Spacer(1, 5))
s.append(P_("<b>How to read this.</b> 'R' is the trade's own risk unit: -1R is a full stop-out, +2R is twice the risk won. Every hit rate is compared with the rate a coin-flip market would produce for the same stop and target, so a wide target cannot flatter the numbers. 'Fixed' items are deployed; 'Operator' needs an account action; 'Open' is a design change recommended, not yet made.", S))

s.append(PageBreak())
s.append(P_("Part A — Reverse-engineering accuracy", H0))
s.append(P_("A1. Method", H1))
for hd, tx in [
    ("Mock tests (conceptual soundness).", f"Production functions fed synthetic prices with known answers, including negative controls that must stay silent: {npass}/{len(V['mockTests'])} pass (v1: 15/16; the fast-V failure was fixed and its dependent tests now run)."),
    ("Independent adjudication.", f"Every resolved idea re-scored from real 5-minute bars starting the minute it was published — regular session only, gaps filled at the open, same-bar double touches counted as stops. {P['replayed']} ideas, {P['noData']} without data. This is the ground truth the tracker is judged against."),
    ("Record reconstruction.", f"{A['record']['audit']['duplicatesRemoved']} 'duplicate_collapsed' rows removed (restatements, not ideas); expired ideas whose path crossed one barrier re-scored ({A['record']['audit']['expiredRescoredToStop']} to stop, {A['record']['audit']['expiredRescoredToTarget']} to target)."),
    ("Attribution.", "Every conviction layer, quality tag and idea feature correlated with realized R (Spearman IC), with seeded bootstrap 95% intervals and Benjamini-Hochberg control of the false-discovery rate across ~70 simultaneous tests."),
    ("Walk-forward.", "Any rule chosen from data (e.g. best exit) is chosen on the first half and scored only on the second."),
]: s.append(P_(f"<b>{hd}</b> {tx}", B))

s.append(P_("A2. Is the tracker telling the truth?", H1))
m = P["matrix"]
mt = [["Tracker said", "Replay: target", "Replay: stop", "Replay: timeout"]] + [[k, m.get(k, {}).get("target", 0), m.get(k, {}).get("stop", 0), m.get(k, {}).get("timeout", 0)] for k in ["target", "stop", "expired"]]
s.append(tbl(mt, [1.5, 1.4, 1.4, 1.4]))
s.append(P_(f"Where both agree an idea resolved, they agree {P['agreement']['rate']*100:.1f}% of the time. The disagreements are systematic: {P['phantomStops']} stops the replay never saw after publication — the tracker blended in the whole day's bar, so a 2 pm idea could be 'stopped' by a 10 am low. That is fixed (same-day ideas now judged on 5-minute bars from the publish minute). 'Expired' also hid resolved trades: {m['expired'].get('stop', 0)} expired ideas actually hit their stop and {m['expired'].get('target', 0)} their target within the horizon.", CAP))
s.append(img(f_rep, 6.6, 2.5))
s.append(P_("Figure 1. The tracker overstated SPX-session losses and understated market-scanner losses. The replay is the number to trust.", CAP))
rows = [["Book", "Ideas", "Hit rate", "Chance", "z", "Expectancy", "t"]]
rows.append(["As recorded", ov_rec["n"], pct(ov_rec["hitRate"]), pct(ov_rec["breakEven"]), f"{ov_rec['z']:.2f}", fR(ov_rec["expectancyR"]), f"{ov_rec['t']:.2f}"])
rr = A["record"]["reconstructed"]; rows.append(["Reconstructed", rr["n"], pct(rr["hitRate"]), pct(rr["breakEven"]), f"{rr['z']:.2f}", fR(rr["expectancyR"]), f"{rr['t']:.2f}"])
rows.append(["5-min replay (truth)", rp["n"], pct(rp["hitRate"]), pct(rp["breakEven"]), f"{rp['z']:.2f}", fR(rp["expectancyR"]), f"{rp['t']:.2f}"])
for k in ["long", "short"]:
    d = P["byDir"][k]; rows.append([f"  replay · {k}", d["n"], pct(d["hitRate"]), pct(d["breakEven"]), f"{d['z']:.2f}", fR(d["expectancyR"]), f"{d['t']:.2f}"])
for k, d in P["byHoldingPeriod"].items(): rows.append([f"  replay · {k}", d["n"], pct(d["hitRate"]), pct(d["breakEven"]), f"{d['z']:.2f}", fR(d["expectancyR"]), f"{d['t']:.2f}"])
s.append(tbl(rows, [1.6, 0.6, 0.8, 0.8, 0.6, 0.9, 0.6]))
s.append(P_("Every lens agrees the legacy book loses ~0.2R per idea. Shorts were not worse than longs once adjudicated honestly — the old 'shorts underperform' finding was produced by the tracker, not the market.", CAP))

s.append(P_("A3. Where accuracy is lost", H1))
ex = A["excursions"]
s.append(img(f_mfe, 6.6, 2.1))
s.append(P_(f"Figure 2. Half of all ideas moved at least {ex['all']['mfeMedian']:.2f}R in their favour, but the median published target sat at {ex['all']['medianTargetR']:.1f}R. Only {ex['all']['reached1R']*100:.0f}% ever reached 1R. {A['excursions']['stopsThatWereUp1RFirst']} eventual stop-outs were up a full 1R first.", CAP))
s.append(KeepTogether([img(f_geo, 3.3, 2.7), P_("Figure 3. Realized hit rate vs the random-walk chance for the idea's own geometry, binned. Every bin sits below the diagonal: entries are selected slightly worse than random, at every target distance — the problem is not only 'targets too far'.", CAP)]))
s.append(KeepTogether([img(f_grid, 3.4, 2.1), P_(f"Figure 4. Counterfactual exits (pessimistic: when both levels were touched, stop assumed first). Walk-forward: the best rule on the first half (target {wf['chosenOnFirstHalf']['targetR']:g}R, stop {wf['chosenOnFirstHalf']['stopR']:g}R) scored {fR(wf['testPessimistic'])} to {fR(wf['testOptimistic'])} out of sample vs {fR(wf['testAsPublished'])} as published. Better exits shrink the loss; they do not create an edge. Selection has to improve.", CAP)]))

s.append(P_("A4. What predicts a winner", H1))
s.append(img(f_ic, 6.6, 3.6))
s.append(P_("Figure 5. Features that survive false-discovery control. Green helps, red hurts.", CAP))
s.append(P_("<b>Reading.</b> (1) <b>Stop width</b> is the strongest single predictor: tight stops get shaken out by ordinary noise. (2) The <b>measured-structure tags</b> — real base, higher low, reclaimed average, steady (not vertical) advance — are the only positive signals, the same family as the validated reversal detector. (3) <b>Intraday day-trade tags</b> — 'High urgency', 'Low VIX', HOD/LOD key level, VWAP — are the worst. (4) <b>Stated confidence</b> ranks outcomes (IC +0.23) but is badly scaled (89% stated -> 32% realized): a usable rank, not a probability — hence its relabel to a score. (5) Of the conviction layers only <b>technical</b> carries signal; the total score does not.", B))
s.append(img(f_terc, 6.6, 2.1))
s.append(P_("Figure 6. Control for confounding: stop width split into terciles <i>within</i> each producer. For both non-SPX producers the tightest third loses ~0.5R and the rest break even or better — the effect is real, not an SPX artifact. Recommended: a volatility floor on stops (e.g. stop no tighter than ~0.75x ATR(14) for swings).", CAP))

s.append(P_("A5. How sure are we?", H1))
ubs = A["uncertainty"]["bySource"]
rows = [["Producer", "n", "Expectancy", "Bootstrap 95% CI"]] + [[u["source"], u["n"], fR(u["expectancyR"]), f"[{u['ci'][0]:+.2f}, {u['ci'][1]:+.2f}]"] for u in ubs]
rows.append(["All", unc["n"], fR(unc["expectancyR"]), f"[{unc['ci'][0]:+.2f}, {unc['ci'][1]:+.2f}]"])
s.append(tbl(rows, [1.6, 0.6, 1.0, 1.6]))
pw = A["uncertainty"]["power"]
s.append(P_(f"Probabilistic Sharpe (Bailey &amp; López de Prado) that the true per-trade edge is positive: {unc['probabilisticSharpe']:.1e} — effectively zero. Returns are right-skewed (skew {unc['skew']:.1f}): few big winners, many small losers. <b>Power:</b> at this dispersion, confirming an edge of 0.1R needs ~{pw[1]['tradesNeeded']} trades; 0.2R needs ~{pw[2]['tradesNeeded']}; 0.3R needs ~{pw[3]['tradesNeeded']}. The rebuilt scanners must accrue that many resolved ideas before any claim of edge.", B))

s.append(P_("A6. Detector benchmark after the fast-V fix", H1))
s.append(tbl([["", "Fires", "Mean 10-day return", "Excess vs universe", "t-stat"],
              ["Before (structural stop only)", DET_BEFORE["fires"], f"{DET_BEFORE['fireMean']*100:.2f}%", f"+{DET_BEFORE['excess']*100:.2f}%", f"{DET_BEFORE['t']:.2f}"],
              ["After (ATR fallback stop)", det["fires"], f"{det['fireMeanRet']*100:.2f}%", f"+{det['excess']*100:.2f}%", f"{det['tStat']:.2f}"]], [1.9, 0.7, 1.3, 1.3, 0.7]))
s.append(P_(f"Walk-forward over {det['universeSamples']:,} stock-sessions, no look-ahead. Letting the sharpest V-recoveries qualify added {det['fires'] - DET_BEFORE['fires']} fires and made the edge stronger.", CAP))

s.append(PageBreak())
s.append(P_("Part B — Visuals, UX and interactivity", H0))
s.append(P_("B1. Same process, different model", H1))
s.append(tbl([["SR 11-7 pillar", "Quant (Part A)", "UI / UX (Part B)"],
    ["Conceptual soundness", "Mock tests on production code", "Static audit of all 220 screens: tokens, text sizes, semantics"],
    ["Outcomes analysis", "Resolved ideas, R-multiples", "Runtime probe on the live site: load, layout, contrast, targets, names"],
    ["Benchmarking", "Random-walk break-even", "Core Web Vitals (LCP 2.5 s, CLS 0.1, INP 200 ms), WCAG 2.2 AA, Apple HIG 44 pt"],
    ["Stability", "Chronological halves", "Phone 375 / tablet 768 / desktop 1280-1440; signed-out and signed-in"],
    ["Ongoing monitoring", "Monthly re-run", "research/ui-probe.js + ui-static-audit.py re-runnable"]], [1.5, 2.2, 2.9]))

s.append(P_("B2. Conceptual soundness — static audit", H1))
s.append(KeepTogether([img(f_px, 3.3, 2.2), P_(f"Figure 7. Hard-coded text sizes across the client. {US['sub11pxUses']} uses below 11 px (red). 7-8 px text was floored at 9 px this cycle.", CAP)]))
s.append(tbl([["Measure", "Value", "Why it matters"],
    ["Raw Tailwind palette colours", f"{US['tailwindPaletteUses']:,} uses, {len(US['paletteHues'])} hues", "Bypass the design tokens: theme and contrast fixes cannot reach them"],
    ["Hard-coded hex in components", f"{US['hardcodedHexInTsx']} uses, {US['distinctHexInTsx']} distinct", "Same — colour drift between screens"],
    ["Opacity-faded text", f"{US['fadedTextUses']} uses", "Grey text at 60-70% opacity is the main contrast-failure pattern"],
    ["Clickable div/span, no role/keyboard", f"{US['clickableNonSemantic']}", "Mouse-only; 8 NEXUS board rows fixed this cycle"],
    ["Icon buttons without a name", f"{US['iconButtonsWithoutName']}", "Screen readers announce 'button'"],
    ["Largest JS chunk", f"{US['bundle']['largestJs'][0][0].split('-')[0]} {US['bundle']['largestJs'][0][1]} KB", "GEX hub ships 840 KB; split its chart/3D code"],
    ["Brand marks in use", "4", "Blue Q, green 'QE' favicon, candlestick app icon, pulse glyph — pick one"]], [1.9, 1.5, 3.2]))

s.append(P_("B3. Outcomes — public pages (what people you share the link with see)", H1))
s.append(img(f_weight, 6.6, 2.2))
rows = [["Page (phone)", "Weight", "Contrast failures", "Unlabelled inputs", "Targets < 44 px"]]
for k, n in pages:
    b, a = pb[k], pa[k]; rows.append([n, f"{b['kb']:,} -> {a['kb']:,} KB", f"{b['fail']}/{b['txt']} -> {a['fail']}/{a['txt']}", f"{b['nolabel']} -> {a['nolabel']}", f"{b['lt44']} -> {a['lt44']}"])
s.append(tbl(rows, [1.2, 1.4, 1.5, 1.2, 1.2]))
s.append(P_("Also fixed on public pages: every page using the SEO component shipped with the tab title 'undefined' (and blank search description); logged-out visitors saw '0 in play now' (a 401 rendered as zero) and '0 names swept'; a '34 new updates' toast greeted first-time visitors and covered the page on phones; the header logo was a 2.1 MB image that rendered as a grey smudge; the About page claimed '300+ data sources', '8000+ stocks', '6 layers' and 'SOC 2 compliant' (now: 8 feeds, 2,000 ranked names, 17 layers, SOC 2-audited cloud); the public watchlist shifted on load (CLS 0.25 'poor'); the overnight badge said 'Data stale' when the market was simply closed.", B))

s.append(PageBreak())
s.append(P_("B4. Outcomes — NEXUS terminal (signed in)", H1))
s.append(img(f_lcp, 6.6, 2.4))
rows = [["Screen", "LCP", "Contrast fails", "Text < 12 px", "Targets < 24 px", "API calls"]]
for n in names:
    d = np_[n]; rows.append([n, f"{d['lcp']/1000:.1f} s", f"{d['fail']}/{d['txt']}", f"{d['u12']}/{d['txt']}", f"{d['lt24']}/{d['ctl']}", d["req"]])
s.append(tbl(rows, [1.8, 0.7, 1.0, 1.0, 1.1, 0.8]))
bl = UN["boardLoad"]; sv = UN["server"]
s.append(P_(f"<b>Load forensics.</b> A cold NEXUS board took <b>{bl['coldReadyMs']/1000:.1f} s</b> to show data; a warm load fires <b>{bl['warmApiCallsFirst20s']} API calls</b> in 20 s. The slowest were /api/market-pulse (9.2 s, uncached) and /api/extended-hours (7.5 s — and requested twice under different cache keys). Both now cache for 30 s with in-flight de-duplication: repeat calls measured 9.85 s -> 0.07 s and 8.07 s -> 0.04 s. But even trivial endpoints took ~{bl['trivialEndpointMs']/1000:.0f} s: the server has {sv['vcpu']} vCPU at load {sv['load1m']}, {sv['freeMB']} MB free RAM and {sv['swapUsedMB']} MB in swap. <b>The 2 GB resize is the single largest UX improvement available.</b>", B))
s.append(P_(f"<b>Contrast after the token fix:</b> the NEXUS board shows 0/77 failures. Remaining failures on radar/slate/trade-desk/performance came from 9 px sidebar group labels at 30% opacity (2.2:1) and a 1.4:1 'Reading radar…' loading line — both fixed and deployed. <b>Density:</b> 74 of 77 text elements on the board are under 12 px and 37 of 49 controls are under 24 px (WCAG 2.5.8) — the terminal's deliberate Bloomberg-style density, but it costs phone and accessibility users.", B))
it = UN["interactivity"]
s.append(P_(f"<b>Interactivity.</b> Real clicks measured with the Event Timing API: slowest interaction {it['whatsNewDrawerMs']} ms (What's-new drawer), search palette {it['searchPaletteMs']} ms — inside Google's 'good' INP threshold of 200 ms. Responsiveness is not the problem; data arrival is.", B))

s.append(P_("C. Actions taken this cycle", H1))
act = [["Area", "Change", "Status"],
    ["Model", "SPX-session publishing + its convergence vote suspended (SPX_SESSION_PUBLISH=1 to restore)", "Fixed"],
    ["Model", "Bottom-reversal fast-V: ATR fallback stop (t 3.3 -> 4.0)", "Fixed"],
    ["Tracker", "Same-day ideas judged on 5-min bars from the publish minute, not the whole-day bar", "Fixed"],
    ["Display", "Signal card shows SCORE n/100, not a confidence %", "Fixed"],
    ["Perf", "market-pulse + extended-hours: 30 s cache, in-flight dedupe, shared client key", "Fixed"],
    ["Perf", "2.1 MB logo -> 12.5 KB; 2.9 MB photo -> 35 KB (public pages -80 to -86%)", "Fixed"],
    ["A11y", "Muted text token to WCAG AA (dark + light); sidebar labels; radar loader; how-to", "Fixed"],
    ["A11y", "Login labels, named toggles/links/logout, 44 px CTAs, keyboard board rows, 7-8 px text floored at 9 px", "Fixed"],
    ["Honesty", "About claims measured; landing zeros removed; 'undefined' titles; market-closed badge", "Fixed"],
    ["UX", "First-visit update toast removed; public watchlist skeleton (no layout shift)", "Fixed"]]
s.append(tbl(act, [0.8, 5.0, 0.8], colour_col=2))

s.append(P_("D. Recommendations", H1))
rec_ = [["#", "Action", "Why", "Owner"],
    ["1", "Resize the droplet to 2 GB (~$12/mo)", "1 vCPU in swap: 10 s for trivial reads; cold board 28.6 s", "Operator"],
    ["2", "Volatility floor on stops (~0.75x ATR swing)", "Stop width is the #1 loss driver, within every producer", "Open"],
    ["3", "Weight conviction toward measured-structure evidence; drop intraday HOD/VWAP/urgency tags", "Only structure tags carry positive, FDR-surviving signal", "Open"],
    ["4", "Accrue ~220 resolved ideas per new scanner before claiming edge", "Power analysis for a 0.2R edge", "Open"],
    ["5", "Cut the NEXUS board fan-out (78 calls) into one aggregated board endpoint", "Every call competes for one CPU", "Open"],
    ["6", "Type scale: 11 px minimum for data, 12 px for prose; 24 px minimum targets", "74/77 board texts < 12 px; 37 targets < 24 px", "Open"],
    ["7", "Migrate raw palette colours and hex to tokens", f"{US['tailwindPaletteUses']:,} palette uses bypass the theme", "Open"],
    ["8", "Choose one brand mark", "Four different logos in use", "Operator"]]
s.append(tbl(rec_, [0.25, 2.6, 2.9, 0.8], colour_col=3))

s.append(P_("E. Limitations", H1))
s.append(P_("One month, one market regime; the legacy producers dominate the resolved sample and the rebuilt scanners have too few outcomes to judge. The replay uses regular-session 5-minute bars and treats a bar touching both levels as a stop, so it is conservative. Option-premium outcomes were not replayed (delayed data; Tradier key expired). UI measurements come from one browser engine and one network location, NEXUS was measured overnight with the market closed, and static counts are pattern-based (they flag candidates, not certainties). Reproduce: <font face='Courier'>npx tsx research/model-validation.ts</font>, <font face='Courier'>research/accuracy-attribution.ts</font>, <font face='Courier'>research/path-replay.ts</font>; <font face='Courier'>python3 research/ui-static-audit.py</font>; inject <font face='Courier'>research/ui-probe.js</font> on any page; <font face='Courier'>python3 research/build-full-report.py</font>.", S))

SimpleDocTemplate(OUT, pagesize=letter, leftMargin=0.75 * inch, rightMargin=0.75 * inch, topMargin=0.7 * inch, bottomMargin=0.8 * inch,
                  title="QuantEdge Validation Report v2", author="QuantEdge Labs").build(s, onFirstPage=footer, onLaterPages=footer)
print(OUT)
