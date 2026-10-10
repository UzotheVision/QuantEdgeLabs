"""Report v5 — the SR 11-7 inventory applied to every surface: purpose, keep/merge/retire, evidence."""
import json, os, datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INV = json.load(open(os.path.join(ROOT, "research", "surface-inventory.json")))["surfaces"]
OV = json.load(open(os.path.join(ROOT, "research", "surface-inventory.json")))["overlap"]
LOGO = os.path.join(ROOT, "attached_assets", "qe-mark-blue.png")
OUT = os.path.join(ROOT, "docs", "QuantEdge-Validation-Report-v5.pdf")
INK, MUTE, RULE, BLUE, GREEN, AMBER, RED = "#1b2330", "#5b6472", "#d9dee5", "#2f7cf0", "#1e8f63", "#b8862b", "#c43d50"

ss = getSampleStyleSheet()
H0 = ParagraphStyle("H0", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=13, textColor=colors.HexColor(BLUE), spaceBefore=4, spaceAfter=4, keepWithNext=1)
H1 = ParagraphStyle("H1", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=14, textColor=colors.HexColor(INK), spaceBefore=6, spaceAfter=7, keepWithNext=1)
B = ParagraphStyle("B", parent=ss["BodyText"], fontName="Helvetica", fontSize=9.4, leading=13.4, textColor=colors.HexColor(INK), spaceAfter=5)
S = ParagraphStyle("S", parent=B, fontSize=8, leading=10.6, textColor=colors.HexColor(MUTE))
BIG = ParagraphStyle("BIG", parent=B, fontSize=12.5, leading=17, textColor=colors.HexColor(INK), spaceBefore=4, spaceAfter=8, leftIndent=10, borderPadding=6)
P_ = lambda x, st=B: Paragraph(x, st)
def tbl(rows, widths, cc=None):
    rows = [[c if isinstance(c, Paragraph) else P_(str(c), S) if i and isinstance(c, str) and len(c) > 26 else c for c in r] for i, r in enumerate(rows)]
    t = Table(rows, colWidths=[x * inch for x in widths], repeatRows=1)
    st = [("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.8), ("FONT", (0, 1), (-1, -1), "Helvetica", 8),
          ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor(MUTE)), ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor(MUTE)),
          ("LINEBELOW", (0, 1), (-1, -1), 0.3, colors.HexColor(RULE)), ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    if cc is not None:
        for i, r in enumerate(rows[1:], 1):
            v = r[cc] if isinstance(r[cc], str) else ""
            c = {"Keep": GREEN, "Merged": BLUE, "Retired": AMBER, "Hidden by default": AMBER, "Removed": AMBER, "Fixed": GREEN, "Open": RED}.get(v)
            if c: st += [("TEXTCOLOR", (cc, i), (cc, i), colors.HexColor(c)), ("FONT", (cc, i), (cc, i), "Helvetica-Bold", 8)]
    t.setStyle(TableStyle(st)); return t
def footer(c, doc):
    c.saveState(); c.setFont("Helvetica", 7.3); c.setFillColor(colors.HexColor(MUTE))
    c.drawImage(LOGO, 0.75 * inch, 0.42 * inch, 12, 12, mask="auto")
    c.drawString(0.75 * inch + 16, 0.5 * inch, "Quant Edge Labs · Report v5 · Purpose and surface inventory · not investment advice")
    c.drawRightString(7.75 * inch, 0.5 * inch, f"Page {doc.page}"); c.restoreState()

s = []
hdr = Table([[Image(LOGO, width=0.55 * inch, height=0.55 * inch), [P_("Quant Edge Labs", S), P_("Report v5 — what the platform is for, and what every page is for", ParagraphStyle("T", parent=H1, fontSize=18, leading=22, spaceBefore=0))]]], colWidths=[0.7 * inch, 6.1 * inch])
hdr.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
s += [hdr, Spacer(1, 4), P_(f"SR 11-7 starts every review with the <b>model inventory</b>: list everything in use, state what each is for, and retire what cannot justify itself. Applied here to every screen. Evidence came from the code (which data each screen reads, research/surface-inventory.py), the live site, and usage logs. Prepared {datetime.date(2026, 9, 24):%B %d, %Y}.", B)]

s.append(P_("1. The platform's exact purpose", H1))
s.append(P_("<b>Quant Edge finds today's highest-evidence trades, shows why and how to take them, and proves whether they worked.</b>", BIG))
s.append(P_("Every surface must serve one of four jobs. A surface that serves none, or serves one another surface already serves better, is merged or retired.", B))
s.append(tbl([["Job", "The question it answers", "Where it lives now"],
    ["1. FIND", "What should I look at today?", "NEXUS board (ranked book) · Slate (daily digest + pre-market movers) · Radar (chart patterns) · LEAPS (long-dated) · CRYPTO"],
    ["2. UNDERSTAND", "Why this, and what is the market doing?", "Ticker workup (quick look) · Research (options, GEX, flow lab) · CHART · FLOW · GEX · CATALYST · board market context"],
    ["3. ACT", "How would I take it, and at what size?", "Contract picker + levels in the workup · BOT (paper execution)"],
    ["4. PROVE", "Did it work?", "JOURNAL: Trade log · Track record · Backtest · POSITIONS · Alerts"]], [1.0, 2.0, 3.6]))

s.append(P_("2. Inventory and decisions", H1))
DEC = {
 "NEXUS board": ("FIND", "Keep", "Consolidated (section 3)"), "CHART": ("UNDERSTAND", "Keep", ""), "FLOW": ("UNDERSTAND", "Keep", "the only home for the print tape now"),
 "GEX": ("UNDERSTAND", "Keep", ""), "LEAPS": ("FIND", "Keep", "only long-dated surface"), "CRYPTO": ("FIND", "Keep", ""), "CATALYST": ("UNDERSTAND", "Keep", ""),
 "BOT": ("ACT", "Keep", "absorbed Automations"), "POSITIONS": ("PROVE", "Keep", ""), "JOURNAL": ("PROVE", "Keep", "absorbed Performance; AI-chat History retired"),
 "Slate": ("FIND", "Keep", "absorbed Trade Desk's pre-market movers"), "Radar": ("FIND", "Keep", ""), "Performance": ("PROVE", "Merged", "same component as JOURNAL > Track record"),
 "Alerts": ("PROVE", "Keep", ""), "How-to": ("—", "Keep", "guide"), "Settings": ("—", "Keep", ""), "Research": ("UNDERSTAND", "Keep", "options & flow lab; workup = quick look"),
 "Ticker workup": ("UNDERSTAND", "Keep", "decision dossier"),
}
rows = [["Surface", "Job", "Sources", "Unique", "Lines", "Decision", "Note"]]
for n, o in INV.items():
    job, dec, note = DEC.get(n, ("", "", ""))
    rows.append([n, job, len(o["apis"]), len(o["unique"]), f"{o['lines']:,}", dec, note])
rows += [["Trade Desk (page)", "FIND", "—", "—", "deleted", "Retired", "showed '0 ideas' beside a full board -> /slate"],
         ["Automations (page)", "ACT", "—", "—", "deleted", "Retired", "duplicate BOT, $0.00 P&L -> BOT tab"],
         ["Journal > History", "—", "—", "—", "—", "Retired", "chats from a chatbot that no longer exists"]]
s.append(tbl(rows, [1.15, 0.8, 0.6, 0.6, 0.65, 0.75, 2.05], cc=5))
s.append(P_("'Data sources' counts the API endpoints a screen's code reads; 'unique' counts those no other screen reads. Zero unique means the screen shows nothing the platform doesn't already show elsewhere. Strongest duplicate found: " + f"{OV[0]['a']} ~ {OV[0]['b']} share {len(OV[0]['shared'])} sources (Jaccard {OV[0]['jaccard']}) — the Journal tab rendered the Performance page itself.", S))

s.append(P_("3. The NEXUS board — why it felt like 'a lot going on'", H1))
s.append(P_(f"It was the heaviest screen by far: {INV['NEXUS board']['files']} files, {INV['NEXUS board']['lines']:,} lines, {len(INV['NEXUS board']['apis'])} data sources, 14 panels and 4 views of the same list. Several panels showed the same thing: sector rotation appeared four ways, flow prints duplicated the FLOW tab, and a status block duplicated the footer.", B))
s.append(tbl([["Panel", "Job", "Duplicates", "Decision"],
    ["Active Book (ranked ideas)", "FIND", "—", "Keep"],
    ["Candidate field (pre-trigger)", "FIND", "—", "Keep"],
    ["Market pulse (futures, crypto)", "UNDERSTAND", "partly the ticker tape", "Keep"],
    ["Rotation map + cash rotation", "UNDERSTAND", "—", "Keep"],
    ["Session brief (leading groups + names)", "UNDERSTAND", "names inside groups — unique", "Keep"],
    ["Pattern radar (count)", "FIND", "Radar page (it is the door to it)", "Keep"],
    ["Watchlist", "FIND", "—", "Keep"],
    ["Sector heatmap", "UNDERSTAND", "Rotation map", "Hidden by default"],
    ["Flow prints", "UNDERSTAND", "FLOW tab", "Hidden by default"],
    ["System status block", "—", "Footer bar on every tab", "Removed"]], [2.3, 1.0, 2.2, 1.1], cc=3))
s.append(P_("Hidden panels stay one tap away (the restore chip at the top of the rail) — nothing was taken from anyone who relied on it. Section 01 is now 'Market context', and on phones the book shows its top 6 ideas first, so market context sits 3,613 px down instead of 9,520 px.", S))

s.append(P_("4. Items left open in v4 — now closed", H1))
s.append(tbl([["Open item (v4)", "What was done", "Result"],
    ["Active Book ~9,400px on a phone", "Top 6 + 'Show all N ideas' on phones", "Fixed"],
    ["27% of sentences in monospace", "Remaining monospace lines are data ('entry $1,811.12'), which should align; the one real description rewritten as a sentence", "Fixed"],
    ["44% of text uppercase", "Short labels only (tabs, eyebrows); every sentence is sentence case", "Keep"],
    ["No per-tab usage data", "Page views now record ?tab and ?jtab — the next review can use real usage", "Fixed"],
    ["Heap capped at 280 MB (512 MB era)", "Raised to 1 GB on the 2 GB droplet — less garbage-collection CPU", "Fixed"],
    ["Data screens LCP 3-15s under scanner load", "Heap fix + earlier caching; a true fix needs a 2nd vCPU or moving scanners off the web process", "Open"]], [2.1, 3.5, 1.0], cc=2))
s.append(P_("5. Monitoring from here (SR 11-7 ongoing monitoring)", H1))
s.append(P_("Re-run monthly: research/surface-inventory.py (does every screen still earn its place), research/nav-architecture.py (0 dead / 0 stale / 0 unreachable), research/ui-scorecard.js on iPhone and iPad, and the page-view query by tab. A screen with no views for 30 days and no unique data is the next retirement candidate.", B))

SimpleDocTemplate(OUT, pagesize=letter, leftMargin=0.75 * inch, rightMargin=0.75 * inch, topMargin=0.7 * inch, bottomMargin=0.8 * inch,
                  title="Quant Edge Labs Report v5", author="Quant Edge Labs").build(s, onFirstPage=footer, onLaterPages=footer)
print(OUT)
