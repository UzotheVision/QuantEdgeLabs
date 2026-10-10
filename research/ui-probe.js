/**
 * UI PROBE — measurement instrument for the UI/UX validation (the visual
 * counterpart of model-validation.ts). Runs inside a loaded page and returns
 * one JSON object. Benchmarks it scores against:
 *   - Core Web Vitals "good": LCP ≤ 2.5 s, CLS ≤ 0.1 (web.dev thresholds)
 *   - WCAG 2.2 AA: text contrast 4.5:1 (3:1 large text), target size ≥ 24px (2.5.8),
 *     names on controls (4.1.2), labels on inputs (1.3.1), zoom not disabled (1.4.4)
 *   - Apple HIG / Material: touch targets ≥ 44pt / 48dp on phones
 * Usage (browser console or automation): await window.__qaProbe()
 */
window.__qaProbe = async function () {
  const vw = innerWidth, vh = innerHeight, mobile = vw < 768;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };

  // ── performance ────────────────────────────────────────────────────────
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const lcp = await new Promise((res) => { let v = null; try { new PerformanceObserver((l) => { const e = l.getEntries(); v = e[e.length - 1]?.startTime ?? v; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {} setTimeout(() => res(v), 300); });
  const cls = await new Promise((res) => { let v = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) v += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {} setTimeout(() => res(v), 300); });
  const resEntries = performance.getEntriesByType('resource');
  const bytes = (f) => resEntries.filter(f).reduce((s, e) => s + (e.transferSize || e.encodedBodySize || 0), 0);
  const perf = {
    ttfbMs: Math.round(nav.responseStart || 0), domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd || 0), loadMs: Math.round(nav.loadEventEnd || 0),
    lcpMs: lcp != null ? Math.round(lcp) : null, cls: +cls.toFixed(3), requests: resEntries.length,
    jsKB: Math.round(bytes((e) => /\.m?js(\?|$)/.test(e.name)) / 1024), cssKB: Math.round(bytes((e) => /\.css(\?|$)/.test(e.name)) / 1024),
    fontKB: Math.round(bytes((e) => /\.(woff2?|ttf|otf)(\?|$)/.test(e.name) || e.name.includes('fonts.gstatic')) / 1024),
    imgKB: Math.round(bytes((e) => e.initiatorType === 'img' || /\.(png|jpe?g|webp|avif|gif|svg)(\?|$)/.test(e.name)) / 1024),
    totalKB: Math.round(bytes(() => true) / 1024), domNodes: document.getElementsByTagName('*').length,
  };

  // ── layout ─────────────────────────────────────────────────────────────
  const docW = document.documentElement.scrollWidth;
  const offenders = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && r.width < vw * 3) {
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { clipped = true; break; } p = p.parentElement; }
      if (!clipped) offenders.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), right: Math.round(r.right), text: (el.textContent || '').trim().slice(0, 40) });
    }
  }
  const layout = { viewport: `${vw}x${vh}`, horizontalOverflowPx: Math.max(0, docW - vw), overflowingElements: offenders.length, overflowSamples: offenders.slice(0, 6) };

  // ── contrast (WCAG relative luminance) ─────────────────────────────────
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const stack = []; let e = el;
    while (e) { const s = getComputedStyle(e); if (/url\(|gradient/.test(s.backgroundImage)) return null; /* image/gradient ground: not computable, skipped */ const c = parse(s.backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } e = e.parentElement; }
    let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base); return base;
  };
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode; if (!t.textContent.trim()) continue; const el = t.parentElement; if (!el || seen.has(el) || !vis(el)) continue; seen.add(el);
    const s = getComputedStyle(el); const fg = parse(s.color); const bg = bgOf(el); if (!fg || !bg) continue;
    const fgB = blend({ ...fg, a: fg.a * (+s.opacity || 1) }, bg);
    const L1 = lum(fgB), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(s.fontSize), bold = +s.fontWeight >= 700; const large = px >= 24 || (bold && px >= 18.66);
    texts.push({ ratio, need: large ? 3 : 4.5, px, text: t.textContent.trim().slice(0, 40), color: s.color });
  }
  const fails = texts.filter((x) => x.ratio < x.need).sort((a, b) => a.ratio - b.ratio);
  const contrast = { textElements: texts.length, failing: fails.length, failShare: texts.length ? +(fails.length / texts.length).toFixed(3) : 0, worst: fails.slice(0, 8).map((f) => ({ ratio: +f.ratio.toFixed(2), px: f.px, text: f.text })), under12px: texts.filter((x) => x.px < 12).length };

  // ── targets & names ────────────────────────────────────────────────────
  const ctrls = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=link],[tabindex]:not([tabindex="-1"])')].filter(vis);
  const small24 = [], small44 = [], unnamed = [];
  for (const c of ctrls) {
    const r = c.getBoundingClientRect(); const inline = c.tagName === 'A' && getComputedStyle(c).display === 'inline' && c.closest('p,li');
    if (!inline) { if (r.width < 24 || r.height < 24) small24.push(c); if (r.width < 44 || r.height < 44) small44.push(c); }
    const name = (c.getAttribute('aria-label') || c.getAttribute('title') || c.textContent || c.getAttribute('alt') || c.querySelector('img[alt]')?.getAttribute('alt') || c.getAttribute('placeholder') || '').trim();
    const labelled = c.getAttribute('aria-labelledby') || (c.id && document.querySelector(`label[for="${CSS.escape(c.id)}"]`)) || c.closest('label');
    if (!name && !labelled) unnamed.push(c);
  }
  const desc = (c) => ({ tag: c.tagName.toLowerCase(), cls: String(c.className).slice(0, 50), text: (c.textContent || c.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height) });
  const inputsNoLabel = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea')].filter(vis).filter((i) => !(i.getAttribute('aria-label') || i.getAttribute('aria-labelledby') || (i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`)) || i.closest('label')));
  const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(vis).map((h) => +h.tagName[1]);
  let skips = 0; for (let i = 1; i < heads.length; i++) if (heads[i] - heads[i - 1] > 1) skips++;
  const vp = document.querySelector('meta[name=viewport]')?.content || '';
  const a11y = {
    controls: ctrls.length, below24px: small24.length, below44px: small44.length, below44Samples: small44.slice(0, 6).map(desc),
    unnamedControls: unnamed.length, unnamedSamples: unnamed.slice(0, 5).map(desc), inputsWithoutLabel: inputsNoLabel.length,
    imagesWithoutAlt: [...document.images].filter((i) => vis(i) && !i.hasAttribute('alt')).length,
    h1Count: heads.filter((h) => h === 1).length, headingSkips: skips, htmlLang: document.documentElement.lang || null,
    zoomDisabled: /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/.test(vp),
  };

  // ── design-token entropy (how many distinct values the page really uses) ──
  const sets = { color: new Set(), bg: new Set(), fontSize: new Set(), fontFamily: new Set(), radius: new Set(), shadow: new Set() };
  for (const el of document.body.querySelectorAll('*')) {
    if (!vis(el)) continue; const s = getComputedStyle(el);
    if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { sets.color.add(s.color); sets.fontSize.add(s.fontSize); sets.fontFamily.add(s.fontFamily.split(',')[0].trim()); }
    const bg = parse(s.backgroundColor); if (bg && bg.a > 0) sets.bg.add(s.backgroundColor);
    if (s.borderRadius !== '0px') sets.radius.add(s.borderRadius); if (s.boxShadow !== 'none') sets.shadow.add(s.boxShadow);
  }
  const tokens = Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.size]));
  tokens.fontSizes = [...sets.fontSize].map(parseFloat).sort((a, b) => a - b);
  tokens.fontFamilies = [...sets.fontFamily];

  return { url: location.pathname, title: document.title, perf, layout, contrast, a11y, tokens };
};
