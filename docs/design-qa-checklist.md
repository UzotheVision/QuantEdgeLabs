# Quant Edge Labs Design QA Checklist

**Purpose**: Every page must pass ALL checks before approval.

---

## TYPOGRAPHY
- [ ] All numbers/prices/percentages use `font-mono tabular-nums`
- [ ] All UI text uses `font-inter` (or system Inter)
- [ ] Heading hierarchy follows guidelines (3xl/2xl/xl/base/sm)
- [ ] Timestamps use `text-xs font-mono text-slate-500`
- [ ] No mixed fonts in same component

## COLOR SYSTEM
- [ ] Background is `slate-950` everywhere
- [ ] No gradients (except subtle black shadows)
- [ ] Accent colors used only for status/actions
- [ ] Text contrast ≥ 4.5:1 (WCAG AA)
- [ ] Engine colors used consistently (Purple=AI, Blue=Quant, Cyan=Flow)

## GLASSMORPHISM
- [ ] Max 3 glass layers per view
- [ ] Borders are `slate-700/40` or `slate-700/60` (semi-transparent)
- [ ] Backdrop blur values: xl for primary, md for nested, sm for data
- [ ] No solid backgrounds on glass layers

## SPACING
- [ ] 8px base grid strictly enforced
- [ ] Padding: p-6 standard, p-8 for large panels, p-4 for compact
- [ ] Gap: gap-4 for cards, gap-6 for sections, gap-8 for panels
- [ ] No arbitrary spacing values (no `style={{margin: '13px'}}`)

## ANIMATIONS
- [ ] Only `animate-pulse` for live indicators
- [ ] Only `transition-colors` for hover states
- [ ] No bounce/rotate animations
- [ ] Loaders use skeletons, not spinners (except command prompt)

## INTERACTIVE ELEMENTS
- [ ] Buttons use 3 variants: primary (cyan), secondary (border), ghost (hover)
- [ ] Minimum touch target: 44x44px
- [ ] Focus rings: `ring-2 ring-cyan-500 ring-offset-2`
- [ ] Disabled state: `opacity-50 cursor-not-allowed`

## DATA DISPLAY
- [ ] Every metric has timestamp
- [ ] Every signal has source badge
- [ ] Loading states use skeletons or terminal-style loaders
- [ ] Empty states have icon + message + actions
- [ ] Error states have red accent + retry button

## MOBILE
- [ ] Sidebar becomes bottom sheet or hamburger
- [ ] Grid collapses to single column
- [ ] Font sizes scale down appropriately
- [ ] Touch targets ≥ 44px
- [ ] No horizontal scrolling

## CONTENT
- [ ] Educational disclaimers on every screen
- [ ] No marketing fluff text
- [ ] No exclamation points in UI copy
- [ ] All numbers monospace
- [ ] All actions have clear "Action:" statements

## PERFORMANCE
- [ ] No layout shift on load
- [ ] No FOUT (Flash of Unstyled Text)
- [ ] Glassmorphism layers don't cause jank
- [ ] Animations use GPU acceleration

---

## PAGE AUDIT STATUS

| Page | Route | Status | Notes |
|------|-------|--------|-------|
| Command Center | `/trading-engine` | ✅ REFERENCE | Gold standard |
| Trade Desk | `/trade-desk` | ⚠️ AUDIT | Check card consistency |
| Watchlist | `/watchlist` | ⚠️ AUDIT | Check padding |
| Performance | `/analytics/performance` | ⚠️ AUDIT | Chart frames |
| Settings | `/settings` | ⚠️ AUDIT | Form components |
| Login | `/login` | ⚠️ AUDIT | Glass inputs |
| Register | `/register` | ⚠️ AUDIT | Glass inputs |

---

## SIGN-OFF

**Page**: _________________  
**Auditor**: _________________  
**Date**: _________________  
**Status**: [ ] PASS / [ ] FAIL  

**Notes**: _________________
