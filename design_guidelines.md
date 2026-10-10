# Quant Edge Labs Design Guidelines v4.0
## Aurora Grid - Futuristic Institutional Trading Interface

**Vision**: Bloomberg Terminal meets sci-fi command center. Glass morphism, neon accents, ambient particles on slate-950 foundation.

**Tagline**: "Multiple Engines, One Edge"

---

## 1. Design Principles

1. **Generous Breathing Room**: 40-60% more whitespace than traditional dashboards
2. **Monospace Authority**: All numbers in JetBrains Mono - zero exceptions
3. **Ambient Intelligence**: Particle grids/flowing graphs at 10-15% opacity
4. **Neon Precision**: Cyan/purple surgical highlights on slate-950
5. **Progressive Disclosure**: Complex controls revealed on interaction
6. **Modular Canvas**: Drag-and-drop panels, customizable layouts

---

## 2. Typography

**Font Stack**: Inter (UI) | JetBrains Mono (all data/metrics)

```
Hero Metric:    text-5xl font-bold font-mono
Large Metric:   text-3xl font-semibold font-mono tabular-nums
Medium Metric:  text-xl font-mono tabular-nums
Small Data:     text-sm font-mono tabular-nums
Section Title:  text-2xl font-bold tracking-tight
Subsection:     text-base font-semibold
Body Text:      text-sm text-slate-300
Label:          text-xs uppercase tracking-widest text-slate-400
```

**Rule**: Numbers, prices, percentages, timestamps → JetBrains Mono always

---

## 3. Color System

### Foundation
```
slate-950  Background base
slate-900  Panel backgrounds
slate-800/40  Glass surfaces (with backdrop-blur)
slate-700/30  Borders (default)
slate-50   Primary text
slate-300  Secondary text
slate-400  Muted text
```

### Neon Accents
```
cyan-400    Primary interactive, active states
purple-400  AI engine, secondary highlights
green-400   Positive metrics, success
red-400     Warnings, negative signals
amber-400   Alerts, processing
blue-400    Quant engine identity
```

### Engine Identity
```
AI:     purple-400 + purple-500/20 glow
Quant:  blue-400 + blue-500/20 glow
Flow:   cyan-400 + cyan-500/20 glow
```

### Glow Effects (Surgical Use)
```
Interactive:  shadow-[0_0_20px_rgba(34,211,238,0.3)]
Active:       shadow-[0_0_30px_rgba(34,211,238,0.4)]
Live:         shadow-[0_0_15px_rgba(74,222,128,0.5)] + animate-pulse
```

**Only** on focused inputs, active buttons, live indicators. Never static elements.

---

## 4. Glass Morphism

### Tier 1: Primary Panels
```css
bg-slate-900/60 backdrop-blur-2xl 
border border-slate-700/30 
shadow-[0_8px_32px_rgba(0,0,0,0.4)]
```

### Tier 2: Nested Components
```css
bg-slate-800/40 backdrop-blur-xl 
border border-slate-700/20 
shadow-lg shadow-black/20
```

### Tier 3: Data Containers
```css
bg-slate-800/20 backdrop-blur-md 
border border-slate-700/10
```

### Interactive States
```css
transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1)
hover: border-cyan-500/40 shadow-[0_0_20px_rgba(34,211,238,0.2)]
active: bg-slate-700/50
```

**Max 2 glass layers in viewport**. Heaviest blur (2xl) for top surfaces only.

---

## 5. Layout System

### Grid Foundation
- Base unit: 8px (strict)
- Container: `max-w-[1600px] mx-auto`
- Section padding: `p-8` to `p-12`

### Spacing Scale
```
gap-2   8px   Inline chips
gap-4   16px  Compact cards
gap-6   24px  Standard cards
gap-10  40px  Sections
gap-16  64px  Major breaks
```

### Navigation Rail
```
Width: 72px collapsed, 240px expanded
Position: fixed left
Glass: Tier 1 treatment
Icons: 24px with hover glow
Active: 3px cyan-400 left border + glow
```

### Layout Patterns
```
Command Center:   70% canvas + 30% widget rail
Signal Dashboard: Masonry 3-col (desktop) → 2 (tablet) → 1 (mobile)
Engine Compare:   Side-by-side equal columns
Portfolio:        Full-width hero + 4-col metric grid
```

---

## 6. Ambient Backgrounds

### Particle Grid
- Dots: 2px, 40px spacing, slate-700/8 opacity
- Flow Lines: cyan-500/5, 1px width, animated
- Pulse Zones: purple-500/3 radial gradients

### Graph Patterns
- Market Rhythm: Horizontal sine waves (cyan-400/5)
- Data Streams: Vertical particles on hover (10-15 particles, 2px)
- Zone Highlights: 200px blur radius behind focused sections

**Rules**: 5-15% opacity max, GPU transforms only, pause when window inactive

---

## 7. Components

### Buttons
```css
Primary:   bg-cyan-500 hover:shadow-[0_0_30px_rgba(34,211,238,0.4)] text-slate-950
Secondary: border-2 border-cyan-500/60 hover:bg-cyan-500/10 text-cyan-400
Ghost:     hover:bg-slate-700/40 hover:border-slate-600 text-slate-300
```

### Form Inputs
```css
Base:  bg-slate-800/30 backdrop-blur-xl border-slate-700/30
Focus: border-cyan-500/60 ring-4 ring-cyan-500/20 shadow-[0_0_20px_rgba(34,211,238,0.2)]
Error: border-red-400/60 ring-4 ring-red-400/20
```

### Status Indicators
```
Live:       bg-green-400 shadow-[0_0_15px_rgba(74,222,128,0.5)] animate-pulse
Processing: bg-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.5)] animate-pulse
Idle:       bg-slate-500
Error:      bg-red-400 shadow-[0_0_15px_rgba(248,113,113,0.5)]
```

### Insight Panels
```css
Container: Tier 2 glass + border-l-4 border-cyan-400/60
Header:    text-sm font-semibold uppercase tracking-wider text-slate-200
Icon:      20px cyan-400 with glow
Content:   text-sm text-slate-300 leading-relaxed
```

---

## 8. Progressive Disclosure

**Layers**: Surface → Standard → Deep Dive

**Patterns**:
- Expandable panels: Click header to reveal
- Drawer overlays: 400px side-sliding glass
- Inline accordion: 300ms smooth transitions
- Hover tooltips: Glass tooltips, 8px rounded

---

## 9. Animations

### Allowed
```css
Hover:       transition-all duration-300 ease-out
Panel:       transition-all duration-500 cubic-bezier(0.4, 0, 0.2, 1)
Metric:      transition-all duration-200
Page:        fade-in 400ms
Pulse:       animate-pulse (2s, live indicators only)
```

### Forbidden
- Bounce, auto-rotate, parallax, shake/vibrate

---

## 10. Data Visualization

### Chart Colors
```
Positive:     green-400
Negative:     red-400
Neutral:      cyan-400
Comparison:   purple-400
Grid:         slate-700/20
Background:   transparent or slate-900/40
```

### Styles
- Lines: 2px stroke, 8px glow on hover
- Bars: Glass fill (slate-800/40) + 4px colored top border
- Candlesticks: Hollow neon outlines, filled on hover
- Heatmaps: Cyan-to-purple gradients

---

## 11. Responsive Design

### Breakpoints
```
Mobile:  <640px   Single column, bottom nav, static gradient
Tablet:  640-1024px  2 columns, icon-only nav rail
Desktop: >1024px  Full modular canvas
```

### Mobile Optimizations
- Bottom nav (5 icons max)
- Reduced blur: backdrop-blur-md
- No particle animations
- -2px font scale
- 48x48px touch targets
- Swipe gestures for panels

---

## 12. Consistency Checklist

Every page must have:
- ✓ JetBrains Mono with tabular-nums for all numbers
- ✓ slate-950 background, glass panels
- ✓ cyan-400 primary, purple-400 secondary
- ✓ 8px grid spacing
- ✓ 40-60% more whitespace
- ✓ Glow only on interactive/live elements
- ✓ Ambient background layer
- ✓ Max 2 glass layers in viewport
- ✓ Progressive disclosure for complexity
- ✓ Navigation rail (not sidebar)

**Gold Standard**: Trading Engine command center - nav rail, ambient particles, generous padding, neon-accented glass, modular canvas.

---

## 13. Icon System

- **Library**: Heroicons (outline, 20-24px)
- **Engines**: Custom SVG with neon strokes
- **Status**: Filled with glow (16px)

**No static hero images** - use live data viz and ambient particles instead.