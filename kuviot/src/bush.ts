import { bloomBody, leafMarkup, popper, BLOOM_R, G, type Params, type RenderOpts } from './bloom';
import { petalPath, fmt } from './geometry';
import type { Palette } from './palettes';
import { mulberry32, mutateGenes } from './rng';

/**
 * A bush is laid out in three steps:
 *   1. Scatter sites inside a silhouette and relax them with weighted Lloyd
 *      iterations (centroidal power-Voronoi), so cells are even but irregular,
 *      and some are big (hero blooms) while others are small (fillers).
 *   2. Grow a stem tree from the root: each site hooks onto the stem of a
 *      nearby site below it, or straight onto the root.
 *   3. Fill cells with the current flower and a few mutated siblings, plus
 *      buds, berries and sprigs in the small cells.
 * In mirror mode only the right half (plus sites on the axis) is computed and
 * the half is drawn twice.
 */

export const BDNA_LEN = 8;
export interface BushParams {
  density: number; // few big ↔ many small
  mirror: boolean;
}
export const BUSH_VIEWBOX = { x: -540, y: -600, w: 1080, h: 1150 };

type Pt = { x: number; y: number };
type Kind = 'bloom' | 'bud' | 'berries' | 'sprig';

interface Node extends Pt {
  r: number;
  axis: boolean;
  kind: Kind;
  species: number;
  u: number; // per-node random for small variations
  a: Pt; // stem start
  c: Pt; // stem control point (end is the node itself)
  depth: number;
  weight: number; // number of nodes fed by this stem, for thickness
}

const ROOT: Pt = { x: 0, y: 500 };
const SPECIES = 4;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (t: number) => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
const pick = (v: number, n: number) => Math.min(n - 1, Math.floor(v * n));

function seedOf(genes: number[]): number {
  let s = 0x811c9dc5;
  for (const v of genes.slice(0, 4)) s = Math.imul(s ^ Math.round(v * 255), 0x01000193) >>> 0;
  return s;
}

function silhouette(b: number[]) {
  const ry = lerp(380, 460, b[5]);
  const rx = lerp(320, 440, b[4]);
  const cy = 400 - ry; // bottom edge sits at y=400, above the root
  const n = lerp(2, 3.4, b[6]); // ellipse → squircle
  const taper = lerp(0.25, 0.8, b[7]); // how much the bottom pinches in, like a bouquet
  const inside = (x: number, y: number) => {
    const v = (y - cy) / ry;
    if (v <= -1 || v >= 1) return false;
    const w = rx * (1 - taper * smooth(v));
    return Math.abs(x / w) ** n + Math.abs(v) ** n < 1;
  };
  return { inside, top: cy - ry, bottom: cy + ry, rx };
}

// ---- 1. layout ---------------------------------------------------------------

function relax(bdna: number[], bp: BushParams) {
  const rng = mulberry32(seedOf(bdna));
  const sil = silhouette(bdna);
  const N = Math.round(lerp(8, 48, bp.density));
  const mirror = bp.mirror;

  // Grid samples standing in for the continuous area (right half only when mirrored).
  const STEP = 12;
  const samples: number[] = [];
  for (let y = sil.top; y < sil.bottom; y += STEP) {
    for (let x = mirror ? STEP / 2 : -sil.rx; x < sil.rx; x += STEP) {
      if (sil.inside(x, y)) samples.push(x, y);
    }
  }
  const area = (samples.length / 2) * STEP * STEP * (mirror ? 2 : 1);
  const spacing = Math.sqrt(area / N);

  const nAxis = mirror ? clamp(Math.round(N * 0.1 + rng() * 1.5), 1, 5) : 0;
  const nFree = mirror ? Math.round((N - nAxis) / 2) : N;
  const X: number[] = [], Y: number[] = [], W: number[] = [], axis: boolean[] = [];
  for (let i = 0; i < nAxis + nFree; i++) {
    const onAxis = i < nAxis;
    let x = 0, y = 0;
    for (let tries = 0; tries < 400; tries++) {
      x = onAxis ? 0 : mirror ? rng() * sil.rx : (rng() * 2 - 1) * sil.rx;
      y = lerp(sil.top, sil.bottom, rng());
      if (sil.inside(x, y)) break;
    }
    const u = i === 0 ? 1 : rng(); // the first site is always a hero-sized cell
    X.push(x); Y.push(y); axis.push(onAxis);
    W.push((spacing * 0.95 * u ** 1.5) ** 2); // power-diagram weight: bigger weight → bigger cell
  }

  const n = X.length;
  let cnt = new Float64Array(n);
  for (let iter = 0; iter < 8; iter++) {
    const sx = new Float64Array(n), sy = new Float64Array(n);
    cnt = new Float64Array(n);
    for (let s = 0; s < samples.length; s += 2) {
      const px = samples[s], py = samples[s + 1];
      let best = Infinity, owner = -1;
      for (let j = 0; j < n; j++) {
        const dy2 = (py - Y[j]) ** 2;
        const d = (px - X[j]) ** 2 + dy2 - W[j];
        if (d < best) { best = d; owner = j; }
        if (mirror && !axis[j]) {
          const dm = (px + X[j]) ** 2 + dy2 - W[j]; // the site's mirror image
          if (dm < best) { best = dm; owner = -1; }
        }
      }
      if (owner >= 0) { sx[owner] += px; sy[owner] += py; cnt[owner]++; }
    }
    for (let j = 0; j < n; j++) {
      if (!cnt[j]) continue;
      X[j] = axis[j] ? 0 : sx[j] / cnt[j];
      Y[j] = sy[j] / cnt[j];
    }
  }

  // Radius from cell area, then shrink pairs that would overlap too much.
  type Site = Pt & { r: number; axis: boolean; twin: number };
  const sites: Site[] = [];
  for (let j = 0; j < n; j++) {
    if (!cnt[j]) continue;
    const a = cnt[j] * STEP * STEP * (mirror && axis[j] ? 2 : 1);
    sites.push({ x: X[j], y: Y[j], r: clamp(Math.sqrt(a / Math.PI) * 0.95, 18, 175), axis: axis[j], twin: -1 });
  }
  const all = [...sites];
  if (mirror) {
    sites.forEach((s, i) => {
      if (!s.axis) { s.twin = all.length; all.push({ ...s, x: -s.x, twin: i }); }
    });
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const d = Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y) * 1.1;
        if (all[i].r + all[j].r > d) {
          const k = d / (all[i].r + all[j].r);
          all[i].r *= k;
          all[j].r *= k;
        }
      }
    }
  }
  sites.forEach((s) => (s.r = Math.max(14, s.twin >= 0 ? Math.min(s.r, all[s.twin].r) : s.r)));
  return { sites, rng };
}

function stemPoint(nd: Node, t: number): Pt {
  const s = 1 - t;
  return {
    x: s * s * nd.a.x + 2 * s * t * nd.c.x + t * t * nd.x,
    y: s * s * nd.a.y + 2 * s * t * nd.c.y + t * t * nd.y,
  };
}

function stemTangent(nd: Node, t: number): number {
  const dx = 2 * (1 - t) * (nd.c.x - nd.a.x) + 2 * t * (nd.x - nd.c.x);
  const dy = 2 * (1 - t) * (nd.c.y - nd.a.y) + 2 * t * (nd.y - nd.c.y);
  return (Math.atan2(dx, -dy) * 180) / Math.PI; // degrees clockwise from "up"
}

function buildLayout(bdna: number[], bp: BushParams): Node[] {
  const { sites, rng } = relax(bdna, bp);

  const sorted = sites.map((s) => s.r).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 50;
  const biggest = sorted[sorted.length - 1];

  const nodes: Node[] = sites.map((s) => {
    const u = rng(), u2 = rng(), u3 = rng();
    let kind: Kind = 'bloom';
    if (s.r < median * 0.75) kind = u2 < 0.45 ? 'bud' : u2 < 0.75 ? 'berries' : 'sprig';
    return {
      x: s.x, y: s.y, r: s.r, axis: s.axis, kind, u,
      species: s.r === biggest ? 0 : pick(u3, SPECIES),
      a: ROOT, c: ROOT, depth: 0, weight: 1,
    };
  });

  // Grow the stem tree outward from the root.
  const parent = new Map<Node, Node | null>();
  const order = [...nodes].sort((p, q) => Math.hypot(p.x - ROOT.x, p.y - ROOT.y) - Math.hypot(q.x - ROOT.x, q.y - ROOT.y));
  const placed: Node[] = [];
  for (const nd of order) {
    let best: Node | null = null;
    let bestA = ROOT;
    let bestCost = Math.hypot(nd.x - ROOT.x, nd.y - ROOT.y) * 1.3;
    for (const q of placed) {
      if (bp.mirror && nd.axis && !q.axis) continue; // keep axis stems on the axis
      if (q.y < nd.y + 20) continue; // only hook onto stems below
      const a = stemPoint(q, lerp(0.5, 0.75, q.u));
      const dx = nd.x - a.x, dy = a.y - nd.y;
      const ang = Math.atan2(Math.abs(dx), dy);
      if (ang > 1.15) continue;
      const cost = Math.hypot(dx, dy) + ang * 70;
      if (cost < bestCost) { bestCost = cost; best = q; bestA = a; }
    }
    parent.set(nd, best);
    nd.a = bestA;
    // Rise first, then sweep sideways into the flower: the folk-bouquet curve.
    nd.c = { x: lerp(bestA.x, nd.x, 0.2), y: lerp(bestA.y, nd.y, 0.7) };
    nd.depth = best ? best.depth + 1 : 0;
    placed.push(nd);
  }
  for (const nd of nodes) {
    for (let p = parent.get(nd); p; p = parent.get(p)) p.weight++;
  }
  return nodes;
}

const layoutCache = new Map<string, Node[]>();
function getLayout(bdna: number[], bp: BushParams): Node[] {
  const key = `${bdna.join(',')}|${bp.density.toFixed(3)}|${bp.mirror}`;
  let l = layoutCache.get(key);
  if (!l) {
    l = buildLayout(bdna, bp);
    if (layoutCache.size > 64) layoutCache.delete(layoutCache.keys().next().value!);
    layoutCache.set(key, l);
  }
  return l;
}

// ---- 3. rendering ----------------------------------------------------------------

export interface BushSpecimen {
  dna: number[];
  cdna: number[];
  bdna: number[];
}

/** The current flower plus mutated siblings, each shifted to other palette colors. */
function makeSpecies(s: BushSpecimen) {
  const rng = mulberry32(seedOf(s.bdna) ^ 0x9e3779b9);
  return Array.from({ length: SPECIES }, (_, i) => {
    if (i === 0) return { dna: s.dna, cdna: s.cdna };
    const cdna = [...s.cdna];
    cdna[0] = (cdna[0] + i * 0.29) % 1;
    cdna[4] = rng();
    return { dna: mutateGenes(s.dna, rng, 0.22, 0.12), cdna };
  });
}

export function renderBush(s: BushSpecimen, p: Params, bp: BushParams, pal: Palette, opts: RenderOpts = {}): string {
  const nodes = getLayout(s.bdna, bp);
  const species = makeSpecies(s);
  const pop = popper(opts.animate);
  const hero = (i: number) => s.dna[i] ?? 0.5;
  const m = pal.blooms.length;
  const colorOf = (sp: number, offset = 0) => pal.blooms[(pick(species[sp].cdna[0], m) + offset) % m];
  const maxW = Math.max(...nodes.map((n) => n.weight));
  const delayOf = (depth: number) => depth * 170;
  const stagger = (ms: number) => (opts.animate ? ` style="--stagger:${Math.round(ms)}ms"` : '');

  // Each element goes into the "side" bucket (drawn twice when mirrored) or the "axis" bucket.
  const layers = { stems: { side: [] as string[], axis: [] as string[] }, leaves: { side: [] as string[], axis: [] as string[] }, items: { side: [] as string[], axis: [] as string[] } };
  const bucket = (nd: Node) => (bp.mirror && nd.axis ? 'axis' : 'side');

  // root leaves
  const rootLen = 150;
  for (const side of [-1, 1]) {
    const inner = leafMarkup(rootLen, rootLen * 0.3, side * 0.12, hero(G.leafInset) > 0.5, pal);
    layers.leaves.axis.push(`<g transform="translate(${ROOT.x} ${ROOT.y}) rotate(${side * 58})"${stagger(0)}>${pop(120, inner)}</g>`);
  }

  for (const nd of nodes) {
    const b = bucket(nd);
    const len = Math.hypot(nd.x - nd.a.x, nd.y - nd.a.y);
    const width = lerp(3, 12, Math.sqrt(nd.weight / maxW));
    const t0 = delayOf(nd.depth);

    layers.stems[b].push(
      `<path${opts.animate ? ' class="k-stem" pathLength="1"' : ''}${stagger(t0)} d="M${fmt(nd.a.x)} ${fmt(nd.a.y)} Q${fmt(nd.c.x)} ${fmt(nd.c.y)} ${fmt(nd.x)} ${fmt(nd.y)}" ` +
        `stroke="${pal.stem}" stroke-width="${fmt(width)}" stroke-linecap="round" fill="none"/>`,
    );

    // leaves along the stem
    if (len > 70) {
      const ts = len > 220 ? [0.38, 0.68] : [0.5];
      ts.forEach((t, k) => {
        const pt = stemPoint(nd, t);
        const tan = stemTangent(nd, t);
        const sides = bp.mirror && nd.axis ? [-1, 1] : [(k + Math.round(nd.u * 10)) % 2 ? 1 : -1];
        const leafLen = clamp(len * 0.22, 26, 85) * lerp(0.8, 1.15, nd.u);
        for (const side of sides) {
          const inner = leafMarkup(leafLen, leafLen * lerp(0.2, 0.3, hero(G.leafWidth)), side * (0.08 + p.curl * 0.35), hero(G.leafInset) > 0.5, pal);
          layers.leaves[b].push(
            `<g transform="translate(${fmt(pt.x)} ${fmt(pt.y)}) rotate(${fmt(tan + side * lerp(40, 62, nd.u))})"${stagger(t0)}>${pop(250 * t + 150, inner)}</g>`,
          );
        }
      });
    }

    // the thing at the tip
    const rot = clamp(stemTangent(nd, 1) * 0.8, -75, 75);
    const at = `translate(${fmt(nd.x)} ${fmt(nd.y)}) rotate(${fmt(rot)})`;
    const tItem = t0 + 300;
    let item = '';
    switch (nd.kind) {
      case 'bloom': {
        const sp = species[nd.species];
        const scale = nd.r / (BLOOM_R * 1.05);
        item = `<g transform="${at} scale(${fmt(scale)})"${stagger(tItem)}>${bloomBody(sp.dna, sp.cdna, p, pal, opts.animate)}</g>`;
        break;
      }
      case 'bud':
        item = `<g transform="${at}"${stagger(tItem)}>${pop(0, budMarkup(nd.r, colorOf(nd.species), colorOf(nd.species, 2), pal))}</g>`;
        break;
      case 'berries':
        item = `<g transform="${at}"${stagger(tItem)}>${pop(0, berriesMarkup(nd.r, nd.u, colorOf(nd.species, 1), pal))}</g>`;
        break;
      case 'sprig':
        item = `<g transform="${at}"${stagger(tItem)}>${pop(0, sprigMarkup(nd.r, nd.u, p, pal))}</g>`;
        break;
    }
    layers.items[b].push(item);
  }

  // Small things first so the big blooms sit on top.
  const order = [...nodes].sort((a, b) => a.r - b.r);
  const ranked = (list: string[], which: 'side' | 'axis') => {
    const ns = nodes.filter((nd) => bucket(nd) === which);
    return order.filter((nd) => bucket(nd) === which).map((nd) => list[ns.indexOf(nd)]);
  };
  const emit = (side: string[], axis: string[]) =>
    bp.mirror ? `<g>${side.join('')}</g><g transform="scale(-1 1)">${side.join('')}</g>${axis.join('')}` : side.join('') + axis.join('');

  const out: string[] = [];
  const { x, y, w, h } = BUSH_VIEWBOX;
  if (opts.background) out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${pal.bg}"/>`);
  out.push(emit(layers.stems.side, layers.stems.axis));
  out.push(emit(layers.leaves.side, layers.leaves.axis));
  out.push(emit(ranked(layers.items.side, 'side'), ranked(layers.items.axis, 'axis')));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}"${opts.animate ? ' class="anim"' : ''}>${out.join('')}</svg>`;
}

// ---- fillers (local frame: node at origin, pointing up) ----------------------------

function budMarkup(r: number, c1: string, c2: string, pal: Palette): string {
  const L = r * 1.35;
  const base = r * 0.5; // sit the bud a little back down the stem
  let s = '';
  for (const side of [-1, 1]) {
    s += `<g transform="translate(0 ${fmt(base)}) rotate(${side * 38})"><path d="${petalPath({ length: L * 0.55, halfWidth: L * 0.18, bulge: 0.5, pointy: 0.85, notch: 0, curl: side * 0.2 })}" fill="${pal.leaf}"/></g>`;
  }
  s += `<path transform="translate(0 ${fmt(base)})" d="${petalPath({ length: L, halfWidth: L * 0.36, bulge: 0.42, pointy: 0.55, notch: 0, curl: 0 })}" fill="${c1}"/>`;
  s += `<path transform="translate(0 ${fmt(base - L * 0.18)})" d="${petalPath({ length: L * 0.62, halfWidth: L * 0.19, bulge: 0.5, pointy: 0.85, notch: 0, curl: 0 })}" fill="${c2}"/>`;
  return s;
}

function berriesMarkup(r: number, u: number, color: string, pal: Palette): string {
  const k = 3 + pick(u, 3);
  const br = r * 0.27;
  let stems = '', dots = '';
  for (let i = 0; i < k; i++) {
    const a = ((i / (k - 1)) * 2 - 1) * 55 * (Math.PI / 180);
    const d = r * (i % 2 ? 0.75 : 0.55);
    const bx = Math.sin(a) * d, by = r * 0.35 - Math.cos(a) * d;
    stems += `<path d="M0 ${fmt(r * 0.35)} L${fmt(bx)} ${fmt(by)}" stroke="${pal.stem}" stroke-width="${fmt(r * 0.06)}" stroke-linecap="round"/>`;
    dots += `<circle cx="${fmt(bx)}" cy="${fmt(by)}" r="${fmt(br)}" fill="${color}"/>`;
  }
  return stems + dots;
}

function sprigMarkup(r: number, u: number, p: Params, pal: Palette): string {
  const len = r * 1.7;
  const leafPal = u > 0.5 ? { ...pal, leaf: pal.leaf2 } : pal;
  let s = `<path d="M0 ${fmt(r * 0.4)} L0 ${fmt(r * 0.4 - len)}" stroke="${leafPal.leaf}" stroke-width="${fmt(r * 0.07)}" stroke-linecap="round"/>`;
  const pairs = 3;
  for (let i = 0; i < pairs; i++) {
    const t = (i + 0.6) / (pairs + 0.6);
    const ll = r * 0.62 * (1 - t * 0.45);
    const y = r * 0.4 - len * t;
    for (const side of [-1, 1]) {
      s += `<g transform="translate(0 ${fmt(y)}) rotate(${side * 48})">${leafMarkup(ll, ll * 0.28, side * (0.05 + p.curl * 0.3), false, leafPal)}</g>`;
    }
  }
  s += `<g transform="translate(0 ${fmt(r * 0.4 - len)})">${leafMarkup(r * 0.5, r * 0.15, 0, false, leafPal)}</g>`;
  return s;
}
