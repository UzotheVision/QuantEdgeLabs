/**
 * UX 11-7 SCORECARD — the SR 11-7 discipline applied to the interface.
 *
 * SR 11-7 asks of a model: is it conceptually sound, do its outcomes hold up,
 * how does it compare to a benchmark, is it monitored, and are its limits
 * disclosed? This asks the same of a SCREEN, with thresholds taken from the
 * recognised standards rather than taste:
 *
 *   U1 Fit          layout width == device width (no zoom-out)       ISO 9241-110 suitability · HIG
 *   U2 Reachable    primary navigation visible on this device         ISO 9241-110 controllability
 *   U3 Legible      >= 95% of text >= 11 px (phones/touch)            ISO 9241-303 · HIG
 *   U4 Contrast     >= 98% of text meets WCAG AA (4.5:1 / 3:1 large)  WCAG 2.2 1.4.3
 *   U5 Targets      >= 90% of controls >= 24 px (WCAG) on touch       WCAG 2.2 2.5.8 · HIG 44pt
 *   U6 Named        every control has an accessible name              WCAG 2.2 4.1.2
 *   U7 Stable       CLS <= 0.10                                       Core Web Vitals
 *   U8 Fast         LCP <= 2.5 s                                      Core Web Vitals
 *   U9 One system   brand mark present; <= 3 font families            ISO 9241-110 conformity · Nielsen #4
 *   U10 Honest      no "undefined"/"NaN"/"[object Object]" on screen  ISO 9241-110 self-descriptiveness · Nielsen #1
 *   U11 Titled      document title set and not "undefined"            WCAG 2.2 2.4.2
 *
 * Usage: await window.__uxScore()  → { path, device, pass, total, criteria[] }
 */
window.__uxScore = async function () {
  const vw = Math.round(visualViewport.width), touch = vw < 1024 || matchMedia('(pointer:coarse)').matches;
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const textEls = [...document.body.querySelectorAll('*')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && vis(e));
  // contrast
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
  const bgOf = (el) => { const st = []; let e = el; while (e) { const s = getComputedStyle(e); if (/url\(|gradient/.test(s.backgroundImage)) return null; const c = parse(s.backgroundColor); if (c && c.a > 0) { st.push(c); if (c.a >= 1) break; } e = e.parentElement; } let base = { r: 8, g: 11, b: 18, a: 1 }; for (let i = st.length - 1; i >= 0; i--) base = blend(st[i], base); return base; };
  let cOk = 0, cN = 0; const cFail = [];
  for (const e of textEls) { const s = getComputedStyle(e); const fg = parse(s.color), bg = bgOf(e); if (!fg || !bg) continue; const f = blend({ ...fg, a: fg.a * (+s.opacity || 1) }, bg); const L1 = lum(f), L2 = lum(bg); const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05); const px = parseFloat(s.fontSize); const need = px >= 24 || (+s.fontWeight >= 700 && px >= 18.66) ? 3 : 4.5; cN++; if (ratio >= need) cOk++; else if (cFail.length < 4) cFail.push(`${e.textContent.trim().slice(0, 24)} (${ratio.toFixed(1)}:1)`); }
  const ctl = [...document.querySelectorAll('a[href],button,[role=button],[role=tab],input:not([type=hidden]),select')].filter(vis);
  const big = ctl.filter((c) => { const r = c.getBoundingClientRect(); const inline = c.tagName === 'A' && getComputedStyle(c).display === 'inline'; return inline || (r.width >= 24 && r.height >= 24); }).length;
  const unnamed = ctl.filter((c) => !((c.getAttribute('aria-label') || c.getAttribute('title') || c.textContent || c.querySelector('img[alt]')?.getAttribute('alt') || c.getAttribute('placeholder') || '').trim() || c.getAttribute('aria-labelledby') || c.closest('label') || (c.id && document.querySelector(`label[for="${CSS.escape(c.id)}"]`))));
  const legible = textEls.filter((e) => parseFloat(getComputedStyle(e).fontSize) >= 11).length;
  const dock = document.querySelector('nav[aria-label=Sections]'), topnav = document.querySelector('.nav-tabs');
  const navOk = vw < 1024 ? !!dock && dock.getBoundingClientRect().bottom <= visualViewport.height + 2 : !!topnav && vis(topnav);
  const lcp = await new Promise((r) => { let v = null; try { new PerformanceObserver((l) => { const e = l.getEntries(); v = e[e.length - 1]?.startTime ?? v; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {} setTimeout(() => r(v), 250); });
  const cls = await new Promise((r) => { let v = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) v += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {} setTimeout(() => r(v), 250); });
  const fams = new Set(textEls.map((e) => getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '').trim()));
  const mark = [...document.images].some((i) => (i.classList.contains('brand-logo') || /qe-mark|favicon\.svg|svg\+xml/.test(i.src)) && vis(i)) || [...document.querySelectorAll('.brand-mark')].some(vis);
  const bodyText = document.body.innerText;
  const junk = (bodyText.match(/\bundefined\b|\bNaN\b|\[object Object\]/g) || []).length;
  const crit = [
    ['U1', 'Fit', innerWidth <= vw + 8, `layout ${innerWidth}px on ${vw}px`],
    ['U2', 'Reachable', navOk, vw < 1024 ? 'bottom dock visible' : 'top nav visible'],
    ['U3', 'Legible', !touch || legible / Math.max(1, textEls.length) >= 0.95, `${Math.round(100 * legible / Math.max(1, textEls.length))}% of text >= 11px`],
    ['U4', 'Contrast', cOk / Math.max(1, cN) >= 0.98, `${cOk}/${cN} AA${cFail.length ? ' · ' + cFail.join('; ') : ''}`],
    ['U5', 'Targets', !touch || big / Math.max(1, ctl.length) >= 0.9, `${big}/${ctl.length} >= 24px`],
    ['U6', 'Named', unnamed.length === 0, `${unnamed.length} unnamed`],
    ['U7', 'Stable', cls <= 0.1, `CLS ${cls.toFixed(3)}`],
    ['U8', 'Fast', lcp != null && lcp <= 2500, `LCP ${lcp != null ? (lcp / 1000).toFixed(1) + 's' : 'n/a'}`],
    ['U9', 'One system', mark && fams.size <= 3, `mark ${mark ? 'yes' : 'no'} · ${fams.size} font families`],
    ['U10', 'Honest', junk === 0, `${junk} junk tokens`],
    ['U11', 'Titled', !!document.title && !/undefined/.test(document.title), document.title.slice(0, 40)],
  ].map(([id, name, pass, detail]) => ({ id, name, pass: !!pass, detail }));
  return { path: location.pathname + location.search, device: vw, pass: crit.filter((c) => c.pass).length, total: crit.length, criteria: crit };
};
