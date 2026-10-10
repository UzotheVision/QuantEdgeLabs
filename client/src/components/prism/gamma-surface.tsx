/**
 * GAMMA SURFACE — the strike × expiry × gamma surface, rendered as a surface.
 *
 * `/api/gex-vex/terminal/:symbol` returns `strikeExpiryMatrix`: a few thousand
 * points of `{ strike, dte, expiryLabel, netGEX, netVEX }`. That is three
 * dimensions of data, and the app has been showing it as 2D slices. This renders
 * the object itself.
 *
 * This is not decoration. Traders already call this the gamma surface; the shape
 * of it — where it humps, where it inverts across expiries — is the read. 3D here
 * is the correct projection of the data, which is the only reason to reach for it.
 *
 * Three decisions worth knowing about:
 *
 * 1. THE DEPTH AXIS IS EXPIRY ORDINAL, NOT DAYS. Measured on SPY the DTE values
 *    run 2, 3, 4, 5, 6, 9, 13 … 664, 846. Mapping days linearly would crush every
 *    near-term expiry — where essentially all the gamma is — into a sliver and
 *    hand most of the axis to LEAPS nobody is hedging against today. Each expiry
 *    gets equal depth and the axis is labelled with real dates, so it reads as a
 *    term structure rather than as a timeline. It is labelled that way too.
 *
 * 2. MISSING CELLS ARE ZERO, NOT INTERPOLATED. The grid is sparse — 3,094 of a
 *    possible 6,409 cells on SPY — because not every strike lists at every expiry.
 *    A strike with no contracts carries no dealer gamma, so zero is the true value.
 *    Interpolating would invent a surface between strikes that do not exist.
 *
 * 3. COLOUR FOLLOWS THE EXISTING ENCODING. Positive net GEX is call-dominated
 *    structure and takes moss; negative is put-dominated and takes clay — the same
 *    pairing prism-board already uses for its call wall and put support. Cyan stays
 *    structural: spot, axes, grid.
 *
 * ── two things the solid surface cannot say, and the modes that say them ──
 *
 * 4. POINTS MODE DRAWS ONLY LISTED CELLS. Decision (2) is right — an unlisted
 *    strike carries no dealer gamma, so zero is the true value — but it leaves the
 *    mesh unable to distinguish "the chain listed this strike and gamma is flat"
 *    from "the chain never listed this strike at all". Both sit on the zero plane
 *    and shade identically. On SPY that is 3,315 of 6,409 cells rendered as
 *    measurements that were never taken. The hover readout already draws the
 *    distinction ("not listed"); points mode draws it for the whole grid at once,
 *    by dropping absent cells instead of flattening them. This is the same
 *    value/zero/missing separation canon/value.tsx enforces on numbers, applied to
 *    geometry.
 *
 *    Points carry a lifted colour floor. The mesh lerps from near-black and relies
 *    on lighting for form; a bare point at that floor is invisible on a dark
 *    canvas, which would defeat the one job this mode has. Presence is always
 *    legible, and magnitude still drives the hue.
 *
 * 5. OVERFLOW TICKS MARK CLIPPED CELLS. robustMax scales to the 98.5th percentile,
 *    so roughly 1.5% of cells exceed the plotted height and are flattened to ±H.
 *    Nothing said so. A reader saw a plateau and read "several strikes carrying
 *    equal gamma" when one of them was several times the others — exactly the
 *    outlier the robust scale exists to stop from crushing everything else. Each
 *    clipped cell now carries a short tick continuing past the ceiling: the
 *    standard convention for "this runs off the scale", and it costs no new colour.
 *
 *    An earlier plan here was bloom, borrowed from a reference terminal. It was
 *    wrong for this palette. Bloom keys off luminance, and moss/clay are muted
 *    mid-tones — at a sane threshold it would not fire at all, and at a threshold
 *    low enough to fire it would wash out the saturation ramp that encodes
 *    magnitude. It was standing in for "this value exceeds what you can see", so
 *    that is what got built instead, stated directly.
 */
import { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { robustMax } from '@/components/viz';
import { CanonCoverage } from '@/components/canon';

// ── palette, from index.css ──────────────────────────────────────
const MOSS = new THREE.Color('#6E9E7A');
const CLAY = new THREE.Color('#B5705F');
const FLOOR = new THREE.Color('#14161a');
/** See (4): the mesh floor is near-black, which is invisible as a bare point. */
const POINT_FLOOR = new THREE.Color('#59606b');
const CYAN = '#78C6E8';

export type SurfaceMode = 'surface' | 'wire' | 'points';

const MODE_LABEL: Record<SurfaceMode, string> = {
  surface: 'solid',
  wire: 'wire',
  points: 'listed',
};

export interface SurfacePoint {
  strike: number;
  dte: number;
  expiryLabel: string;
  netGEX: number;
  netVEX?: number;
}

export interface GammaSurfaceProps {
  points: SurfacePoint[];
  spot: number;
  symbol: string;
  callWall?: number | null;
  putWall?: number | null;
  /** Null on most symbols most of the time. Only drawn when it genuinely exists. */
  flipPrice?: number | null;
  /** Strikes within this fraction of spot. Full chain spans far wider than is useful. */
  window?: number;
  className?: string;
}

const W = 10; // strike axis width
const D = 6.4; // expiry axis depth
const H = 1.9; // max height for the largest |netGEX|

interface Grid {
  strikes: number[];
  expiries: { dte: number; label: string }[];
  /** value at [expiryIndex * strikes.length + strikeIndex] */
  values: Float32Array;
  /** 1 where the chain actually listed that strike/expiry. See the hover readout. */
  present: Uint8Array;
  maxAbs: number;
  filled: number;
}

/** Pure so the mapping can be reasoned about (and checked) without a renderer. */
export function buildGrid(points: SurfacePoint[], spot: number, windowFrac: number): Grid {
  const lo = spot * (1 - windowFrac);
  const hi = spot * (1 + windowFrac);
  const inWindow = points.filter((p) => p.strike >= lo && p.strike <= hi);

  const strikes = Array.from(new Set(inWindow.map((p) => p.strike))).sort((a, b) => a - b);
  const dteSet = Array.from(new Set(inWindow.map((p) => p.dte))).sort((a, b) => a - b);
  const labelFor = new Map<number, string>();
  inWindow.forEach((p) => {
    if (!labelFor.has(p.dte)) labelFor.set(p.dte, p.expiryLabel);
  });
  const expiries = dteSet.map((dte) => ({ dte, label: labelFor.get(dte) ?? `${dte}d` }));

  const si = new Map(strikes.map((s, i) => [s, i]));
  const ei = new Map(dteSet.map((d, i) => [d, i]));
  const values = new Float32Array(strikes.length * expiries.length); // zero-filled: see (2)
  const present = new Uint8Array(strikes.length * expiries.length);
  let filled = 0;
  inWindow.forEach((p) => {
    const x = si.get(p.strike);
    const z = ei.get(p.dte);
    if (x === undefined || z === undefined) return;
    values[z * strikes.length + x] = p.netGEX;
    present[z * strikes.length + x] = 1;
    filled++;
  });

  // Scale to a robust maximum, not the true one. GEX is routinely dominated by a
  // single strike — on TSLA one node was several times the next — and dividing by
  // that outlier flattens the entire rest of the surface into the zero plane, which
  // is where the actual term structure lives. robustMax is the same 80th-percentile
  // treatment the 2D viz primitives already use, so both views share a scale idea.
  // Values above it are clipped in height but keep full colour, so a dominant node
  // still reads as dominant without erasing everything around it.
  const maxAbs = robustMax(Array.from(values), 1e-6, 0.985);

  return { strikes, expiries, values, present, maxAbs, filled };
}

/** How far a clipped cell's tick continues past the ceiling. See (5). */
const OVERFLOW = 0.3;

interface Geometries {
  /** Full grid, zero-filled. Surface and wire modes, and the hover target. */
  mesh: THREE.BufferGeometry;
  /** Listed cells only, as points. See (4). */
  listed: THREE.BufferGeometry;
  /** Ticks on cells whose true magnitude exceeds the plotted height. See (5). */
  overflow: THREE.BufferGeometry;
  /** Cells clipped by the robust scale — reported, not just drawn. */
  clipped: number;
}

function useSurfaceGeometries(grid: Grid): Geometries {
  return useMemo(() => {
    const { strikes, expiries, values, present, maxAbs } = grid;
    const nx = strikes.length;
    const nz = expiries.length;
    const mesh = new THREE.BufferGeometry();
    const listed = new THREE.BufferGeometry();
    const overflow = new THREE.BufferGeometry();
    if (nx < 2 || nz < 2) return { mesh, listed, overflow, clipped: 0 };

    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const tmp = new THREE.Color();

    // Listed cells and overflow ticks are sparse, so they grow rather than being
    // sized to the full grid.
    const lPos: number[] = [];
    const lCol: number[] = [];
    const oPos: number[] = [];
    const oCol: number[] = [];
    let clipped = 0;

    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const i = z * nx + x;
        const v = values[i];
        const ratio = v / maxAbs;
        const h = Math.max(-1, Math.min(1, ratio)) * H;
        const px = (x / (nx - 1) - 0.5) * W;
        const pz = (z / (nz - 1) - 0.5) * D;
        pos[i * 3] = px;
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = pz;

        // Saturation tracks magnitude, so a flat region reads as flat rather than
        // as a confident colour.
        const t = Math.min(1, Math.abs(v) / maxAbs);
        const target = v >= 0 ? MOSS : CLAY;
        tmp.copy(FLOOR).lerp(target, 0.25 + t * 0.75);
        col[i * 3] = tmp.r;
        col[i * 3 + 1] = tmp.g;
        col[i * 3 + 2] = tmp.b;

        if (present[i] === 1) {
          tmp.copy(POINT_FLOOR).lerp(target, 0.2 + t * 0.8);
          lPos.push(px, h, pz);
          lCol.push(tmp.r, tmp.g, tmp.b);
        }

        // Only a listed cell can overflow: an absent cell is a zero-fill, and a
        // tick there would claim a reading the chain never made.
        if (present[i] === 1 && Math.abs(ratio) > 1) {
          clipped++;
          const dir = Math.sign(ratio);
          tmp.copy(target);
          oPos.push(px, h, pz, px, h + dir * OVERFLOW, pz);
          oCol.push(tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b);
        }
      }
    }

    const idx: number[] = [];
    for (let z = 0; z < nz - 1; z++) {
      for (let x = 0; x < nx - 1; x++) {
        const a = z * nx + x;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }

    mesh.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    mesh.setAttribute('color', new THREE.BufferAttribute(col, 3));
    mesh.setIndex(idx);
    mesh.computeVertexNormals();

    listed.setAttribute('position', new THREE.Float32BufferAttribute(lPos, 3));
    listed.setAttribute('color', new THREE.Float32BufferAttribute(lCol, 3));

    overflow.setAttribute('position', new THREE.Float32BufferAttribute(oPos, 3));
    overflow.setAttribute('color', new THREE.Float32BufferAttribute(oCol, 3));

    return { mesh, listed, overflow, clipped };
  }, [grid]);
}

/** Maps a strike to its x position, for markers that sit off-grid. */
function strikeToX(strike: number, strikes: number[]): number | null {
  if (strikes.length < 2) return null;
  const lo = strikes[0];
  const hi = strikes[strikes.length - 1];
  if (strike < lo || strike > hi) return null;
  return ((strike - lo) / (hi - lo) - 0.5) * W;
}

/**
 * A level drawn on the floor of the surface. Labels live in the DOM legend rather
 * than in the scene: drei's <Html> invalidates the renderer every frame (measured
 * ~150 idle GPU draws/sec, which defeated frameloop="demand"), and drei's <Text>
 * needs a blob-URL Web Worker that this app's CSP blocks outright. A static legend
 * costs neither.
 */
function VerticalMarker({
  x,
  color,
  dashed,
}: {
  x: number;
  color: string;
  dashed?: boolean;
}) {
  const pts = useMemo(
    () => [new THREE.Vector3(x, -H, -D / 2), new THREE.Vector3(x, -H, D / 2)],
    [x],
  );
  const geom = useMemo(() => new THREE.BufferGeometry().setFromPoints(pts), [pts]);
  return (
    <group>
      <primitive
        object={
          new THREE.Line(
            geom,
            dashed
              ? new THREE.LineDashedMaterial({ color, dashSize: 0.18, gapSize: 0.12 })
              : new THREE.LineBasicMaterial({ color }),
          )
        }
      />
    </group>
  );
}

function Scene({
  grid,
  geo,
  mode,
  spot,
  callWall,
  putWall,
  flipPrice,
  onHover,
}: {
  grid: Grid;
  geo: Geometries;
  mode: SurfaceMode;
  spot: number;
  callWall?: number | null;
  putWall?: number | null;
  flipPrice?: number | null;
  onHover: (v: { strike: number; label: string; gex: number; listed: boolean } | null) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(7.4, 5.6, 8.2);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    const p = e.point;
    const { strikes, expiries, values, present } = grid;
    if (strikes.length < 2 || expiries.length < 2) return;
    const fx = Math.round((p.x / W + 0.5) * (strikes.length - 1));
    const fz = Math.round((p.z / D + 0.5) * (expiries.length - 1));
    const xi = Math.max(0, Math.min(strikes.length - 1, fx));
    const zi = Math.max(0, Math.min(expiries.length - 1, fz));
    const cell = zi * strikes.length + xi;
    onHover({
      strike: strikes[xi],
      label: expiries[zi].label,
      gex: values[cell],
      listed: present[cell] === 1,
    });
  };

  const spotX = strikeToX(spot, grid.strikes);
  const callX = callWall != null ? strikeToX(callWall, grid.strikes) : null;
  const putX = putWall != null ? strikeToX(putWall, grid.strikes) : null;
  const flipX = flipPrice != null ? strikeToX(flipPrice, grid.strikes) : null;

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[6, 10, 6]} intensity={1.1} />
      <directionalLight position={[-8, 4, -6]} intensity={0.35} color={CYAN} />

      {/* Wire keeps vertex colours rather than going monochrome: the whole point of
          seeing through the surface is reading the term structure behind a dominant
          node, and that structure is carried in the colour. */}
      <mesh
        ref={meshRef}
        geometry={geo.mesh}
        visible={mode !== 'points'}
        onPointerMove={handleMove}
        onPointerOut={() => onHover(null)}
      >
        {mode === 'wire' ? (
          <meshBasicMaterial vertexColors wireframe transparent opacity={0.7} />
        ) : (
          <meshStandardMaterial
            vertexColors
            side={THREE.DoubleSide}
            roughness={0.62}
            metalness={0.05}
          />
        )}
      </mesh>

      {mode === 'points' && (
        <points geometry={geo.listed}>
          <pointsMaterial vertexColors size={0.075} sizeAttenuation transparent opacity={0.95} />
        </points>
      )}

      {/* Overflow ticks ride every mode: a clipped cell is misread the same way
          whichever way the surface is drawn. */}
      <lineSegments geometry={geo.overflow}>
        <lineBasicMaterial vertexColors transparent opacity={0.9} />
      </lineSegments>

      {/* Zero plane. Where the surface crosses this, dealer hedging flips sign —
          that crossing is the read, so the reference has to be visible.
          It also carries the hover handlers, so the readout keeps working in points
          mode where there is no continuous surface to raycast. R3F dispatches
          pointerout before pointermove within a move, so handing off between the
          plane and the mesh sets the cell rather than clearing it. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onPointerMove={handleMove}
        onPointerOut={() => onHover(null)}
      >
        <planeGeometry args={[W, D]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.05} side={THREE.DoubleSide} />
      </mesh>

      {spotX !== null && <VerticalMarker x={spotX} color={CYAN} />}
      {callX !== null && <VerticalMarker x={callX} color="#6E9E7A" />}
      {putX !== null && <VerticalMarker x={putX} color="#B5705F" />}
      {flipX !== null && <VerticalMarker x={flipX} color="#f59e0b" dashed />}

      {/* Damping off: inertia on a data instrument is decoration, and a surface
          that stops when you stop dragging is the correct behaviour. Note this
          does not restore demand rendering on its own — drei drives update() from
          a frame hook regardless of this flag. See the Canvas comment above. */}
      <OrbitControls
        enablePan={false}
        autoRotate={false}
        enableDamping={false}
        minDistance={7}
        maxDistance={20}
        maxPolarAngle={Math.PI / 2.05}
      />
    </>
  );
}

export function GammaSurface({
  points,
  spot,
  symbol,
  callWall,
  putWall,
  flipPrice,
  window: windowFrac = 0.08,
  className,
}: GammaSurfaceProps) {
  const [hover, setHover] = useState<{ strike: number; label: string; gex: number; listed: boolean } | null>(null);
  // Solid is the default: it is the shape traders come here for. The other two
  // answer questions about the data behind it, which is a deliberate second look.
  const [mode, setMode] = useState<SurfaceMode>('surface');
  const grid = useMemo(() => buildGrid(points, spot, windowFrac), [points, spot, windowFrac]);
  const geo = useSurfaceGeometries(grid);
  const cells = grid.strikes.length * grid.expiries.length;

  if (grid.strikes.length < 2 || grid.expiries.length < 2) {
    return (
      <div className={className}>
        <div className="grid h-full place-items-center p-6 text-center">
          <p className="ui-prose text-[12px] text-muted-foreground">
            Not enough of the {symbol} chain within ±{Math.round(windowFrac * 100)}% of spot to
            build a surface. This says the chain is thin, not that gamma is zero.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={className} style={{ position: 'relative' }}>
      {/* frameloop="demand" is set but does NOT currently take effect, and the
          comment says so rather than claiming a win that was not measured.
          drei's OrbitControls registers `useFrame(() => controls.update(), -1)`
          unconditionally — not only when damping is on — and its change handler
          calls invalidate(), so update and invalidate feed each other. Measured
          on an idle, motionless surface: ~224 GPU draws/sec.

          Left in place because it is correct intent and becomes real the moment
          the controls are hand-rolled. The actual mitigation today is mounting:
          this Canvas only exists while the 3D view is selected, so a user on the
          default 2D matrix pays nothing at all. The scene is ~6.8k triangles, so
          the cost while open is small — but it is not zero, and pretending
          otherwise in a comment would be the same species of overclaim this app
          refuses everywhere else. */}
      <Canvas
        frameloop="demand"
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 42, near: 0.1, far: 100 }}
      >
        <Scene
          grid={grid}
          geo={geo}
          mode={mode}
          spot={spot}
          callWall={callWall}
          putWall={putWall}
          flipPrice={flipPrice}
          onHover={setHover}
        />
      </Canvas>

      {/* Readout. Mono + tabular figures, same as every other number in the app. */}
      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] leading-relaxed">
        <div className="tracking-widest text-[var(--brand-cyan)]">
          {symbol} · GAMMA SURFACE
        </div>
        <div className="text-muted-foreground">
          {grid.strikes.length} strikes × {grid.expiries.length} expiries
        </div>
        {/* The coverage line the solid mesh cannot show. Same component the
            performance surface uses, so "measurable of total" reads identically
            wherever it appears. */}
        <CanonCoverage
          className="!text-[10px]"
          label="Listed"
          measurable={grid.filled}
          total={cells}
          breakdown={`${cells - grid.filled} not listed`}
        />
        {flipPrice == null && (
          <div className="text-muted-foreground">no gamma flip in range</div>
        )}
      </div>

      {/* Mode toggle. Matches prism-board's own 2D/3D switch rather than inventing a
          second control style for the panel it lives in. */}
      <div className="absolute left-3 top-[76px] flex overflow-hidden rounded border border-border/50 bg-background/70 backdrop-blur-sm">
        {(['surface', 'wire', 'points'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            title={
              m === 'points'
                ? 'Draw only the strike/expiry cells the chain actually listed'
                : m === 'wire'
                  ? 'See through the surface to the term structure behind it'
                  : 'The solid gamma surface'
            }
            className={`px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors ${
              mode === m
                ? 'bg-[var(--brand-cyan)]/15 text-[var(--brand-cyan)]'
                : 'text-muted-foreground hover:text-foreground/80'
            }`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      <div className="pointer-events-none absolute right-3 top-3 text-right font-mono text-[10px] leading-relaxed tabular-nums">
        {hover ? (
          <>
            <div className="text-foreground">${hover.strike}</div>
            <div className="text-muted-foreground">{hover.label}</div>
            {hover.listed ? (
              <div style={{ color: hover.gex >= 0 ? '#6E9E7A' : '#B5705F' }}>
                {hover.gex >= 0 ? '+' : ''}
                {hover.gex.toFixed(4)} GEX
              </div>
            ) : (
              /* An unlisted strike/expiry is an absence, not a measurement of zero.
                 Printing "0.0000 GEX" here would state a reading the chain never made. */
              <div className="text-muted-foreground">not listed</div>
            )}
          </>
        ) : (
          <div className="text-muted-foreground">hover the surface</div>
        )}
      </div>

      {/* Level legend. The lines are drawn on the floor of the surface; this names
          them. A level outside the ±window is reported as out of range rather than
          silently omitted, so an absent line never reads as an absent level. */}
      <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col items-end gap-1 font-mono text-[9px] tabular-nums">
        {([
          ['SPOT', spot, CYAN],
          ['CALL WALL', callWall, '#6E9E7A'],
          ['PUT', putWall, '#B5705F'],
          ['FLIP', flipPrice, '#f59e0b'],
        ] as const).map(([name, value, color]) =>
          value == null ? (
            <div key={name} className="text-muted-foreground">
              {name} — none
            </div>
          ) : (
            <div key={name} className="flex items-center gap-1.5" style={{ color }}>
              <span className="inline-block h-px w-4" style={{ background: color }} />
              <span className="tracking-wider">
                {name} {value}
                {strikeToX(value, grid.strikes) === null ? ' · out of range' : ''}
              </span>
            </div>
          ),
        )}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 font-mono text-[9px] leading-relaxed tracking-wider text-muted-foreground">
        <div>X STRIKE · Z EXPIRY (ordinal, not linear days) · Y NET GEX</div>
        {/* Naming the clipping is the point of (5). Silence here is what let a
            plateau of unequal cells read as a plateau of equal ones. */}
        <div>
          {geo.clipped > 0 ? (
            <>
              HEIGHT CLIPPED AT ROBUST MAX ·{' '}
              <span className="text-foreground/70">{geo.clipped} CELL{geo.clipped === 1 ? '' : 'S'} RUN PAST IT</span>{' '}
              (TICKED)
            </>
          ) : (
            'NO CELL EXCEEDS THE PLOTTED HEIGHT'
          )}
        </div>
      </div>
    </div>
  );
}
