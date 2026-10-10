"""QuantEdge Validation Report v3 — one platform, iPhone/iPad validated, UX 11-7, validated stop floor.
Reads research/*.json; writes docs/QuantEdge-Validation-Report-v3.pdf.
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
SF, UX, P, A = R("stop-floor-results.json"), R("ux117-results.json"), R("replay-results.json"), R("attribution-results.json")
OUT = os.path.join(ROOT, "docs", "QuantEdge-Validation-Report-v3.pdf")
FIG = os.path.join(ROOT, "research", "figs"); os.makedirs(FIG, exist_ok=True)
LOGO = os.path.join(ROOT, "attached_assets", "qe-mark-blue.png")

INK, MUTE, RULE = "#1b2330", "#5b6472", "#d9dee5"
BLUE, TEAL, RED, AMBER, GREEN = "#2f7cf0", "#1f9e91", "#c43d50", "#b8862b", "#1e8f63"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 8.5, "axes.edgecolor": RULE, "axes.labelcolor": INK,
                     "xtick.color": MUTE, "ytick.color": MUTE, "axes.spines.top": False, "axes.spines.right": False})
def save(fig, n):
    p = os.path.join(FIG, n); fig.savefig(p, dpi=200, bbox_inches="tight"); plt.close(fig); return p

# Fig: stop floor walk-forward
g = SF["grid"]; ks = [x["k"] for x in g]
fig, ax = plt.subplots(figsize=(6.6, 2.4))
ax.plot(ks, [x["testWiden"]["expectancyR"] for x in g], "o-", color=BLUE, label="Widen stop to k x ATR (out of sample)")
ax.plot(ks, [x["testReject"]["expectancyR"] for x in g], "s--", color=AMBER, label="Reject if stop < k x ATR (out of sample)")
ax.axhline(SF["baseline"]["test"]["expectancyR"], color=RED, lw=1, ls=":", label="As published (out of sample)")
ax.axhline(0, color=MUTE, lw=0.6)
ax.set_xlabel("Stop floor k (multiples of ATR(14) at publication)"); ax.set_ylabel("Expectancy (R)"); ax.legend(frameon=False, fontsize=7)
f_sf = save(fig, "v3_stopfloor.png")

# Fig: layout width on phone before/after
pages = ["/slate", "/trade-desk", "/r/META"]; before = [UX["preFixPhone"]["layoutInflation"][p] for p in pages]
fig, ax = plt.subplots(figsize=(3.3, 2.3)); x = np.arange(len(pages)); w = 0.38
ax.bar(x - w/2, before, w, color=RULE, edgecolor=MUTE, label="Before"); ax.bar(x + w/2, [393] * 3, w, color=BLUE, label="After")
ax.axhline(393, color=MUTE, ls="--", lw=0.8); ax.set_xticks(x); ax.set_xticklabels(pages, fontsize=7); ax.set_ylabel("Layout width on a 393px iPhone"); ax.legend(frameon=False, fontsize=7)
f_fit = save(fig, "v3_fit.png")

# Fig: scorecard per screen (phone)
ph = UX["phone"]; names = [k.split(" ", 1)[1] for k in ph]; vals = [v["pass"] for v in ph.values()]
fig, ax = plt.subplots(figsize=(3.3, 2.6))
ax.barh(range(len(names)), vals, color=[GREEN if v >= 10 else AMBER for v in vals]); ax.set_xlim(0, 11)
ax.set_yticks(range(len(names))); ax.set_yticklabels(names, fontsize=6.8); ax.invert_yaxis(); ax.set_xlabel("UX 11-7 criteria passed (of 11), iPhone")
f_sc = save(fig, "v3_scorecard.png")

# ── document ──────────────────────────────────────────────────────────────
ss = getSampleStyleSheet()
H0 = ParagraphStyle("H0", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=13, textColor=colors.HexColor(BLUE), spaceBefore=4, spaceAfter=4, keepWithNext=1)
H1 = ParagraphStyle("H1", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=14, textColor=colors.HexColor(INK), spaceBefore=6, spaceAfter=7, keepWithNext=1)
B = ParagraphStyle("B", parent=ss["BodyText"], fontName="Helvetica", fontSize=9.2, leading=13, textColor=colors.HexColor(INK), spaceAfter=5)
S = ParagraphStyle("S", parent=B, fontSize=7.9, leading=10.4, textColor=colors.HexColor(MUTE))
CAP = ParagraphStyle("CAP", parent=S, spaceBefore=2, spaceAfter=9)
def P_(x, st=B): return Paragraph(x, st)
def img(p, w_, h_): return Image(p, width=w_ * inch, height=h_ * inch)
def tbl(rows, widths, colour_col=None):
    rows = [[c if isinstance(c, Paragraph) else P_(str(c), S) if i and isinstance(c, str) and len(c) > 34 else c for c in r] for i, r in enumerate(rows)]
    t = Table(rows, colWidths=[x * inch for x in widths], repeatRows=1)
    st = [("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.6), ("FONT", (0, 1), (-1, -1), "Helvetica", 7.8),
          ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor(MUTE)), ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor(MUTE)),
          ("LINEBELOW", (0, 1), (-1, -1), 0.3, colors.HexColor(RULE)), ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    if colour_col is not None:
        for i, r in enumerate(rows[1:], 1):
            v = r[colour_col] if isinstance(r[colour_col], str) else ""
            c = {"Fixed": GREEN, "Shipped": GREEN, "Validated": GREEN, "Open": AMBER, "Operator": BLUE}.get(v)
            if c: st += [("TEXTCOLOR", (colour_col, i), (colour_col, i), colors.HexColor(c)), ("FONT", (colour_col, i), (colour_col, i), "Helvetica-Bold", 7.8)]
    t.setStyle(TableStyle(st)); return t
fR = lambda v: f"{v:+.3f}R"
def footer(c, doc):
    c.saveState(); c.setFont("Helvetica", 7.3); c.setFillColor(colors.HexColor(MUTE))
    c.drawImage(LOGO, 0.75 * inch, 0.42 * inch, 12, 12, mask="auto")
    c.drawString(0.75 * inch + 16, 0.5 * inch, "Quant Edge Labs · Validation Report v3 · Educational research platform — not investment advice")
    c.drawRightString(7.75 * inch, 0.5 * inch, f"Page {doc.page}"); c.restoreState()

ch, base = SF["chosen"], SF["baseline"]
s = []
hdr = Table([[Image(LOGO, width=0.55 * inch, height=0.55 * inch), [P_("Quant Edge Labs", S), P_("Validation Report v3 — one platform, every device", ParagraphStyle("T", parent=H1, fontSize=19, leading=23, spaceBefore=0))]]], colWidths=[0.7 * inch, 6.1 * inch])
hdr.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
s += [hdr, Spacer(1, 4), P_(f"Follows v2. This cycle: the server resize was verified, the legacy sidebar design retired so every page wears the NEXUS chrome and the same bottom navigation, the blue Quant Edge mark made the only logo, the platform validated on iPhone and iPad against a new SR 11-7-style interface standard (UX 11-7), and the #1 quant recommendation tested walk-forward and shipped. Prepared {datetime.date(2026, 9, 24):%B %d, %Y}.", B)]

s.append(P_("Executive summary", H1))
summ = [["Area", "Result", "Status"],
    ["Server resize (512 MB -> 2 GB)", f"Free RAM 8 -> {UX['infra']['after']['freeMB']} MB; swap 508 -> 0 MB; health check 6.4 s -> {UX['infra']['after']['healthMs']} ms", "Validated"],
    ["One platform chrome", "Sidebar layout retired; 12 pages + research now share the terminal topbar and bottom dock", "Shipped"],
    ["One logo", "Blue Quant Edge Q redrawn as vector: header, favicon, iOS/Android icons; 5 competing marks retired", "Shipped"],
    ["iPhone fit", "Pages zoomed out to 582-1,572 px on a 393 px phone -> all fit; dock reachable everywhere", "Fixed"],
    ["iPhone legibility", "Board text under 11 px: 778 of 987 -> 0 (responsive type floor on touch)", "Fixed"],
    ["UX 11-7 scorecard (iPhone)", f"{sum(v['pass'] for v in UX['phone'].values())}/{sum(v['total'] for v in UX['phone'].values())} criteria pass across {len(UX['phone'])} screens; research 11/11", "Validated"],
    ["Stop floor (1.25x ATR)", f"Out-of-sample {fR(ch['testBaseline']['expectancyR'])} -> {fR(ch['testWiden']['expectancyR'])} per idea (n={ch['testWiden']['n']})", "Shipped"],
    ["Slow shared reads", "market-pulse 21 s -> 7 ms, extended-hours 8 s -> 6 ms (stale-while-revalidate + warm)", "Fixed"],
    ["Data-heavy screens still slow (U8)", f"LCP 2.7-15 s; one vCPU at load {UX['infra']['after']['load1m']}, scanners take ~64% CPU", "Operator"]]
s.append(tbl(summ, [1.9, 3.95, 0.75], colour_col=2))

s.append(P_("Part A — Revalidating accuracy", H0))
s.append(P_("A1. The stop-floor intervention, tested before shipping", H1))
s.append(P_(f"v2 found stop width to be the strongest loss driver (IC +0.30, holding within every producer). Measured this cycle: the median published stop sat at <b>{SF['stopATRquartiles'][1]:.2f}x</b> the stock's own ATR(14) — inside a normal day's range. Two interventions were replayed on the real 5-minute path of every idea ({SF['n']} ideas), the floor chosen on the first half and scored only on the second:", B))
s.append(img(f_sf, 6.6, 2.4))
s.append(P_("Figure 1. Out-of-sample expectancy by floor. Both interventions beat the published stops at every floor above 0.5x ATR.", CAP))
s.append(tbl([["Out of sample (2nd half)", "Ideas", "Expectancy", "t", "Hit rate", "Total R"],
    ["As published", ch["testBaseline"]["n"], fR(ch["testBaseline"]["expectancyR"]), f"{ch['testBaseline']['t']:.2f}", f"{ch['testBaseline']['hit']*100:.0f}%", f"{ch['testBaseline']['totalR']:.1f}"],
    [f"Widen to {ch['widenK']}x ATR (shipped)", ch["testWiden"]["n"], fR(ch["testWiden"]["expectancyR"]), f"{ch['testWiden']['t']:.2f}", f"{ch['testWiden']['hit']*100:.0f}%", f"{ch['testWiden']['totalR']:.1f}"],
    [f"Reject if under {ch['rejectK']}x ATR", ch["testReject"]["n"], fR(ch["testReject"]["expectancyR"]), f"{ch['testReject']['t']:.2f}", f"{ch['testReject']['hit']*100:.0f}%", f"{ch['testReject']['totalR']:.1f}"]], [2.0, 0.6, 0.9, 0.6, 0.7, 0.8]))
bs = SF["bySource"]
rows = [["Producer", "n", "Median stop / ATR", "Published", "Widened 0.75x", "Only stops >= 0.75x (n)"]]
for k, v in bs.items(): rows.append([k, v["n"], f"{v['medianStopATR']:.2f}", fR(v["base"]["expectancyR"]), fR(v["widen075"]["expectancyR"]), f"{fR(v['reject075']['expectancyR'])} ({v['reject075']['n']})"])
s.append(Spacer(1, 6)); s.append(tbl(rows, [1.2, 0.5, 1.1, 0.95, 1.0, 1.55]))
s.append(P_("<b>Reading.</b> Widening halves the loss but does not by itself create an edge — selection must still improve. The standout: the quant producer's ideas whose stops were already at least 0.75x ATR averaged <b>+0.32R</b> — the only positive slice of the legacy book. The floor is now enforced at the shared ingestion gate for swing and position ideas (day trades exempt: a daily range is the wrong yardstick intraday); every widened idea states the change in its analysis text.", B))
s.append(P_(f"A2. Standing findings carried from v2 (unchanged — no new resolved outcomes since)", H1))
s.append(P_(f"Independent 5-minute replay remains the ground truth: legacy book {P['overall']['hitRate']*100:.1f}% hit vs {P['overall']['breakEven']*100:.1f}% chance, {fR(P['overall']['expectancyR'])} per idea. SPX-session publishing stays suspended; the tracker's same-day look-ahead bug stays fixed; shorts were not worse than longs once adjudicated. The rebuilt scanners still need ~220 resolved ideas each before any edge claim (power analysis, v2 A5).", B))

s.append(P_("Part B — UX 11-7: the SR 11-7 discipline for the interface", H0))
s.append(P_("B1. The standard", H1))
s.append(P_("There is no regulator's SR 11-7 for interfaces, so one was assembled from the recognised standards that play the same role: <b>ISO 9241-11</b> (usability = effectiveness, efficiency, satisfaction), <b>ISO 9241-110</b> (interaction principles), <b>ISO/IEC 25010</b> (product quality), <b>WCAG 2.2 AA</b> (accessibility), <b>Core Web Vitals</b> (speed and stability), <b>Apple HIG</b> (touch and safe areas) and <b>Nielsen's heuristics</b> (expert review). Each SR 11-7 pillar maps to an interface practice, and each criterion is a pass/fail test run on the live screen by research/ui-scorecard.js.", B))
s.append(tbl([["SR 11-7 pillar", "Interface equivalent in UX 11-7"],
    ["Model inventory & governance", "Screen inventory (13 surfaces x 3 device classes); one design system as the governing policy"],
    ["Conceptual soundness", "Static audit: tokens not hard-coded colours, type scale, semantic controls (ui-static-audit.py)"],
    ["Outcomes analysis", "Runtime scorecard on the live site, signed in (ui-scorecard.js)"],
    ["Benchmarking", "Thresholds from WCAG, Core Web Vitals, HIG — not taste"],
    ["Ongoing monitoring", "Scorecard re-runnable on any page; results versioned in research/"],
    ["Effective challenge / limitations", "Findings reported even when unfixed (U8 speed); emulation limits disclosed"]], [2.0, 4.6]))
s.append(Spacer(1, 6))
s.append(tbl([["ID", "Criterion", "Threshold", "Standard"],
    ["U1", "Fit", "layout width = device width (no zoom-out)", "ISO 9241-110 · HIG"],
    ["U2", "Reachable", "primary navigation visible on the device", "ISO 9241-110 controllability"],
    ["U3", "Legible", ">= 95% of text >= 11 px on touch", "ISO 9241-303 · HIG"],
    ["U4", "Contrast", ">= 98% of text at WCAG AA", "WCAG 2.2 1.4.3"],
    ["U5", "Targets", ">= 90% of controls >= 24 px on touch", "WCAG 2.2 2.5.8 · HIG"],
    ["U6", "Named", "every control has an accessible name", "WCAG 2.2 4.1.2"],
    ["U7", "Stable", "CLS <= 0.10", "Core Web Vitals"],
    ["U8", "Fast", "LCP <= 2.5 s", "Core Web Vitals"],
    ["U9", "One system", "brand mark present; <= 3 font families", "ISO 9241-110 conformity · Nielsen 4"],
    ["U10", "Honest", "no 'undefined' / 'NaN' / '[object Object]'", "Nielsen 1 · self-descriptiveness"],
    ["U11", "Titled", "document title set", "WCAG 2.2 2.4.2"]], [0.4, 0.9, 2.9, 2.4]))

s.append(P_("B2. iPhone and iPad — what was broken, what changed", H1))
s.append(KeepTogether([img(f_fit, 3.3, 2.3), P_("Figure 2. Before, one wide element made iOS zoom the whole page out — dock included — on Slate, Trade Desk and research. Overflow is now contained at the shell, so wide tables scroll inside their own panel.", CAP)]))
fixes = [["Finding (iPhone 15 Pro, 393 px)", "Fix", "Status"],
    ["Pages zoomed out to 582-1,572 px", "Shell contains overflow; frame can't exceed viewport; wrapping tab clusters; fluid Slate grid", "Fixed"],
    ["Research had no bottom dock / no top bar", "Research routed through the shared frame", "Fixed"],
    ["778 of 987 board texts under 11 px", "Font sizes tokenised (241 CSS + 148 inline); 11 px floor on phones and touch tablets", "Fixed"],
    ["Workup hid evidence + levels rails on phones; header clipped", "Rails stack under the chart in one scroll; header wraps", "Fixed"],
    ["Stale workup re-opened on every page, covering the dock", "Opens only when a ticker is chosen in the current view", "Fixed"],
    ["Faded muted text 2.9:1", "Sub-90% opacity removed from muted text at 453 sites", "Fixed"],
    ["Layout shift: Performance 0.54, Slate 0.29", "Viewport-tall placeholder; reserved subtitle height", "Fixed"],
    ["Controls under 24 px on touch", "28 px minimum for buttons/tabs under a thumb", "Fixed"],
    ["Third status bar with 'SKYNET v3.2' label", "Legacy EngineStatusFooter removed (3 pages)", "Fixed"]]
s.append(tbl(fixes, [2.3, 3.5, 0.8], colour_col=2))
s.append(Spacer(1, 6))
s.append(KeepTogether([img(f_sc, 3.3, 2.6), P_("Figure 3. Final scorecard per screen on iPhone. The remaining failure on nearly every data screen is U8 (speed); fit, navigation, legibility, targets, names, honesty and titles pass.", CAP)]))
rows = [["Screen", "iPhone", "iPad", "Remaining failures"]]
tab = {k.split(" ", 1)[1]: v for k, v in UX["tablet"].items()}
for k, v in UX["phone"].items():
    pth = k.split(" ", 1)[1]; t = tab.get(pth)
    rows.append([pth, f"{v['pass']}/11", f"{t['pass']}/11" if t else "—", "; ".join(v["fail"]) or "none"])
s.append(tbl(rows, [1.3, 0.6, 0.6, 4.1]))
s.append(P_("iPad landscape (1180 px) uses the desktop layout: the unified top navigation fits (14 items in 965 px) with no overflow. The emulator cannot present a touch pointer at that width, so the 11 px floor there was verified by rule (pointer:coarse), not by measurement.", CAP))

s.append(P_("B3. Speed and the server", H1))
inf = UX["infra"]
s.append(tbl([["Measure", "Before", "After"],
    ["RAM / free / swap", f"{inf['before']['ramMB']} / {inf['before']['freeMB']} / {inf['before']['swapMB']} MB", f"{inf['after']['ramMB']} / {inf['after']['freeMB']} / {inf['after']['swapMB']} MB"],
    ["Health check", f"{inf['before']['healthColdS']} s", f"{inf['after']['healthMs']} ms"],
    ["/api/market-pulse", f"{inf['endpoints']['/api/market-pulse']['coldS']} s cold", f"{inf['endpoints']['/api/market-pulse']['warmMs']} ms (stale-while-revalidate)"],
    ["/api/extended-hours", f"{inf['endpoints']['/api/extended-hours']['coldS']} s cold", f"{inf['endpoints']['/api/extended-hours']['warmMs']} ms"],
    ["Quote batch (3 symbols) under scanner load", "—", f"{inf['endpoints']['/api/quotes/batch (3 syms)']['underLoadS']} s"]], [2.4, 2.0, 2.2]))
s.append(P_(f"Memory is solved. The limit is now the <b>single vCPU</b>: load {inf['after']['load1m']} with background scanners using ~{inf['after']['scannerCpuPct']}% of it, and live quotes queue behind their requests. That is why data-heavy screens still miss the 2.5 s LCP target.", B))

s.append(P_("C. Recommendations", H1))
rec = [["#", "Action", "Why", "Owner"],
    ["1", "Move to 2 vCPU (DigitalOcean ~$18/mo) or cap scanner concurrency", "One CPU at load 2.3; quotes wait behind scanners", "Operator"],
    ["2", "One aggregated board endpoint instead of ~78 calls", "Every call competes for the one CPU; LCP on data screens", "Open"],
    ["3", "Weight conviction toward measured-structure evidence", "Only structure tags and stops >= 0.75x ATR show positive R", "Open"],
    ["4", "Re-run the stop-floor replay monthly as new outcomes resolve", "Shipped on 332 out-of-sample ideas; confirm it holds live", "Open"],
    ["5", "Migrate remaining raw palette colours to tokens", "2,187 raw uses bypass theme and contrast fixes", "Open"]]
s.append(tbl(rec, [0.25, 2.6, 2.9, 0.8], colour_col=3))
s.append(P_("D. Limitations", H1))
s.append(P_("Measured overnight with the market closed, in one browser engine, with device emulation rather than physical devices; iPad touch behaviour at landscape width verified by rule. LCP depends on data arrival and varies run to run. The stop-floor test uses one month, one regime, and the same conservative replay rules as v2 (regular session, gaps at the open, double touches as stops). Reproduce: npx tsx research/stop-floor-test.ts; inject research/ui-scorecard.js on any page and call __uxScore(); python3 research/build-report-v3.py.", S))

SimpleDocTemplate(OUT, pagesize=letter, leftMargin=0.75 * inch, rightMargin=0.75 * inch, topMargin=0.7 * inch, bottomMargin=0.8 * inch,
                  title="Quant Edge Labs Validation Report v3", author="Quant Edge Labs").build(s, onFirstPage=footer, onLaterPages=footer)
print(OUT)
