import './style.css';
import { renderBloom, DNA_LEN, CDNA_LEN, VIEWBOX, type Params, type RenderOpts } from './bloom';
import { renderBush, BDNA_LEN, BUSH_VIEWBOX, type BushParams } from './bush';
import { PALETTES } from './palettes';
import { mulberry32, randomGenes, mutateGenes } from './rng';

interface Specimen {
  dna: number[];   // flower shape
  cdna: number[];  // flower colors
  bdna: number[];  // bush layout
}
type Mode = 'flower' | 'bush';

const rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
const fresh = (): Specimen => ({
  dna: randomGenes(DNA_LEN, rng),
  cdna: randomGenes(CDNA_LEN, rng),
  bdna: randomGenes(BDNA_LEN, rng),
});

const state = {
  mode: 'flower' as Mode,
  current: fresh(),
  params: { lush: 0.55, open: 0.3, shape: 0.45, curl: 0.35 } as Params,
  bush: { density: 0.4, mirror: true } as BushParams,
  mutation: 0.35,
  palette: 0,
  children: [] as Specimen[],
  undo: [] as Specimen[],
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const stage = $('#stage');
const grid = $('#grid');
const palettesEl = $('#palettes');
const pal = () => PALETTES[state.palette];

function render(s: Specimen, opts: RenderOpts): string {
  return state.mode === 'bush'
    ? renderBush(s, state.params, state.bush, pal(), opts)
    : renderBloom(s.dna, s.cdna, state.params, pal(), opts);
}

// ---- breeding ---------------------------------------------------------------

function breed() {
  const amt = 0.03 + state.mutation * 0.3;
  const relayout = state.mode === 'bush' ? 0.2 + state.mutation * 0.6 : 0;
  state.children = Array.from({ length: 9 }, () => ({
    dna: mutateGenes(state.current.dna, rng, amt, state.mutation * 0.12),
    cdna: rng() < state.mutation * 0.6 ? mutateGenes(state.current.cdna, rng, 0.35, 0.2) : [...state.current.cdna],
    bdna: rng() < relayout ? randomGenes(BDNA_LEN, rng) : [...state.current.bdna],
  }));
}

function adopt(next: Specimen) {
  state.undo.push(state.current);
  if (state.undo.length > 100) state.undo.shift();
  state.current = next;
  breed();
  renderAll(true);
}

// ---- rendering --------------------------------------------------------------

function renderStage(animate: boolean) {
  stage.innerHTML = render(state.current, { animate });
}

function renderGrid(animate: boolean) {
  // Bushes have thousands of petals; animating each one in nine thumbnails at
  // once is too heavy, so bush thumbnails pop in as whole cards instead.
  const perPetal = animate && state.mode === 'flower';
  grid.replaceChildren(
    ...state.children.map((c, i) => {
      const b = document.createElement('button');
      b.className = 'child';
      b.title = `Pick (${i + 1})`;
      b.style.setProperty('--stagger', `${i * 45}ms`);
      b.innerHTML = render(c, { animate: perPetal });
      if (animate && !perPetal) b.classList.add('fresh');
      b.onclick = () => adopt(state.children[i]);
      return b;
    }),
  );
}

function renderChrome() {
  palettesEl.replaceChildren(
    ...PALETTES.map((p, i) => {
      const b = document.createElement('button');
      b.className = 'pal' + (i === state.palette ? ' active' : '');
      b.innerHTML =
        `<span class="sw" style="background:${p.bg}">` +
        [p.leaf, ...p.blooms].map((c) => `<span style="background:${c}"></span>`).join('') +
        `</span>${p.name}`;
      b.onclick = () => {
        state.palette = i;
        renderAll(false);
      };
      return b;
    }),
  );
  document.documentElement.style.setProperty('--stage-bg', pal().bg);
  document.body.dataset.mode = state.mode;
  for (const b of document.querySelectorAll<HTMLElement>('[data-mode]')) {
    b.setAttribute('aria-selected', String(b.dataset.mode === state.mode));
  }
  $('#new').textContent = state.mode === 'bush' ? '❀ New bush' : '✿ New bloom';
  $('#link').textContent = `Copy link to this ${state.mode}`;
}

function renderAll(animate: boolean) {
  renderChrome();
  renderStage(animate);
  renderGrid(animate);
  saveHash();
}

// Slider drags re-render at most once per frame, without the grow animation.
let raf = 0;
function renderLive() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    renderStage(false);
    renderGrid(false);
    saveHash();
  });
}

// ---- URL sharing --------------------------------------------------------------

const HASH_VERSION = 2;
const HEADER = 10;
const V1_HEADER = 7;

function encode(): string {
  const { lush, open, shape, curl } = state.params;
  const { dna, cdna, bdna } = state.current;
  const bytes = [
    HASH_VERSION,
    state.palette,
    state.mode === 'bush' ? 1 : 0,
    state.bush.mirror ? 1 : 0,
    ...[lush, open, shape, curl, state.mutation, state.bush.density, ...dna, ...cdna, ...bdna].map((v) => Math.round(v * 255)),
  ];
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(s: string): boolean {
  try {
    const b = Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const f = b.map((v) => v / 255);
    state.palette = Math.min(b[1], PALETTES.length - 1);
    if (b[0] === 1 && b.length === V1_HEADER + DNA_LEN + CDNA_LEN) {
      state.params = { lush: f[2], open: f[3], shape: f[4], curl: f[5] };
      state.mutation = f[6];
      state.current = { ...state.current, dna: f.slice(V1_HEADER, V1_HEADER + DNA_LEN), cdna: f.slice(V1_HEADER + DNA_LEN) };
      return true;
    }
    if (b[0] !== HASH_VERSION || b.length !== HEADER + DNA_LEN + CDNA_LEN + BDNA_LEN) return false;
    state.mode = b[2] ? 'bush' : 'flower';
    state.bush = { mirror: !!b[3], density: f[9] };
    state.params = { lush: f[4], open: f[5], shape: f[6], curl: f[7] };
    state.mutation = f[8];
    const c0 = HEADER + DNA_LEN, b0 = c0 + CDNA_LEN;
    state.current = { dna: f.slice(HEADER, c0), cdna: f.slice(c0, b0), bdna: f.slice(b0) };
    return true;
  } catch {
    return false;
  }
}

function saveHash() {
  history.replaceState(null, '', '#' + encode());
}

// ---- export -----------------------------------------------------------------

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const exportSvg = () => render(state.current, { background: true });

function savePng() {
  const box = state.mode === 'bush' ? BUSH_VIEWBOX : VIEWBOX;
  const scale = 2000 / box.w;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([exportSvg()], { type: 'image/svg+xml' }));
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(box.w * scale);
    canvas.height = Math.round(box.h * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((b) => b && download(b, `kuviot-${Date.now()}.png`));
  };
  img.src = url;
}

let toastTimer = 0;
function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 1600);
}

// ---- actions & wiring -----------------------------------------------------------

function setMode(mode: Mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  breed();
  renderAll(true);
}

const actions = {
  new: () => adopt(fresh()),
  colors: () => adopt({ ...state.current, cdna: randomGenes(CDNA_LEN, rng) }),
  layout: () => adopt({ ...state.current, bdna: randomGenes(BDNA_LEN, rng) }),
  undo: () => {
    const prev = state.undo.pop();
    if (!prev) return toast('Nothing to undo');
    state.current = prev;
    breed();
    renderAll(true);
  },
  svg: () => download(new Blob([exportSvg()], { type: 'image/svg+xml' }), `kuviot-${Date.now()}.svg`),
  png: savePng,
  link: () => navigator.clipboard.writeText(location.href).then(() => toast('Link copied ✿')),
  rebreed: () => {
    breed();
    renderGrid(true);
  },
};

for (const [id, fn] of Object.entries(actions)) {
  $(`#${id}`).addEventListener('click', (e) => {
    fn();
    (e.currentTarget as HTMLElement).blur(); // so Space doesn't re-trigger the button
  });
}

for (const b of document.querySelectorAll<HTMLElement>('[data-mode]')) {
  b.addEventListener('click', () => {
    setMode(b.dataset.mode as Mode);
    b.blur();
  });
}

const paramInputs = document.querySelectorAll<HTMLInputElement>('input[data-param]');
for (const input of paramInputs) {
  const key = input.dataset.param as keyof Params;
  input.addEventListener('input', () => {
    state.params[key] = Number(input.value);
    renderLive();
  });
}

const mutationInput = $<HTMLInputElement>('#mutation');
mutationInput.addEventListener('input', () => {
  state.mutation = Number(mutationInput.value);
});
mutationInput.addEventListener('change', () => {
  breed();
  renderGrid(true);
  saveHash();
});

const densityInput = $<HTMLInputElement>('#density');
densityInput.addEventListener('input', () => {
  state.bush.density = Number(densityInput.value);
  renderLive();
});

const mirrorInput = $<HTMLInputElement>('#mirror');
mirrorInput.addEventListener('change', () => {
  state.bush.mirror = mirrorInput.checked;
  renderAll(true);
});

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    e.preventDefault();
    actions.new();
  } else if (k === 'c') actions.colors();
  else if (k === 'z') actions.undo();
  else if (k === 'b') setMode(state.mode === 'bush' ? 'flower' : 'bush');
  else if (k === 'l' && state.mode === 'bush') actions.layout();
  else if (/^[1-9]$/.test(k)) adopt(state.children[Number(k) - 1]);
});

// ---- boot -------------------------------------------------------------------

decode(location.hash.slice(1));
for (const input of paramInputs) input.value = String(state.params[input.dataset.param as keyof Params]);
mutationInput.value = String(state.mutation);
densityInput.value = String(state.bush.density);
mirrorInput.checked = state.bush.mirror;
breed();
renderAll(true);
