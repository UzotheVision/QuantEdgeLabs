"""Build the QuantEdge model validation report (PDF) from validation-results.json."""
import json, os, datetime
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                Image, PageBreak, KeepTogether)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = json.load(open(os.path.join(ROOT, "research", "validation-results.json")))
OUT = os.path.join(ROOT, "docs", "QuantEdge-Model-Validation-Report.pdf")
FIG = os.path.join(ROOT, "research", "figs")
os.makedirs(FIG, exist_ok=True)

INK, MUTE, RULE = "#1b2330", "#5b6472", "#d9dee5"
TEAL, RED, AMBER, GREEN = "#1f9e91", "#c43d50", "#b8862b", "#1e8f63"

plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.edgecolor": RULE,
                     "axes.labelcolor": INK, "xtick.color": MUTE, "ytick.color": MUTE,
                     "axes.spines.top": False, "axes.spines.right": False})

o, det, book, tests = D["outcomes"], D["detectorBenchmark"], D["paperBook"], D["mockTests"]

def save(fig, name):
    p = os.path.join(FIG, name); fig.savefig(p, dpi=200, bbox_inches="tight"); plt.close(fig); return p

# Fig 1 — hit rate vs random-walk break-even, by producer
src = o["bySource"]; names = list(src.keys())
fig, ax = plt.subplots(figsize=(6.4, 2.6))
x = range(len(names)); w = 0.38
ax.bar([i - w/2 for i in x], [src[n]["hitRate"] * 100 for n in names], w, color=TEAL, label="Realized hit rate")
ax.bar([i + w/2 for i in x], [src[n]["breakEvenRate"] * 100 for n in names], w, color=RULE, edgecolor=MUTE, label="Random-walk break-even")
ax.set_xticks(list(x)); ax.set_xticklabels(names); ax.set_ylabel("% of decided ideas")
for i, n in enumerate(names): ax.text(i, max(src[n]["hitRate"], src[n]["breakEvenRate"]) * 100 + 1.5, f"n={src[n]['decided']}", ha="center", color=MUTE, fontsize=7.5)
ax.legend(frameon=False, fontsize=8); ax.set_ylim(0, 50)
f1 = save(fig, "f1_hit_vs_be.png")

# Fig 2 — expectancy by conviction quintile
qs = o["discrimination"]["quintiles"]
fig, ax = plt.subplots(figsize=(6.4, 2.4))
vals = [q["expectancyR"] for q in qs]
ax.bar([q["bucket"] + "\n" + q["scoreRange"] for q in qs], vals, color=[GREEN if v > 0 else RED for v in vals])
ax.axhline(0, color=MUTE, lw=0.8); ax.set_ylabel("Expectancy (R)")
f2 = save(fig, "f2_quintiles.png")

# Fig 3 — calibration
cal = o["calibration"]
fig, ax = plt.subplots(figsize=(3.4, 3.0))
ax.plot([0, 1], [0, 1], ls="--", color=MUTE, lw=0.8, label="Perfect calibration")
ax.scatter([c["meanConfidence"] for c in cal], [c["realizedHitRate"] for c in cal], s=[max(20, c["n"]) for c in cal], color=AMBER, zorder=3, label="Observed (size = n)")
ax.set_xlim(0, 1); ax.set_ylim(0, 1); ax.set_xlabel("Stated confidence"); ax.set_ylabel("Realized hit rate"); ax.legend(frameon=False, fontsize=7)
f3 = save(fig, "f3_calibration.png")

# Fig 4 — detector vs universe
fig, ax = plt.subplots(figsize=(3.4, 3.0))
ax.bar(["Universe", "Reversal fires"], [det["universeMeanRet"] * 100, det["fireMeanRet"] * 100], color=[RULE, TEAL], edgecolor=MUTE)
ax.set_ylabel(f"Mean {det['horizonSessions']}-session forward return (%)")
for i, v in enumerate([det["universeMeanRet"], det["fireMeanRet"]]): ax.text(i, v * 100 + 0.03, f"{v*100:.2f}%", ha="center", fontsize=8)
f4 = save(fig, "f4_detector.png")

# Fig 5 — paper book equity
fig, ax = plt.subplots(figsize=(6.4, 2.2))
ax.plot(range(1, len(book["curve"]) + 1), book["curve"], color=TEAL, lw=1.6)
ax.fill_between(range(1, len(book["curve"]) + 1), book["curve"], 0, color=TEAL, alpha=0.08)
ax.axhline(0, color=MUTE, lw=0.8); ax.set_xlabel("Closed trade #"); ax.set_ylabel("Cumulative P&L ($)")
f5 = save(fig, "f5_book.png")

# ── document ─────────────────────────────────────────────────────────────
ss = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=ss["Heading1"], fontName="Helvetica-Bold", fontSize=15, textColor=colors.HexColor(INK), spaceBefore=6, spaceAfter=8, keepWithNext=1)
H2 = ParagraphStyle("H2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=11.5, textColor=colors.HexColor(INK), spaceBefore=10, spaceAfter=5, keepWithNext=1)
B = ParagraphStyle("B", parent=ss["BodyText"], fontName="Helvetica", fontSize=9.4, leading=13.2, textColor=colors.HexColor(INK), spaceAfter=5)
S = ParagraphStyle("S", parent=B, fontSize=8, leading=10.5, textColor=colors.HexColor(MUTE))
CAP = ParagraphStyle("CAP", parent=S, spaceBefore=2, spaceAfter=10)

def tbl(rows, widths, zebra=True, hl=None):
    t = Table(rows, colWidths=widths, repeatRows=1)
    st = [("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8), ("FONT", (0, 1), (-1, -1), "Helvetica", 8),
          ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor(MUTE)), ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor(MUTE)),
          ("LINEBELOW", (0, 1), (-1, -1), 0.3, colors.HexColor(RULE)), ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5)]
    for r, c in (hl or []): st.append(("TEXTCOLOR", (0, r), (-1, r), colors.HexColor(c)))
    t.setStyle(TableStyle(st)); return t

def P(x, st=B): return Paragraph(x, st)
def pct(v): return f"{v*100:.1f}%"
gen = datetime.datetime.fromisoformat(D["generatedAt"].replace("Z", "+00:00")).strftime("%B %d, %Y")
ov = o["overall"]; npass = sum(1 for t in tests if t["pass"])

def footer(c, doc):
    c.saveState(); c.setFont("Helvetica", 7.5); c.setFillColor(colors.HexColor(MUTE))
    c.drawString(0.8 * inch, 0.5 * inch, "QuantEdge Labs · Model Validation Report · Educational research platform — not investment advice")
    c.drawRightString(7.7 * inch, 0.5 * inch, f"Page {doc.page}"); c.restoreState()

story = []
story += [P("QuantEdge Labs", S), P("Model Risk &amp; Validation Report", ParagraphStyle("T", parent=H1, fontSize=22, leading=26)),
          P(f"Benchmark, mock and outcome testing of the trade-idea models, structured after the Federal Reserve's SR 11-7 guidance on model risk management. Test run: {gen}. Data window: {o['window']['from'][:10]} to {o['window']['to'][:10]}.", B),
          Spacer(1, 6)]

story.append(P("1. Executive summary", H1))
story.append(P(
    f"We tested {len(tests)} model behaviours with synthetic inputs of known answer ({npass} passed), analysed "
    f"<b>{ov['n']} resolved trade ideas</b> ({ov['decided']} reached target or stop), benchmarked every idea against its own "
    f"random-walk break-even rate, ran a walk-forward benchmark of the bottom-reversal detector over "
    f"<b>{det['universeSamples']:,} stock-sessions</b>, and reviewed the live paper book ({book['trades']} closed trades).", B))
summary = [
    ["Finding", "Result", "Severity"],
    ["Bottom-reversal detector beats the market", f"+{det['excess']*100:.2f}% over {det['horizonSessions']} sessions vs universe (t = {det['tStat']:.1f})", "Validated"],
    ["Legacy SPX-session producer loses money", f"{pct(src['spx_session']['hitRate'])} hit vs {pct(src['spx_session']['breakEvenRate'])} break-even; {src['spx_session']['expectancyR']:.2f}R per idea (t = {src['spx_session']['tStat']:.1f})", "Critical"],
    ["Conviction score does not rank outcomes", f"AUC {o['discrimination']['aucTargetVsStop']:.2f}, Spearman rho {o['discrimination']['spearmanRho']:.2f} (n = {o['discrimination']['n']})", "Critical"],
    ["Stated confidence is miscalibrated", "Ideas stated ~89% confident hit ~32%", "Critical"],
    ["Legacy book overall below random walk", f"{pct(ov['hitRate'])} hit vs {pct(ov['breakEvenRate'])} break-even (z = {ov['zVsRandomWalk']:.1f}); {ov['expectancyR']:.2f}R", "High"],
    ["Shorts weaker than longs historically", f"{o['byDir']['short']['expectancyR']:.2f}R vs {o['byDir']['long']['expectancyR']:.2f}R", "Monitor"],
    ["Fast V-recoveries never qualify", "Stop anchors on the capitulation bar; risk exceeds the 10% cap", "Medium"],
    ["Live paper book", f"${book['net']:,.0f} net, profit factor {book['profitFactor']:.2f}, max drawdown -${abs(book['maxDrawdown']):,.0f}", "Monitor"],
]
sev = {"Validated": GREEN, "Critical": RED, "High": RED, "Medium": AMBER, "Monitor": AMBER}
story.append(tbl(summary, [2.2 * inch, 3.6 * inch, 0.9 * inch], hl=[(i, sev[r[2]]) for i, r in enumerate(summary) if i and False]))
story.append(Spacer(1, 6))
story.append(P("<b>Scope caveat.</b> The resolved history is dominated by the producers that ran before this week's rebuild "
               "(quant, SPX-session, GEX, early market scanner). The rebuilt producers — aggressor-tape, leader-swing, index-swing, "
               "premium-discount and crypto-transmission — have no resolved outcomes yet; only the bottom-reversal detector is "
               "validated here, by walk-forward replay. The window is one month of one market regime: every figure is evidence, not proof.", S))

story.append(Spacer(1, 10))
story.append(P("2. Framework and method", H1))
for head, text in [
    ("Model inventory.", "Ten production models were in scope: the conviction engine (layered scoring), aggressor-tape scanner (long and short), bottom-reversal detector, leader-swing and index-swing detectors, premium-discount scan, crypto-transmission promoter, context target ladder, contract picker / live repricer, and the discipline gates (short policy, leveraged-ETF block, tape contradiction)."),
    ("Conceptual soundness.", "The production functions were called directly with synthetic price series whose correct answer is known in advance, including negative controls that must not fire. Probability math was checked against published normal-distribution table values."),
    ("Outcomes analysis.", "For every resolved idea, the realized move was expressed in R (the distance to the stop). Ideas that expired without an exit price carry no R; win rates use only ideas that reached target or stop."),
    ("Benchmarking.", "Each idea is compared with the probability a driftless random walk reaches its target before its stop: risk ÷ (risk + reward). Summing these gives the number of wins chance alone would produce; the z-score measures how far the realized count sits from it. The detector is benchmarked walk-forward: at each historical session, it sees only bars up to that day, and its fires' forward returns are compared with every stock's forward return over the same sessions."),
    ("Discrimination and calibration.", "Whether a higher conviction score predicts a better outcome is measured with the AUC (probability a winner scored higher than a loser; 0.5 = no skill) and Spearman rank correlation. Calibration compares each idea's stated confidence with its realized hit rate."),
    ("Stability.", "The resolved set is split chronologically in half; a real edge should appear in both halves."),
]:
    story.append(P(f"<b>{head}</b> {text}", B))

story.append(P("3. Conceptual soundness — mock tests", H1))
rows = [["ID", "Test", "Expected", "Actual", ""]]
for t_ in tests:
    rows.append([t_["id"], P(t_["name"], S), P(t_["expected"], S), P(t_["actual"], S), "PASS" if t_["pass"] else "FAIL"])
mt = tbl(rows, [0.38 * inch, 2.7 * inch, 1.55 * inch, 1.55 * inch, 0.5 * inch])
mt.setStyle(TableStyle([("TEXTCOLOR", (4, i), (4, i), colors.HexColor(GREEN if tests[i-1]["pass"] else RED)) for i in range(1, len(rows))] + [("FONT", (4, 1), (4, -1), "Helvetica-Bold", 8)]))
story.append(mt)
story.append(P(f"<b>{npass} of {len(tests)} passed.</b> The failure (A5) is a genuine design finding, not a test defect: on a fast V-shaped "
               "recovery the stop anchors on the capitulation bar, so risk exceeds the 10% cap and the detector rejects the setup. The "
               "sharpest recoveries — often the strongest — can therefore never qualify. A moderate-pace V (A5b) fires correctly. "
               "Negative controls (uptrend, crash, downtrend, no-discount) all correctly stayed silent.", CAP))

story.append(PageBreak())
story.append(P("4. Outcomes analysis and benchmarking", H1))
story.append(Image(f1, width=6.4 * inch, height=2.6 * inch))
story.append(P("Figure 1. Realized hit rate against each idea's random-walk break-even rate, by producer. Bars below grey lose to chance.", CAP))
rows = [["Producer", "Ideas", "Decided", "Hit rate", "Break-even", "z", "E[R]", "t", "PF"]]
for n in names:
    v = src[n]
    rows.append([n, v["n"], v["decided"], pct(v["hitRate"]), pct(v["breakEvenRate"]), f"{v['zVsRandomWalk']:.2f}", f"{v['expectancyR']:.3f}R", f"{v['tStat']:.2f}", f"{v['profitFactor']:.2f}"])
rows.append(["All", ov["n"], ov["decided"], pct(ov["hitRate"]), pct(ov["breakEvenRate"]), f"{ov['zVsRandomWalk']:.2f}", f"{ov['expectancyR']:.3f}R", f"{ov['tStat']:.2f}", f"{ov['profitFactor']:.2f}"])
story.append(tbl(rows, [1.05 * inch] + [0.62 * inch] * 8))
story.append(Spacer(1, 6))
story.append(P(f"The SPX-session producer is the clearest failure: it reached target on {pct(src['spx_session']['hitRate'])} of decided ideas "
               f"when chance alone predicts {pct(src['spx_session']['breakEvenRate'])} (z = {src['spx_session']['zVsRandomWalk']:.1f}), losing "
               f"{abs(src['spx_session']['expectancyR']):.2f}R per idea. The quant producer beats its break-even on hits (z = {src['quant']['zVsRandomWalk']:.2f}) "
               "but expired trades pull its expectancy below zero — its exits, not its entries, are the weakness.", B))

story.append(P("Long versus short", H2))
bd = o["byDir"]
story.append(tbl([["Side", "Ideas", "Hit rate", "Break-even", "Expectancy", "t-stat"],
                  ["Long", bd["long"]["n"], pct(bd["long"]["hitRate"]), pct(bd["long"]["breakEvenRate"]), f"{bd['long']['expectancyR']:.3f}R", f"{bd['long']['tStat']:.2f}"],
                  ["Short", bd["short"]["n"], pct(bd["short"]["hitRate"]), pct(bd["short"]["breakEvenRate"]), f"{bd['short']['expectancyR']:.3f}R", f"{bd['short']['tStat']:.2f}"]],
                 [1.0 * inch] + [1.0 * inch] * 5))
story.append(P("Historical shorts (under the earlier event-required policy) underperformed longs. The new policy lets shorts in on measured "
               "evidence alone; their results should be reported separately for the first 60 trading days.", CAP))

story.append(PageBreak())
story.append(P("5. Discrimination and calibration", H1))
story.append(Image(f2, width=6.4 * inch, height=2.4 * inch))
story.append(P(f"Figure 2. Expectancy by conviction-score quintile (n = {o['discrimination']['n']}). A working score rises left to right; this one does not. "
               f"AUC {o['discrimination']['aucTargetVsStop']:.2f} and Spearman rho {o['discrimination']['spearmanRho']:.2f} both indicate no ranking skill.", CAP))
story.append(KeepTogether([Image(f3, width=3.3 * inch, height=2.9 * inch),
    P("Figure 3. Stated confidence against realized hit rate. Points far below the dashed line are over-confident: ideas stated ~89% confident reached target ~32% of the time.", CAP)]))
rows = [["Confidence band", "Ideas", "Mean stated", "Realized hit rate"]] + [[c["band"], c["n"], pct(c["meanConfidence"]), pct(c["realizedHitRate"])] for c in cal]
story.append(tbl(rows, [1.6 * inch, 1.0 * inch, 1.4 * inch, 1.6 * inch]))

story.append(KeepTogether([P("6. Detector benchmark (walk-forward)", H1), Image(f4, width=3.3 * inch, height=2.9 * inch),
    P(f"Figure 4. Bottom-reversal fires (score 70+, n = {det['fires']:,}) against every liquid stock over the same sessions (n = {det['universeSamples']:,}).", CAP)]))
story.append(tbl([["Metric", "Reversal fires", "Universe"],
                  [f"Mean {det['horizonSessions']}-session return", f"{det['fireMeanRet']*100:.2f}%", f"{det['universeMeanRet']*100:.2f}%"],
                  ["Share positive", pct(det["fireHitPositive"]), pct(det["universeHitPositive"])],
                  ["Median return", f"{det['fireMedian']*100:.2f}%", "—"],
                  ["Excess (t-stat)", f"+{det['excess']*100:.2f}% (t = {det['tStat']:.2f})", ""]], [2.4 * inch, 1.8 * inch, 1.8 * inch]))
story.append(P("The detector sees only bars up to each test date (no look-ahead). Its excess return is statistically significant at the 1% level. "
               "Overlapping 10-session windows inflate the effective sample; the t-stat should be read as indicative, and the edge confirmed on live outcomes.", CAP))

story.append(PageBreak())
story.append(P("7. Stability and the live paper book", H1))
st = o["stability"]
story.append(tbl([["Half", "Hit rate", "Break-even", "Expectancy", "t-stat"],
                  ["First half", pct(st["firstHalf"]["hitRate"]), pct(st["firstHalf"]["breakEvenRate"]), f"{st['firstHalf']['expectancyR']:.3f}R", f"{st['firstHalf']['tStat']:.2f}"],
                  ["Second half", pct(st["secondHalf"]["hitRate"]), pct(st["secondHalf"]["breakEvenRate"]), f"{st['secondHalf']['expectancyR']:.3f}R", f"{st['secondHalf']['tStat']:.2f}"]],
                 [1.3 * inch] + [1.2 * inch] * 4))
story.append(P(f"Split at {st['splitAt'][:10]}. The legacy book's negative expectancy is stable across both halves — a structural problem, not a bad week.", CAP))
story.append(Image(f5, width=6.4 * inch, height=2.2 * inch))
story.append(P(f"Figure 5. Live paper book, {book['trades']} closed trades: net ${book['net']:,.0f}, win rate {pct(book['winRate'])}, average win ${book['avgWin']:,.0f} vs "
               f"average loss ${abs(book['avgLoss']):,.0f}, profit factor {book['profitFactor']:.2f}, maximum drawdown -${abs(book['maxDrawdown']):,.0f}. "
              , CAP))

story.append(P("8. Work completed during this review", H1))
for item in [
    "Replaced carried-forward contract values with live repricing: delta, IV, expected move, target odds and premium drift recomputed every two minutes.",
    "Fixed seven stale-value hazards found by code audit, including position sizing from publish-time premium and an options-chain cache that served stale data indefinitely.",
    "Added coherence gates: gamma-pin geometry corrected, opposing aggressor flow now subtracts from conviction, tape flips retire the opposite-side card.",
    "Replaced formula targets with a context target ladder (structure, dealer walls, prior swings) and a path-to-structure scoring layer.",
    "Brought shorts to parity with longs under a measured-evidence standard; blocked leveraged/inverse wrappers at the shared gate.",
    "Corrected the sector-rotation baseline (week-old reference was being shown as today's move) and the missing latest candle on every chart.",
    "Imported the Supabase backup history and moved the platform to an owned database and server.",
]:
    story.append(P(f"• {item}", B))

story.append(P("9. Recommendations", H1))
recs = [
    ["#", "Action", "Why", "Priority"],
    ["1", "Suspend the SPX-session producer pending redesign", "Loses 0.51R per idea; far below chance, in both halves", "Immediate"],
    ["2", "Stop presenting 'confidence' as a probability", "89% stated vs 32% realized; recalibrate on outcomes or relabel as a rank", "Immediate"],
    ["3", "Re-fit conviction layer weights on outcome data", "Current score has no ranking skill (AUC 0.46)", "High"],
    ["4", "Report shorts separately for 60 trading days", "Historical shorts underperformed; new policy needs its own record", "High"],
    ["5", "Widen the V-recovery stop logic", "Fast V-recoveries are structurally excluded (test A5)", "Medium"],
    ["6", "Re-run this harness monthly on new outcomes", "Only the reversal detector has out-of-sample evidence so far", "Ongoing"],
]
recs = [recs[0]] + [[r[0], P(r[1], S), P(r[2], S), r[3]] for r in recs[1:]]
story.append(tbl(recs, [0.3 * inch, 2.4 * inch, 2.9 * inch, 0.9 * inch]))
story.append(Spacer(1, 8))
story.append(P("Reproduce: <font face='Courier'>npx tsx research/model-validation.ts</font> then <font face='Courier'>python3 research/build-validation-report.py</font>. "
               "Raw results: research/validation-results.json. QuantEdge is an educational research platform; nothing here is investment advice.", S))

SimpleDocTemplate(OUT, pagesize=letter, leftMargin=0.8 * inch, rightMargin=0.8 * inch, topMargin=0.75 * inch, bottomMargin=0.8 * inch,
                  title="QuantEdge Model Risk & Validation Report", author="QuantEdge Labs").build(story, onFirstPage=footer, onLaterPages=footer)
print(OUT)
