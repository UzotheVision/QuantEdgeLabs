"""Systems-engineering figures for report v4: the V-model mapped to this
platform, and the navigation architecture after consolidation."""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIG = os.path.join(ROOT, "research", "figs"); os.makedirs(FIG, exist_ok=True)
INK, MUTE, RULE, BLUE, GREEN, AMBER, RED = "#1b2330", "#5b6472", "#c9d1dc", "#2f7cf0", "#1e8f63", "#b8862b", "#c43d50"
plt.rcParams.update({"font.family": "DejaVu Sans"})

def box(ax, x, y, w, h, title, sub, color):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.08", fc="white", ec=color, lw=1.4))
    ax.text(x + w / 2, y + h * 0.66, title, ha="center", va="center", fontsize=8.2, fontweight="bold", color=INK)
    ax.text(x + w / 2, y + h * 0.3, sub, ha="center", va="center", fontsize=6.4, color=MUTE, wrap=True)

def arrow(ax, a, b, color=MUTE, style="-|>", ls="-"):
    ax.add_patch(FancyArrowPatch(a, b, arrowstyle=style, mutation_scale=9, color=color, lw=1, linestyle=ls))

# ── V-model ───────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(7.2, 4.0)); ax.set_xlim(-0.1, 10.1); ax.set_ylim(0, 6); ax.axis("off")
L = [("Operator needs", "readable on every device · ideas first\none look · honest data", 0.2, 4.7),
     ("System architecture", "one shell · one nav model\nroutes + redirects", 1.2, 3.5),
     ("Detailed design", "type & colour tokens · dock\ncards · stop floor", 2.2, 2.3),
     ("Implementation", "React pages · CSS tokens\ningestion gates", 2.3, 0.9)]
R = [("Acceptance", "UX 11-7 scorecard on iPhone / iPad\n+ operator review", 7.4, 4.7),
     ("System test", "nav-architecture: dead / stale /\nunreachable · live route walk", 6.4, 3.5),
     ("Integration test", "scorecard per screen · replay\nof outcomes on 5-min paths", 5.4, 2.3),
     ("Unit test", "mock tests A1-A18 · tsc baseline\ncontrast / CVD maths", 5.4, 0.9)]
for t, s, x, y in L: box(ax, x, y, 2.45, 0.95, t, s, BLUE)
for t, s, x, y in R: box(ax, x, y, 2.45, 0.95, t, s, GREEN)
for i in range(3):
    arrow(ax, (L[i][2] + 0.9, L[i][3]), (L[i + 1][2] + 0.9, L[i + 1][3] + 0.95), BLUE)
    arrow(ax, (R[i + 1][2] + 1.4, R[i + 1][3] + 0.95), (R[i][2] + 1.4, R[i][3]), GREEN)
arrow(ax, (L[3][2] + 2.45, L[3][3] + 0.3), (R[3][2], R[3][3] + 0.3), INK)
for i in range(4):
    arrow(ax, (L[i][2] + 2.45, L[i][3] + 0.62), (R[i][2], R[i][3] + 0.62), AMBER, "<|-|>", (0, (3, 3)))
ax.text(5, 5.85, "V-model: every left-side decision has a right-side test that verifies it", ha="center", fontsize=8.5, color=INK, fontweight="bold")
ax.text(0.2, 0.25, "Blue: specification (decomposition)   Green: verification (integration)   Amber dashed: traceability", fontsize=6.6, color=MUTE)
fig.savefig(os.path.join(FIG, "v4_vmodel.png"), dpi=220, bbox_inches="tight"); plt.close(fig)

# ── Navigation architecture ─────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(7.2, 4.6)); ax.set_xlim(0, 10); ax.set_ylim(0, 7.4); ax.axis("off")
box(ax, 3.6, 6.2, 2.8, 0.9, "Shared chrome", "top bar · desktop tabs · mobile dock · More", INK)
box(ax, 0.2, 4.4, 4.3, 1.3, "Terminal /t — 10 instruments", "NEXUS · CHART · FLOW · GEX · LEAPS\nCRYPTO · CATALYST · BOT · POSITIONS · JOURNAL", BLUE)
box(ax, 5.5, 4.4, 4.3, 1.3, "Pages (same chrome)", "SLATE (+ pre-market gappers) · RADAR · PERF\nAlerts · How to use · Settings", BLUE)
box(ax, 0.2, 2.4, 3.0, 1.2, "Research /r/:symbol", "chart · options · GEX · flow · analyze", GREEN)
box(ax, 3.5, 2.4, 3.0, 1.2, "Ticker workup overlay", "opens on selection only\nevidence · levels · contract", GREEN)
box(ax, 6.8, 2.4, 3.0, 1.2, "Trade audit /trade-ideas/:id", "now linked from the idea drawer", GREEN)
box(ax, 0.2, 0.4, 4.6, 1.3, "Public", "landing · pricing · about · academy · blog\npublic watchlist /w · legal (footer links)", MUTE)
box(ax, 5.2, 0.4, 4.6, 1.3, "Retired -> redirected (76 rules)", "/trade-desk -> /slate · /automations -> BOT\nlegacy aliases -> final destination, one hop", RED)
for a, b in [((5, 6.2), (2.4, 5.7)), ((5, 6.2), (7.6, 5.7)), ((2.4, 4.4), (1.7, 3.6)), ((2.4, 4.4), (5, 3.6)), ((7.6, 4.4), (8.3, 3.6)), ((1.7, 2.4), (2.5, 1.7))]:
    arrow(ax, a, b, MUTE)
fig.savefig(os.path.join(FIG, "v4_navarch.png"), dpi=220, bbox_inches="tight"); plt.close(fig)
print("ok")
