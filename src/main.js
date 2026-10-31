import { World } from './world.js';
import { Renderer } from './render.js';
import { drawPopulation, drawTree, drawBrain, speciesColor } from './charts.js';
import { TRAITS, T, serialize, deserialize } from './genome.js';
import { seedFromString } from './rng.js';

const $ = (id) => document.getElementById(id);
const canvas = $('pool');

const settings = { temperature: 0.5, nutrients: 1, mutation: 1, autoSeed: true };
const TOOL_RADIUS = { food: 60, nutrients: 80 };
const DIET_LABEL = (d) => (d < 0.35 ? 'grazer' : d < 0.65 ? 'omnivore' : 'hunter');

let world;
let renderer;
let selected = null;
let following = false;
let paused = false;
let speed = 4;
let tool = 'inspect';
let hover = null;
let frameNo = 0;
let treeRows = [];

// ---- pool lifecycle -------------------------------------------------------

function newPool(seedText) {
  let text = String(seedText ?? '').trim();
  if (!text) text = String(Math.floor(Math.random() * 1e9));
  $('seed').value = text;
  window.history.replaceState(null, '', `#seed=${encodeURIComponent(text)}`);
  world = new World({ seed: seedFromString(text), ...settings });
  if (renderer) renderer.setWorld(world);
  else renderer = new Renderer(canvas, world);
  select(null);
  refreshPanels();
}

function select(c) {
  selected = c;
  if (!c) following = false;
  $('inspect-empty').hidden = !!c;
  $('inspect-body').hidden = !c;
  $('i-follow').classList.toggle('active', following);
  if (c) updateInspector();
}

// The oldest living member is the best representative of a species.
function selectSpecies(id) {
  let best = null;
  for (const c of world.creatures) if (c.speciesId === id && (!best || c.age > best.age)) best = c;
  if (best) select(best);
}

// ---- main loop ------------------------------------------------------------

function frame() {
  if (!paused) {
    const start = performance.now();
    for (let i = 0; i < speed; i++) {
      world.step();
      if (performance.now() - start > 14) break; // keep the UI responsive at high speeds
    }
  }

  if (selected && !selected.alive && following) {
    // Follow the lineage: hand over to the youngest living child, if any.
    let heir = null;
    for (const c of world.creatures) if (c.parentId === selected.id && (!heir || c.age < heir.age)) heir = c;
    if (heir) select(heir);
  }
  if (following && selected?.alive) renderer.follow(selected);

  renderer.draw({ selected, hover, toolRadius: TOOL_RADIUS[tool] });

  frameNo++;
  if (frameNo % 4 === 0 && selected) updateInspector();
  if (frameNo % 15 === 0) refreshPanels();
  requestAnimationFrame(frame);
}

function refreshPanels() {
  const living = world.species.living();
  const hunters = world.creatures.filter((c) => c.diet >= 0.65).length;
  $('hud').textContent =
    `tick ${world.tick.toLocaleString()} · ${world.creatures.length} creatures · ` +
    `${living.length} species · gen ${world.stats.maxGeneration}${paused ? ' · paused' : ''}`;

  const top = drawPopulation($('popchart'), world).filter((sp) => sp.count > 0).slice(0, 6);
  $('legend').replaceChildren(...top.map((sp) => {
    const b = document.createElement('button');
    b.innerHTML = `<span class="swatch" style="background:${speciesColor(sp)}"></span>${sp.name} ${sp.count}`;
    b.title = `Inspect the oldest ${sp.name}`;
    b.onclick = () => selectSpecies(sp.id);
    return b;
  }));

  const s = world.stats;
  $('stats').innerHTML = [
    ['births', s.births], ['deaths', s.deaths], ['kills', s.kills], ['hunters alive', hunters],
    ['species ever', world.species.nextId - 1], ['reseeded', s.reseeds],
    ['forage rate', world.forageRate().toFixed(3)], ['oldest gen', s.maxGeneration],
  ].map(([k, v]) => `<span>${k}</span><b>${typeof v === 'number' ? v.toLocaleString() : v}</b>`).join('');

  treeRows = drawTree($('tree'), world, selected?.speciesId);
}

function updateInspector() {
  const c = selected;
  const sp = world.species.get(c.speciesId);
  $('i-swatch').style.background = `hsl(${c.genome.traits[T.hue] * 360}, 60%, 60%)`;
  $('i-name').textContent = `${sp?.name ?? 'Unknown'} #${c.id}`;
  $('i-status').textContent = c.alive ? DIET_LABEL(c.diet) : `died: ${c.cause}`;
  const facts = [
    ['age', `${c.age}/${Math.round(c.maxAge)}`], ['gen', c.generation],
    ['children', c.children], ['kills', c.kills],
    ['energy', `${Math.max(0, c.energy).toFixed(0)}/${c.maxEnergy.toFixed(0)}`],
    ['food/tick', c.age ? (c.intake / c.age).toFixed(3) : '-'],
  ];
  $('i-facts').innerHTML = facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('i-energy').style.width = `${Math.max(0, Math.min(1, c.energy / c.maxEnergy)) * 100}%`;
  $('i-traits').innerHTML = TRAITS.map((name, i) => {
    const v = c.genome.traits[i];
    const fill = name === 'hue' ? `hsl(${v * 360},60%,60%)` : '';
    return `<span>${name}</span><div class="t"><span style="width:${v * 100}%;${fill && `background:${fill}`}"></span></div>`;
  }).join('');
  drawBrain($('brain'), c);
}

// ---- pool interaction ---------------------------------------------------

function setTool(name) {
  tool = name;
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === name);
  canvas.classList.toggle('painting', name !== 'inspect');
}

function applyTool(p) {
  if (tool === 'food') world.addFood(p.x, p.y, TOOL_RADIUS.food);
  else if (tool === 'nutrients') world.addNutrients(p.x, p.y, TOOL_RADIUS.nutrients);
  else if (tool === 'hunters') world.spawnHunters(5, p.x, p.y);
}

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = renderer.screenToWorld(e.offsetX, e.offsetY);
  drag = { sx: e.offsetX, sy: e.offsetY, moved: false, pan: tool === 'inspect' || e.button !== 0, last: p };
  if (!drag.pan) applyTool(p);
});
canvas.addEventListener('pointermove', (e) => {
  hover = renderer.screenToWorld(e.offsetX, e.offsetY);
  if (!drag) return;
  if (drag.pan) {
    if (Math.hypot(e.offsetX - drag.sx, e.offsetY - drag.sy) > 4) drag.moved = true;
    if (drag.moved) {
      renderer.pan(e.movementX, e.movementY);
      following = false;
      $('i-follow').classList.remove('active');
    }
  } else if (tool !== 'hunters' && Math.hypot(hover.x - drag.last.x, hover.y - drag.last.y) > 25) {
    applyTool(hover);
    drag.last = hover;
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (drag?.pan && !drag.moved && e.button === 0) {
    const p = renderer.screenToWorld(e.offsetX, e.offsetY);
    select(world.findCreature(p.x, p.y, 8 / renderer.camera.zoom + 4));
  }
  drag = null;
});
canvas.addEventListener('pointerleave', () => { hover = null; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // right-drag pans
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  renderer.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

$('tree').addEventListener('click', (e) => {
  const row = treeRows.find((r) => Math.abs(r.y - e.offsetY) <= r.h / 2);
  if (row) selectSpecies(row.id);
});

// ---- controls -------------------------------------------------------------

function setPaused(p) {
  paused = p;
  $('play').textContent = paused ? 'Play' : 'Pause';
  refreshPanels();
}

function setSpeed(s) {
  speed = s;
  for (const b of document.querySelectorAll('[data-speed]')) b.classList.toggle('active', Number(b.dataset.speed) === s);
}

for (const b of document.querySelectorAll('[data-tool]')) b.onclick = () => setTool(b.dataset.tool);
for (const b of document.querySelectorAll('[data-speed]')) b.onclick = () => setSpeed(Number(b.dataset.speed));
$('play').onclick = () => setPaused(!paused);
$('storm').onclick = () => world.storm();
$('fit').onclick = () => { following = false; renderer.fit(); };
$('restart').onclick = () => newPool($('seed').value);
$('random-seed').onclick = () => newPool('');
$('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') newPool($('seed').value); });

for (const key of ['temperature', 'nutrients', 'mutation']) {
  const input = $(key);
  const show = () => { $(`${key}-out`).textContent = Number(input.value).toFixed(2); };
  input.value = settings[key];
  show();
  input.addEventListener('input', () => {
    settings[key] = Number(input.value);
    world.cfg[key] = settings[key];
    show();
  });
}
$('autoSeed').checked = settings.autoSeed;
$('autoSeed').addEventListener('change', () => {
  settings.autoSeed = $('autoSeed').checked;
  world.cfg.autoSeed = settings.autoSeed;
});

$('i-follow').onclick = () => {
  following = !following;
  $('i-follow').classList.toggle('active', following);
};
$('i-close').onclick = () => select(null);
$('i-clone').onclick = () => {
  if (selected) world.release(selected.genome, 5, selected.x, selected.y);
};
$('i-export').onclick = async () => {
  if (!selected) return;
  const text = serialize(selected.genome);
  $('import-text').value = text;
  try {
    await navigator.clipboard.writeText(text);
    $('import-msg').textContent = 'Genome copied to the clipboard (and shown above).';
  } catch {
    $('import-msg').textContent = 'Genome shown above. Copy it from there.';
  }
};
$('import').onclick = () => {
  try {
    const g = deserialize($('import-text').value);
    const at = renderer.screenToWorld(renderer.w / 2, renderer.h / 2);
    world.release(g, 3, at.x, at.y);
    $('import-msg').textContent = 'Released 3 copies at the centre of the view.';
  } catch (err) {
    $('import-msg').textContent = err.message;
  }
};

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  const speeds = [1, 2, 4, 8, 16, 32];
  if (e.key === ' ') { e.preventDefault(); setPaused(!paused); }
  else if (e.key === 'f' || e.key === 'F') { if (selected) $('i-follow').click(); }
  else if (e.key === 'Escape') select(null);
  else if (e.key === '+' || e.key === '=') setSpeed(speeds[Math.min(5, speeds.indexOf(speed) + 1)]);
  else if (e.key === '-') setSpeed(speeds[Math.max(0, speeds.indexOf(speed) - 1)]);
  else if (e.key === 'i' || e.key === 'I') setTool('inspect');
  else if (e.key === 'g' || e.key === 'G') setTool('food');
  else if (e.key === 'n' || e.key === 'N') setTool('nutrients');
  else if (e.key === 'h' || e.key === 'H') setTool('hunters');
});
window.addEventListener('resize', () => renderer.resize());

// ---- start ----------------------------------------------------------------

// URL hash options: #seed=reef&warm=8000&inspect
// `warm` pre-runs that many ticks so a link can open on an already-evolved pool;
// `inspect` then selects the oldest creature.
const params = new URLSearchParams(window.location.hash.slice(1));
newPool(params.get('seed') ?? '');
const warm = Math.min(50000, Number(params.get('warm')) || 0);
for (let i = 0; i < warm; i++) world.step();
if (params.has('inspect') && world.creatures.length) {
  select(world.creatures.reduce((a, b) => (b.age > a.age ? b : a)));
}
refreshPanels();
setSpeed(speed);
requestAnimationFrame(frame);
