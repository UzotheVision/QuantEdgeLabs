# Narrative / Theme Tracking Engine — Spec

Status: **DRAFT — build after auth fixes land**
Owner: QuantEdge
Origin: the "AI factory" thesis template (MRVL leader re-rate → sympathy chains across
custom silicon, connectivity, optics, fiber, servers, power/cooling, storage, physical
buildout, cloud demand). The goal is to make QuantEdge *track these narratives, identify
their leaders, follow the sympathy chain, and convert that into ranked, edge-backed trades.*

---

## 1. What problem this solves

Markets trade in **narratives**, not isolated tickers. A theme has:

- a **leader** that re-rates first on a catalyst (e.g. MRVL prints → AI-networking re-rate),
- **layers** (sub-groups of the supply/demand chain),
- **members** in each layer that move in *sympathy*, with a lag.

Today QuantEdge has strong **per-ticker** edges (discount-scanner vol-edge, GEX setups,
unusual flow) but **no structure that says "these 14 names belong to one story, here's the
leader, here's who lags, and here's which laggard has the best risk-adjusted setup right now."**

The Narrative Engine is that structure plus a decision layer on top of the edges we already compute.

---

## 2. Core model (3 layers + catalysts + measurement)

```
Theme  ──< Layer ──< Member >── Ticker
  │                     │
  └──< Catalyst         └─ role: leader | sympathy
                         └─ edges (joined at read-time from existing scanners)
Theme ──< SympathyEvent (measured outcomes — leader move → member move)
```

### 2.1 Theme
The story. "AI Factory", "Power & Cooling buildout", "GLP-1", "Onshoring".

### 2.2 Layer
A slice of the chain inside a theme. For AI Factory:
`custom-silicon`, `connectivity`, `optics`, `fiber`, `servers`, `power-cooling`,
`storage`, `physical-buildout`, `cloud-demand`.

### 2.3 Member
A ticker's membership in a layer, with a **role** (`leader` | `sympathy`) and a **rank/tier**.
A ticker can belong to multiple themes/layers (NVDA ∈ AI Factory/cloud-demand AND power).

### 2.4 Catalyst
A dated event tied to a theme or a specific member: earnings, guidance, analyst re-rate,
product launch, contract win, macro print. Has `direction` and `magnitude`.

### 2.5 SympathyEvent (the measurement loop)
When a **leader** makes a defined move on a catalyst, we record each member's subsequent move
over fixed horizons (1d/3d/5d). Over time this gives a **hit-rate and lag profile** per
(theme, leader→member) pair — the thing that makes the engine *learn* rather than just display.

---

## 3. Data model (Drizzle — `shared/schema.ts`)

Mirror existing conventions: `varchar` UUID PKs via `sql\`gen_random_uuid()\``,
`timestamp` with `defaultNow()`, snake_case columns, status enums as text + TS union.

```ts
// ── themes ────────────────────────────────────────────────────────────────
export const themes = pgTable("themes", {
  id:          varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slug:        varchar("slug").notNull().unique(),          // "ai-factory"
  name:        varchar("name").notNull(),                   // "AI Factory"
  thesis:      text("thesis"),                              // the narrative, 1-3 paras
  status:      varchar("status").notNull().default("active"), // active|watch|faded|archived
  conviction:  integer("conviction").default(50),           // 0-100, manually/agent set
  heatScore:   doublePrecision("heat_score").default(0),    // computed, see §5
  createdBy:   varchar("created_by").references(() => users.id),
  createdAt:   timestamp("created_at").defaultNow(),
  updatedAt:   timestamp("updated_at").defaultNow(),
});

// ── theme_layers ──────────────────────────────────────────────────────────
export const themeLayers = pgTable("theme_layers", {
  id:        varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  themeId:   varchar("theme_id").notNull().references(() => themes.id, { onDelete: "cascade" }),
  slug:      varchar("slug").notNull(),                     // "optics"
  name:      varchar("name").notNull(),                     // "Optics & Transceivers"
  position:  integer("position").default(0),                // order in the chain
});

// ── theme_members ─────────────────────────────────────────────────────────
export const themeMembers = pgTable("theme_members", {
  id:        varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  themeId:   varchar("theme_id").notNull().references(() => themes.id, { onDelete: "cascade" }),
  layerId:   varchar("layer_id").references(() => themeLayers.id, { onDelete: "set null" }),
  symbol:    varchar("symbol").notNull(),
  role:      varchar("role").notNull().default("sympathy"), // leader|sympathy
  tier:      integer("tier").default(2),                    // 1=primary,2=secondary,3=fringe
  weight:    doublePrecision("weight").default(1),          // contribution to heat score
  note:      text("note"),
  addedAt:   timestamp("added_at").defaultNow(),
});
// UNIQUE(theme_id, symbol) — a symbol appears once per theme

// ── theme_catalysts ───────────────────────────────────────────────────────
export const themeCatalysts = pgTable("theme_catalysts", {
  id:         varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  themeId:    varchar("theme_id").notNull().references(() => themes.id, { onDelete: "cascade" }),
  symbol:     varchar("symbol"),                            // null = theme-wide (macro)
  kind:       varchar("kind").notNull(),                    // earnings|guidance|rerate|product|contract|macro
  title:      varchar("title").notNull(),
  direction:  varchar("direction"),                         // bullish|bearish|neutral
  magnitude:  doublePrecision("magnitude"),                 // % move or surprise size
  eventAt:    timestamp("event_at").notNull(),
  source:     varchar("source"),                            // url / "manual" / "agent"
  createdAt:  timestamp("created_at").defaultNow(),
});

// ── sympathy_events (measurement) ─────────────────────────────────────────
export const sympathyEvents = pgTable("sympathy_events", {
  id:          varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  themeId:     varchar("theme_id").notNull().references(() => themes.id, { onDelete: "cascade" }),
  catalystId:  varchar("catalyst_id").references(() => themeCatalysts.id, { onDelete: "set null" }),
  leaderSymbol: varchar("leader_symbol").notNull(),
  memberSymbol: varchar("member_symbol").notNull(),
  leaderMovePct: doublePrecision("leader_move_pct"),        // the trigger move
  member1dPct: doublePrecision("member_1d_pct"),
  member3dPct: doublePrecision("member_3d_pct"),
  member5dPct: doublePrecision("member_5d_pct"),
  hit:         boolean("hit"),                              // did member follow direction within 5d?
  measuredAt:  timestamp("measured_at").defaultNow(),
});
```

TS unions to add alongside the existing ones:
```ts
export type ThemeStatus   = "active" | "watch" | "faded" | "archived";
export type MemberRole    = "leader" | "sympathy";
export type CatalystKind  = "earnings" | "guidance" | "rerate" | "product" | "contract" | "macro";
```

> **Note on prices:** every price/move field above is *measured from real quotes/history*,
> never fabricated. Seed data ships symbols + roles only; all `*_pct`, `heatScore`, and
> hit-rates are computed from live data. (House rule: never invent stock/option prices.)

---

## 4. Storage layer (`server/storage.ts`)

Add to the `IStorage` interface + `DatabaseStorage` impl, following existing naming:

```
getThemes(status?): Promise<Theme[]>
getThemeBySlug(slug): Promise<ThemeWithLayers | null>   // joins layers+members
createTheme / updateTheme / archiveTheme
addThemeMember / updateThemeMember / removeThemeMember
addThemeLayer / reorderLayers
getThemeCatalysts(themeId, sinceDays?)
createCatalyst
recordSympathyEvent / getSympathyStats(themeId, leaderSymbol?) // hit-rate + avg lag
getThemesForSymbol(symbol): Promise<Theme[]>            // reverse lookup for Research shell
```

`ThemeWithLayers` = theme + ordered layers, each with its members (sorted leader-first, then tier).

---

## 5. Decision layer (the part that makes it actionable)

This is the bridge from "narrative" to "what do I trade." **It does not recompute edges** —
it *joins* the engine's structure to the scanners we already run.

For a given theme, for each **sympathy member**, assemble a `MemberEdge`:

| Field            | Source (existing)                                              |
|------------------|---------------------------------------------------------------|
| `volEdge`        | discount-scanner (cheap-vs-smile %)                           |
| `gexSetup`       | GEX scanner (0DTE/swing/LEAPS/flip-watch classification)      |
| `flowScore`      | flow-table (sweeps/blocks/dark-pool pressure for the symbol)  |
| `quote/move`     | `/api/quotes/batch` (live)                                    |
| `sympathyScore`  | this engine: historical leader→member hit-rate × recency × lag fit |

**Composite rank** (weights tunable, start equal-ish):
```
score = 0.30*sympathyScore + 0.25*volEdge + 0.25*gexSetup + 0.20*flowScore
```
Rank members descending. The top sympathy member with a live edge is the
"**best laggard right now**" — that's what feeds the existing **Oracle Option Pick** card
(via the canonical premium-selection engine spec'd separately).

**Heat score (§3 `themes.heatScore`)** = weighted aggregate of member moves + recent catalyst
magnitude + flow intensity, normalized 0–100. Drives sort order of theme cards and the
`active|watch|faded` status auto-suggestion.

---

## 6. API surface (`server/routes.ts`)

All under session auth (`isAuthenticated`); mutations are **not** CSRF-exempt, so the client
must use `apiRequest` (the auto-CSRF wrapper), never raw `fetch`.

```
GET  /api/narratives                       → themes list (+ heatScore, top movers)
GET  /api/narratives/:slug                 → theme detail: layers, members, catalysts
GET  /api/narratives/:slug/ranked          → decision layer: members + MemberEdge + composite rank
GET  /api/narratives/by-symbol/:symbol     → themes this ticker belongs to (Research shell badge)
POST /api/narratives                       → create theme            (admin/curator)
PATCH /api/narratives/:id                  → update theme/conviction (admin/curator)
POST /api/narratives/:id/members           → add member
DELETE /api/narratives/:id/members/:mid    → remove member
POST /api/narratives/:id/catalysts         → log a catalyst
```

A scheduled job (reuse the existing scanner cron pattern) runs the **sympathy measurement**:
detect leader moves on catalysts, snapshot member moves at 1d/3d/5d, write `sympathy_events`.

---

## 7. UI surface (no new top-level nav — fold into existing IA)

We just finished collapsing nav; **do not add a new sidebar destination.** Instead:

1. **Hunt → new tab "Narratives"** (`/h?tab=narratives`).
   - Bento grid of theme cards: name, heat score, conviction, sparkline of leader,
     top-3 lagging members with their best edge chip.
   - Click a card → theme detail (same tab, drill state in query param).
   - Theme detail: chain laid out by **layers** (leader pinned), members table sorted by
     the composite rank from `/ranked`, each row → `/r/SYMBOL` (Research shell).
2. **Research shell (`/r/:symbol`) header badge**: "Part of: AI Factory · Optics (sympathy)"
   via `/api/narratives/by-symbol/:symbol`. One-click back to the theme.
3. **Home (`/p`)** "What changed" feed: surface fresh catalysts + themes whose heat crossed
   a threshold today.

Reuse `QECard`, `QETabs`, the existing density/typography tokens. No emojis as icons; Lucide only.

---

## 8. Build order (incremental, each step shippable)

1. **Schema + migration** (themes, layers, members, catalysts) + storage CRUD. Seed one theme
   (AI Factory, ~9 layers, real symbols, roles) — symbols only, no fabricated numbers.
2. **Read APIs** (`/api/narratives`, `/:slug`, `/by-symbol`) + **Hunt → Narratives** card grid
   and detail (static rank by tier first — no edges yet).
3. **Decision layer**: wire `MemberEdge` from discount-scanner + GEX + flow; add `/ranked`;
   sort members by composite score; feed Oracle Option Pick.
4. **Measurement loop**: `sympathy_events` table + cron; compute hit-rate/lag; feed
   `sympathyScore` back into the rank and `heatScore`.
5. **Catalyst ingestion**: manual log UI first; later auto-pull from existing news/earnings feeds.
6. **Research badge + Home "what changed" feed.**

---

## 9. Open questions (decide at build time)

- **Curation model**: admin-only authored themes vs. agent-proposed (auto-discover candidate
  sympathy members from correlation + sector maps, human confirms)? Start admin-authored.
- **Leader move threshold** that triggers a SympathyEvent (e.g. ≥ |4%| on catalyst day, or
  ≥ 1.5× ATR)? Make it a per-theme tunable with a sane default.
- **Decay**: how fast does a theme move `active → watch → faded`? Time-since-last-catalyst +
  heat-score slope.
- **Multi-theme symbols**: when ranking for Hunt, dedupe a symbol across themes or show per-theme?
```
