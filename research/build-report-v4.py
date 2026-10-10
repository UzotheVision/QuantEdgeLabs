"""Validation Report v4 — navigation architecture (V-model), readability and colour overhaul.
Reads research/nav-architecture.json + research/ux-overhaul-results.json; writes docs/QuantEdge-Validation-Report-v4.pdf.
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
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, KeepTogether

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = lambda f: json.load(open(os.path.join(ROOT, "research", f)))
NAV, OV = R("nav-architecture.json"), R("ux-overhaul-results.json")
FIG = os.path.join(ROOT, "research", "figs")
LOGO = os.path.join(ROOT, "attached_assets", "qe-mark-blue.png")
OUT = os.path.join(ROOT, "docs", "QuantEdge-Validation-Report-v4.pdf")
INK, MUTE, RULE, BLUE, GREEN, AMBER, RED = "#1b2330", "#5b6472", "#d9dee5", "#2f7cf0", "#1e8f63", "#b8862b", "#c43d50"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 8.5, "axes.edgecolor": RULE, "axes.labelcolor": INK,
                     "xtick.color": MUTE, "ytick.color": MUTE, "axes.spines.top": False, "axes.spines.right": False})

# readability before/after chart
rb = OV["readability"]
labels = ["Board text < 11px\n(desktop)", "Board text < 11px\n(iPhone)", "Board text < 12px\n(iPhone)", "Board text < 12px\n(desktop)"]
before = [rb["before"]["deskUnder11"], rb["before"]["phoneUnder11"], rb["before"]["phoneUnder12"], rb["before"]["deskUnder12"]]
after = [rb["after"]["deskUnder11"], rb["after"]["phoneUnder11"], rb["after"]["phoneUnder12"], rb["after"]["deskUnder12"]]
fig, ax = plt.subplots(figsize=(6.6, 2.3)); x = np.arange(len(labels)); w = 0.38
ax.bar(x - w/2, before, w, color=RULE, edgecolor=MUTE, label="Before"); ax.bar(x + w/2, after, w, color=BLUE, label="After")
for i, (b, a) in enumerate(zip(before, after)): ax.text(i - w/2, b + 2, f"{b}%", ha="center", fontsize=7); ax.text(i + w/2, a + 2, f"{a}%", ha="center", fontsize=7, color=BLUE)
ax.set_xticks(x); ax.set_xticklabels(labels, fontsize=7.2); ax.set_ylabel("% of text elements"); ax.set_ylim(0, 100); ax.legend(frameon=False, fontsize=7.5)
f_read = os.path.join(FIG, "v4_readability.png"); fig.savefig(f_read, dpi=200, bbox_inches="tight"); plt.close(fig)

# palette swatch + CVD chart
pal = OV["palette"]
fig, ax = plt.subplots(figsize=(6.6, 1.3)); ax.axis("off"); ax.set_xlim(0, 10); ax.set_ylim(0, 2)
for i, (name, old, new) in enumerate(pal["swatches"]):
    x0 = i * 2.0 + 0.1
    ax.add_patch(plt.Rectangle((x0, 1.05), 0.85, 0.6, color=old)); ax.add_patch(plt.Rectangle((x0 + 0.95, 1.05), 0.85, 0.6, color=new))
    ax.text(x0 + 0.9, 0.75, name, ha="center", fontsize=7.5, color="#e8ecf3"); ax.text(x0 + 0.42, 0.45, "before", ha="center", fontsize=6, color="#9aa3b2"); ax.text(x0 + 1.37, 0.45, "after", ha="center", fontsize=6, color="#9aa3b2")
f_pal = os.path.join(FIG, "v4_palette.png"); fig.savefig(f_pal, dpi=200, bbox_inches="tight", facecolor="#0e1117"); plt.close(fig)

ss = getSampleStyleSheet()
H0 = ParagraphStyle("H0", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=13, textColor=colors.HexColor(BLUE), spaceBefore=4, spaceAfter=4, keepWithNext=1)
H1 = ParagraphStyle("H1", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=14, textColor=colors.HexColor(INK), spaceBefore=6, spaceAfter=7, keepWithNext=1)
B = ParagraphStyle("B", parent=ss["BodyText"], fontName="Helvetica", fontSize=9.4, leading=13.4, textColor=colors.HexColor(INK), spaceAfter=5)
S = ParagraphStyle("S", parent=B, fontSize=8, leading=10.6, textColor=colors.HexColor(MUTE))
CAP = ParagraphStyle("CAP", parent=S, spaceBefore=2, spaceAfter=9)
P_ = lambda x, st=B: Paragraph(x, st)
img = lambda p, w_, h_: Image(p, width=w_ * inch, height=h_ * inch)
def tbl(rows, widths, cc=None):
    rows = [[c if isinstance(c, Paragraph) else P_(str(c), S) if i and isinstance(c, str) and len(c) > 30 else c for c in r] for i, r in enumerate(rows)]
    t = Table(rows, colWidths=[x * inch for x in widths], repeatRows=1)
    st = [("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.8), ("FONT", (0, 1), (-1, -1), "Helvetica", 8),
          ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor(MUTE)), ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor(MUTE)),
          ("LINEBELOW", (0, 1), (-1, -1), 0.3, colors.HexColor(RULE)), ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    if cc is not None:
        for i, r in enumerate(rows[1:], 1):
            v = r[cc] if isinstance(r[cc], str) else ""
            c = {"Fixed": GREEN, "Pass": GREEN, "Merged": GREEN, "Retired": AMBER, "Kept": BLUE, "Open": AMBER, "Fail": RED}.get(v)
            if c: st += [("TEXTCOLOR", (cc, i), (cc, i), colors.HexColor(c)), ("FONT", (cc, i), (cc, i), "Helvetica-Bold", 8)]
    t.setStyle(TableStyle(st)); return t
def footer(c, doc):
    c.saveState(); c.setFont("Helvetica", 7.3); c.setFillColor(colors.HexColor(MUTE))
    c.drawImage(LOGO, 0.75 * inch, 0.42 * inch, 12, 12, mask="auto")
    c.drawString(0.75 * inch + 16, 0.5 * inch, "Quant Edge Labs · Report v4 · Navigation, readability and colour · not investment advice")
    c.drawRightString(7.75 * inch, 0.5 * inch, f"Page {doc.page}"); c.restoreState()

s = []
hdr = Table([[Image(LOGO, width=0.55 * inch, height=0.55 * inch), [P_("Quant Edge Labs", S), P_("Report v4 — navigation architecture, readability and colour", ParagraphStyle("T", parent=H1, fontSize=18, leading=22, spaceBefore=0))]]], colWidths=[0.7 * inch, 6.1 * inch])
hdr.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
s += [hdr, Spacer(1, 4), P_(f"Question asked: do the pages and navigation correspond and flow, is anything redundant or missing, can every page be seen on every device, and can people actually read it? Method: a systems-engineering V-model — each requirement traced to a test — run on the live platform, then fixes, then the same tests again. Prepared {datetime.date(2026, 9, 24):%B %d, %Y}.", B)]

s.append(P_("Executive summary", H1))
rt = OV["routeWalk"]
s.append(tbl([["Finding", "Before", "After", "Status"],
    ["Dead links (lead nowhere)", "5", "0", "Fixed"],
    ["Stale links (through a retired URL)", "11", "0", "Fixed"],
    ["Pages with no door", "3 (audit, About, public watchlist)", "0", "Fixed"],
    ["Duplicate pages", "Trade Desk ('0 ideas' beside a full board); Automations (duplicate BOT, $0.00 P&L)", "Merged / retired", "Fixed"],
    ["Content hidden on iPad / phone", "7 columns/sidebars display:none under 1100px", "All stacked, visible", "Fixed"],
    ["Ideas first on phone", "3rd section, ~9,500px down", "1st section", "Fixed"],
    ["Board text under 11px (desktop / iPhone)", f"{rb['before']['deskUnder11']}% / {rb['before']['phoneUnder11']}%", f"{rb['after']['deskUnder11']}% / {rb['after']['phoneUnder11']}%", "Fixed"],
    ["Gain vs loss for colour-blind users (dE, deuteranopia)", "15 (barely distinct)", "49", "Fixed"],
    ["Accent confusable with 'gain' (dE)", "33 (teal ~ green)", "101 (brand blue)", "Fixed"],
    [f"Live route walk ({rt['n']} destinations)", "—", f"{rt['ok']}/{rt['n']} render; redirects land correctly", "Pass" if rt['ok'] == rt['n'] else "Open"]],
    [2.2, 1.9, 1.7, 0.8], cc=3))

s.append(P_("Part A — Navigation as a system", H0))
s.append(P_("A1. The V-model", H1))
s.append(img(os.path.join(FIG, "v4_vmodel.png"), 6.6, 3.66))
s.append(P_("Figure 1. Left side: what the platform must do, decomposed down to code. Right side: the test that proves each level. Dashed lines are traceability — no requirement without a test, no test without a requirement.", CAP))
s.append(P_("A2. Architecture tests (research/nav-architecture.py)", H1))
s.append(P_(f"The navigation graph was built from source: {NAV['routes']} routes, {NAV['redirects']} redirect rules, {NAV['linkTargets']} distinct link targets from every file. Each link target was resolved against the routes and redirects.", B))
s.append(tbl([["Test", "What it asks", "Before", "After"],
    ["N1 Dead links", "Does every link lead to a page?", "5 dead", "0"],
    ["N2 Stale links", "Does any link still go through a retired URL?", "11", "0"],
    ["N3 Orphans", "Is there page code no route renders?", "4 files", "0 (3 deleted; backtest is embedded in Performance)"],
    ["N4 No door", "Is there a route nothing links to?", "3", "0"],
    ["N5 Coverage", "Is every surface in the one nav model?", "2 nav systems", "1 model, terminal + pages + dock"],
    ["N6 Redundancy", "Do two surfaces do the same job?", "2 duplicates", "0 (merged/retired)"]], [1.3, 2.6, 1.0, 1.7]))
s.append(P_("A3. Redundancy decisions", H1))
s.append(tbl([["Job", "Surfaces", "Decision"],
    ["Rank today's ideas", "NEXUS board · Slate · Trade Desk", "Merged"],
    ["", "Trade Desk showed '0 ideas / scanning' while the board held 22. Its one unique piece — pre-market gappers — now leads Slate. /trade-desk redirects to /slate.", ""],
    ["Bots", "BOT tab · Automations page", "Retired"],
    ["", "Automations duplicated BOT and reported +$0.00 automated P&L beside a +$429 paper book. /automations redirects to the BOT tab.", ""],
    ["Chart setups", "Radar page · board pattern radar", "Kept"],
    ["", "Complementary: the board shows the count; Radar is the full browser.", ""],
    ["Alerts / Settings / Guide", "page + terminal drawer", "Kept"],
    ["", "Drawer = quick in-context; page = full management. Both reached from the account menu and More.", ""]], [1.6, 3.9, 1.1], cc=2))
s.append(KeepTogether([P_("A4. Navigation architecture after", H1), img(os.path.join(FIG, "v4_navarch.png"), 6.6, 4.2), P_("Figure 2. One chrome over everything; terminal instruments and pages side by side; research and the workup as the drill-down; retired URLs land on their successor in one hop.", CAP)]))
s.append(P_("A5. Live route walk", H1))
rows = [["Destination", "Landed on", "Result"]] + [[r["to"], r["landed"], "Pass" if (not r["notFound"] and not r["err"] and r["chars"] > 150) else "Fail"] for r in rt["rows"]]
s.append(tbl(rows, [2.2, 2.6, 1.8], cc=2))
s.append(P_("Signed-in session, desktop. Each destination navigated in-app; a pass means a real page rendered (no 404, no error boundary, content present) at the expected URL — redirects included.", CAP))

s.append(P_("Part B — Readability and colour", H0))
s.append(P_("B1. Can people read it?", H1))
s.append(img(f_read, 6.6, 2.3))
s.append(P_("Figure 3. Share of board text below comfortable sizes, before and after (live NEXUS board). 'Before' for iPhone under 12px is a lower bound (79% were already under 11px).", CAP))
s.append(P_("<b>Why these metrics.</b> Legibility research is consistent on three points the terminal was violating: text under ~12 px on a phone forces zooming; all-caps slows reading of running text because word shapes disappear; and monospace is for aligning numbers, not for sentences. <b>What changed:</b> the smallest sizes became tokens (11/12 px at a desk, 12/13 px under a thumb, 320 CSS sizes and 148 inline sizes moved onto them); every sentence — paragraphs and lists — now renders in a proportional face, sentence case, 1.55 line height; numbers, tickers and short labels stay monospace so columns still align.", B))
s.append(tbl([["Metric (live, NEXUS board)", "Desktop 1440", "iPhone 393"],
    ["Median text size", f"{rb['after']['deskMedian']}px", f"{rb['after']['phoneMedian']}px"],
    ["Text under 12px", f"{rb['after']['deskUnder12']}%", f"{rb['after']['phoneUnder12']}%"],
    ["Sentences in all-caps", f"{rb['after']['proseUpper']}%", f"{rb['after']['proseUpper']}%"],
    ["Sentence line height", f"{rb['after']['proseLH']}", f"{rb['after']['proseLH']}"]], [2.8, 1.9, 1.9]))
s.append(P_("B2. Colour psychology and colour-blind safety", H1))
s.append(img(f_pal, 6.6, 1.3))
s.append(P_("Figure 4. Before/after swatches: accent, gain, loss, caution.", CAP))
rows = [["Pair", "Normal vision dE", "Deuteranopia dE", "Protanopia dE"]]
for p in pal["pairs"]: rows.append([p["pair"], f"{p['before'][0]} -> {p['after'][0]}", f"{p['before'][1]} -> {p['after'][1]}", f"{p['before'][2]} -> {p['after'][2]}"])
s.append(tbl(rows, [2.0, 1.55, 1.55, 1.5]))
s.append(P_("<b>Principles applied.</b> (1) <b>One accent, and it is the brand's blue</b> — blue reads as calm and trustworthy, which suits a tool people make money decisions in; the old teal sat so close to 'gain' green (dE 33) that a highlighted control read like a profit. (2) <b>Green and red keep their trading meaning</b> but move apart for the ~8% of men with red-green colour vision deficiency — mint gain and vermilion loss (dE 15 -> 49 under deuteranopia), and every change also carries a sign or arrow so colour is never the only cue. (3) <b>Caution is yellow</b>, clearly separate from loss. (4) <b>Semantic colours are reserved</b>: colour means something, so decoration stays neutral. Differences are CIELAB dE with Machado-2009 colour-vision simulation.", B))
s.append(P_("B3. Can every page be seen on every device?", H1))
s.append(tbl([["Surface", "Before (under 1100px)", "After"],
    ["NEXUS board", "'Developing' column hidden on iPad; ideas 3rd on phone", "All 3 sections; Active Book first"],
    ["GEX", "both side columns hidden", "stacked below the main view"],
    ["LEAPS · CRYPTO · BOT · CATALYST", "right column hidden", "stacked"],
    ["CHART · FLOW", "sidebar hidden", "stacked after the main view"],
    ["Board stat tiles / signal levels", "5-up grid, labels cut ('AVG EVIDEN', 'SESSIO')", "2-up / 3-up reflow, full labels"],
    ["Top bar (desktop)", "wrapped onto two lines after the type increase", "one line; nav scrolls in place"]], [1.9, 2.6, 2.1]))
s.append(P_("C. Open items", H1))
s.append(tbl([["Item", "Why it matters", "Next step"],
    [f"{rb['after']['proseMono']}% of sentences still monospace", "They sit in generic containers, not paragraphs", "Mark prose containers; same rule applies"],
    [f"{rb['after']['upperAll']}% of all text uppercase", "Fine for short labels; tiring in bulk", "Sentence-case section labels over 3 words"],
    ["Active Book ~9,400px long on a phone", "Long scroll before market context", "Show top 6 + 'show all' on phones"],
    ["Data-heavy screens LCP 3-15s", "One vCPU shared with scanners (v3)", "2 vCPU or scanner throttling; one board endpoint"]], [2.2, 2.3, 2.1]))

SimpleDocTemplate(OUT, pagesize=letter, leftMargin=0.75 * inch, rightMargin=0.75 * inch, topMargin=0.7 * inch, bottomMargin=0.8 * inch,
                  title="Quant Edge Labs Report v4", author="Quant Edge Labs").build(s, onFirstPage=footer, onLaterPages=footer)
print(OUT)
