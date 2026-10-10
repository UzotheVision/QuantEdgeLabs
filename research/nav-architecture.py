"""
NAVIGATION ARCHITECTURE TEST — does every door lead to a room, and does every
room have a door?

Builds the platform's navigation graph from source:
  nodes  = routes in App.tsx (+ terminal tabs /t?tab=x)
  edges  = every link target in the client (href, Link, setLocation, navigate,
           window.location), plus legacy redirects
and runs the system-level tests a V-model would put against the architecture:

  N1 Dead links        a link target that resolves to no route and no redirect
  N2 Redirect links    live code still linking to a retired URL (extra hop)
  N3 Orphan pages      page files in pages/ that no route renders
  N4 Unreachable routes a route no navigation surface or page links to
  N5 Nav coverage      every primary surface present in the shared nav model
  N6 Redundancy        two routes/tabs serving the same job (manual taxonomy)

Run: python3 research/nav-architecture.py → research/nav-architecture.json
"""
import json, os, re, glob, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "client", "src")
rd = lambda p: open(p, encoding="utf-8", errors="ignore").read()

app = rd(os.path.join(SRC, "App.tsx"))
routes = re.findall(r'<Route path="([^"]+)"\s+component=\{(?:withBetaProtection\(|withAdminProtection\()?(\w+)', app)
route_paths = [p for p, _ in routes]
comp_of = dict(routes)

# lazy imports: component name -> file
imports = dict(re.findall(r'const (\w+)\s*=\s*lazyWithRetry\(\(\) => import\("([^"]+)"\)', app))
imports.update(dict(re.findall(r"const (\w+) = lazy\(\(\) => import\('([^']+)'\)", app)))
imports.update({m[0]: m[1] for m in re.findall(r'import (\w+) from "(@/pages/[^"]+)"', app)})

red_src = rd(os.path.join(SRC, "lib", "legacy-redirects.ts"))
redirects = re.findall(r'\["(/[^"]*)",\s*"([^"]+)"\]', red_src)
redirect_param = re.findall(r'\["(/[^"]*:[^"]*)",\s*\(', red_src)
redirect_paths = [a for a, _ in redirects] + redirect_param

nav = rd(os.path.join(SRC, "components", "shell", "nav-model.tsx"))
tabs = re.findall(r"\{ id: '(\w+)',\s+label: '([A-Z]+)' \}", nav)
nav_pages = re.findall(r"href: '(/[^']+)'", nav)

def to_regex(p):
    return re.compile("^" + re.sub(r":\w+", r"[^/]+", p.rstrip("/") or "/") + "/?$")
R_ROUTE = [(p, to_regex(p)) for p in route_paths]
R_REDIR = [(p, to_regex(p)) for p in redirect_paths]
TAB_IDS = {t for t, _ in tabs}

def resolve(target):
    path, _, q = target.partition("?")
    path = path.split("#")[0].rstrip("/") or "/"
    if path == "/t":
        m = re.search(r"tab=(\w+)", q)
        if m and m.group(1) not in TAB_IDS and m.group(1) not in ("prism", "heatmap"):
            return "dead-tab"
        return "route"
    for p, rx in R_ROUTE:
        if rx.match(path): return "route"
    for p, rx in R_REDIR:
        if rx.match(path): return "redirect"
    return "dead"

LINK_PATTERNS = [
    r'href="(/[^"#]*)"', r"href='(/[^'#]*)'", r'href=\{"(/[^"#]*)"\}',
    r"setLocation\(\s*'(/[^']*)'", r'setLocation\(\s*"(/[^"]*)"', r"setLocation\(\s*`(/[^`$]*)",
    r"navigate\(\s*'(/[^']*)'", r'navigate\(\s*"(/[^"]*)"',
    r"window\.location\.href\s*=\s*'(/[^']*)'", r'window\.location\.href\s*=\s*"(/[^"]*)"',
    r'<Redirect to="(/[^"]*)"', r"path: '(/[^']+)'", r"href: '(/[^']+)'", r'href: "(/[^"]+)"',
    r"\['(/[a-z][^']*)',\s*'[A-Z]",
]
TEMPLATE = re.compile(r"(?:href=\{|setLocation\()`(/[^`]*)`")
files = [f for f in glob.glob(os.path.join(SRC, "**", "*.tsx"), recursive=True) + glob.glob(os.path.join(SRC, "**", "*.ts"), recursive=True)
         if "legacy-redirects" not in f]
links = collections.defaultdict(list)  # target -> [file]
for f in files:
    s = rd(f)
    for pat in LINK_PATTERNS:
        for t in re.findall(pat, s):
            t = t.strip()
            if not t or t.startswith("//") or t.startswith("/api") or t.startswith("/assets") or re.search(r"\.(png|svg|jpg|json|webmanifest|ico)$", t): continue
            links[t].append(os.path.relpath(f, ROOT))
    for t in TEMPLATE.findall(s):
        t = re.sub(r"\$\{[^}]*\}", "x", t)
        if t.startswith("/api"): continue
        links[t].append(os.path.relpath(f, ROOT))

dead, via_redirect, ok = {}, {}, {}
for t, fs in links.items():
    r = resolve(t)
    (dead if r in ("dead", "dead-tab") else via_redirect if r == "redirect" else ok)[t] = sorted(set(fs))

# N3 orphan page files
routed_files = set()
for comp in comp_of.values():
    f = imports.get(comp)
    if f: routed_files.add(f.replace("@/pages/", "").split("/")[-1])
shell_used = set()
for f in glob.glob(os.path.join(SRC, "pages", "shells", "*.tsx")) + glob.glob(os.path.join(SRC, "components", "**", "*.tsx"), recursive=True):
    for m in re.findall(r"import\(['\"]@/pages/([\w/-]+)['\"]\)", rd(f)) + re.findall(r"from ['\"]@/pages/([\w/-]+)['\"]", rd(f)):
        shell_used.add(m.split("/")[-1])
page_files = [os.path.basename(p)[:-4] for p in glob.glob(os.path.join(SRC, "pages", "*.tsx"))]
orphans = sorted(p for p in page_files if p not in routed_files and p not in shell_used and p not in ("not-found",))

# N4 unreachable routes: route paths nobody links to (param routes matched loosely)
linked_paths = set(t.split("?")[0].rstrip("/") or "/" for t in links)
unreachable = []
for p in route_paths:
    rx = to_regex(p)
    if p in ("/", "/t"): continue
    if p.startswith("/admin") or p in ("/reset-password", "/invite", "/forgot-password"): continue
    if not any(rx.match(l) for l in linked_paths): unreachable.append(p)

# N6 redundancy — jobs served by more than one surface (taxonomy by purpose)
JOBS = {
    "Rank today's trade ideas": ["/t (NEXUS board)", "/slate", "/trade-desk"],
    "Scan for chart setups": ["/radar", "/t (NEXUS pattern radar)", "/slate"],
    "Measure track record": ["/performance", "/t?tab=journal", "/trade-ideas/:id/audit"],
    "Guide / how to use": ["/how-to", "terminal Guide drawer", "/academy"],
    "Alerts": ["/alerts", "terminal Alerts drawer"],
    "Preferences": ["/settings", "terminal Preferences drawer"],
    "Per-ticker research": ["/r/:symbol", "ticker workup overlay"],
}
res = {
    "routes": len(route_paths), "redirects": len(redirect_paths), "tabs": len(tabs), "linkTargets": len(links),
    "N1_dead": dead, "N2_viaRedirect": via_redirect, "N3_orphanPageFiles": orphans, "N4_unreachableRoutes": unreachable,
    "N5_navModel": {"tabs": [l for _, l in tabs], "pages": nav_pages}, "N6_redundantJobs": JOBS,
}
json.dump(res, open(os.path.join(ROOT, "research", "nav-architecture.json"), "w"), indent=2)
print(f"routes {len(route_paths)}  redirects {len(redirect_paths)}  link targets {len(links)}")
print("N1 DEAD:", json.dumps(dead, indent=1)[:2500])
print("N2 via redirect:", json.dumps({k: v[:3] for k, v in via_redirect.items()}, indent=1)[:2500])
print("N3 orphan page files:", orphans)
print("N4 unreachable routes:", unreachable)
