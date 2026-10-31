import { INPUTS, OUTPUTS, N_IN, N_HID, N_OUT, W1, W2 } from './brain.js';

const TOP_SPECIES = 12;
const MAX_TREE_ROWS = 34;

function prepare(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

export const speciesColor = (sp, alpha = 1) => `hsla(${sp.hue * 360}, 60%, ${sp.diet > 0.5 ? 52 : 62}%, ${alpha})`;

// Stacked population by species, the biggest lineages coloured, the rest grey.
// Returns the coloured species so the caller can build a legend.
export function drawPopulation(canvas, world) {
  const { ctx, w, h } = prepare(canvas);
  const hist = world.history;
  if (hist.length < 2) return [];

  // Rank by area on the chart, weighted toward the recent past.
  const weight = new Map();
  hist.forEach((s, n) => {
    const recency = 0.25 + (n / hist.length) ** 2;
    for (let i = 0; i < s.counts.length; i += 2) {
      weight.set(s.counts[i], (weight.get(s.counts[i]) ?? 0) + s.counts[i + 1] * recency);
    }
  });
  const top = [...weight.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_SPECIES).map(([id]) => id);
  const slot = new Map(top.map((id, i) => [id, i]));
  const maxPop = Math.max(10, ...hist.map((s) => s.pop));
  const t0 = hist[0].tick;
  const t1 = hist[hist.length - 1].tick;
  const pad = 4;
  const x = (t) => pad + ((t - t0) / Math.max(1, t1 - t0)) * (w - pad * 2);
  const y = (v) => h - pad - (v / maxPop) * (h - pad * 2 - 12);

  // cumulative[sample][band]; band TOP_SPECIES is "everyone else".
  const cum = hist.map((s) => {
    const bands = new Array(top.length + 1).fill(0);
    for (let i = 0; i < s.counts.length; i += 2) {
      const k = slot.get(s.counts[i]);
      bands[k ?? top.length] += s.counts[i + 1];
    }
    const out = [0];
    for (const v of bands) out.push(out[out.length - 1] + v);
    return out;
  });

  const bandColors = top.map((id) => {
    const sp = world.species.get(id);
    return sp ? speciesColor(sp, 0.85) : 'rgba(120,140,150,0.6)';
  });
  bandColors.push('rgba(120,140,150,0.45)');

  for (let k = 0; k <= top.length; k++) {
    ctx.beginPath();
    hist.forEach((s, i) => ctx.lineTo(x(s.tick), y(cum[i][k + 1])));
    for (let i = hist.length - 1; i >= 0; i--) ctx.lineTo(x(hist[i].tick), y(cum[i][k]));
    ctx.closePath();
    ctx.fillStyle = bandColors[k];
    ctx.fill();
    ctx.strokeStyle = 'rgba(6, 24, 32, 0.7)'; // separates neighbouring lineages of similar hue
    ctx.lineWidth = 0.75;
    ctx.stroke();
  }

  // Algae level on its own 0..1 scale, so food crashes are visible.
  ctx.strokeStyle = 'rgba(150, 240, 150, 0.8)';
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  hist.forEach((s) => ctx.lineTo(x(s.tick), h - pad - Math.min(1, s.algae * 4) * (h - pad * 2 - 12)));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(220,235,240,0.7)';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(`${maxPop}`, pad, 10);
  ctx.textAlign = 'right';
  ctx.fillText(`tick ${t1.toLocaleString()}`, w - pad, 10);
  ctx.textAlign = 'left';

  return top.map((id) => world.species.get(id)).filter(Boolean);
}

// Phylogeny: one row per notable species, a line from birth to extinction (or
// now), joined to its parent at the moment it split off.
// Returns [{ id, y }] so clicks can be mapped back to species.
export function drawTree(canvas, world, highlightId) {
  const { ctx, w, h } = prepare(canvas);
  const all = world.species.map;
  if (!world.tick) return [];

  let minPeak = 6;
  let shown;
  for (;;) {
    shown = new Set();
    for (const sp of all.values()) {
      if (sp.peak < minPeak && !(sp.count >= 3 && sp.peak >= minPeak / 2)) continue;
      for (let s = sp; s && !shown.has(s.id); s = all.get(s.parent)) shown.add(s.id);
    }
    if (shown.size <= MAX_TREE_ROWS) break;
    minPeak = Math.ceil(minPeak * 1.4);
  }

  const children = new Map();
  const roots = [];
  for (const id of shown) {
    const sp = all.get(id);
    if (sp.parent != null && shown.has(sp.parent)) {
      if (!children.has(sp.parent)) children.set(sp.parent, []);
      children.get(sp.parent).push(sp);
    } else {
      roots.push(sp);
    }
  }
  const order = [];
  const visit = (sp) => {
    order.push(sp);
    for (const c of (children.get(sp.id) ?? []).sort((a, b) => a.born - b.born)) visit(c);
  };
  roots.sort((a, b) => a.born - b.born).forEach(visit);

  const pad = 6;
  const labelRoom = 70;
  const rowH = Math.min(14, (h - pad * 2) / Math.max(1, order.length));
  const x = (t) => pad + (t / world.tick) * (w - pad * 2 - labelRoom);
  const rowY = new Map(order.map((sp, i) => [sp.id, pad + rowH * (i + 0.5)]));

  // Label the biggest living species, skipping any that would overlap.
  const labelled = new Set(order.filter((sp) => sp.count > 0).sort((a, b) => b.count - a.count).slice(0, 8)
    .sort((a, b) => rowY.get(a.id) - rowY.get(b.id))
    .filter((sp, i, arr) => i === 0 || rowY.get(sp.id) - rowY.get(arr[i - 1].id) >= 10)
    .map((sp) => sp.id));

  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const sp of order) {
    const y = rowY.get(sp.id);
    const alive = sp.count > 0;
    const end = sp.extinct ?? world.tick;
    const parentY = rowY.get(sp.parent);
    if (parentY !== undefined) {
      ctx.strokeStyle = 'rgba(200,220,230,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x(sp.born), parentY);
      ctx.lineTo(x(sp.born), y);
      ctx.stroke();
    }
    ctx.strokeStyle = speciesColor(sp, alive ? 1 : 0.4);
    ctx.lineWidth = Math.min(rowH - 2, 1 + Math.log2(1 + sp.peak) * 0.9);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x(sp.born), y);
    ctx.lineTo(Math.max(x(sp.born) + 1, x(end)), y);
    ctx.stroke();
    if (sp.id === highlightId) {
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1;
      ctx.strokeRect(x(sp.born) - 3, y - rowH / 2 + 1, x(end) - x(sp.born) + 6, rowH - 2);
    }
    if (labelled.has(sp.id)) {
      ctx.fillStyle = 'rgba(230,240,245,0.85)';
      ctx.fillText(`${sp.name} ${sp.count}`, x(end) + 6, y);
    }
  }
  ctx.lineCap = 'butt';
  return order.map((sp) => ({ id: sp.id, y: rowY.get(sp.id), h: rowH }));
}

// Live view of a creature's network: node colour is activation, line
// brightness is how much signal flows along each weight right now.
export function drawBrain(canvas, c) {
  const { ctx, w, h } = prepare(canvas);
  const b = c.brain;
  const xs = [96, w * 0.56, w - 50];
  const spread = (n, i) => 8 + ((h - 16) * (i + 0.5)) / n;
  const yIn = (i) => spread(N_IN, i);
  const yHid = (j) => spread(N_HID, j);
  const yOut = (k) => spread(N_OUT, k);

  const link = (x0, y0, x1, y1, signal) => {
    const a = Math.min(0.9, Math.abs(signal) * 0.6) + 0.03;
    ctx.strokeStyle = signal >= 0 ? `rgba(110,210,255,${a})` : `rgba(255,120,140,${a})`;
    ctx.lineWidth = 0.5 + Math.min(2, Math.abs(signal));
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  for (let j = 0; j < N_HID; j++) {
    for (let i = 0; i < N_IN; i++) link(xs[0], yIn(i), xs[1], yHid(j), b.w[W1 + j * N_IN + i] * b.input[i]);
  }
  for (let k = 0; k < N_OUT; k++) {
    for (let j = 0; j < N_HID; j++) link(xs[1], yHid(j), xs[2], yOut(k), b.w[W2 + k * N_HID + j] * b.hidden[j]);
  }

  const node = (x, y, v) => {
    const t = Math.max(-1, Math.min(1, v));
    ctx.fillStyle = t >= 0 ? `rgba(110,210,255,${0.25 + 0.75 * t})` : `rgba(255,120,140,${0.25 - 0.75 * t})`;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(220,235,240,0.8)';
  ctx.textAlign = 'right';
  INPUTS.forEach((label, i) => ctx.fillText(label, xs[0] - 9, yIn(i)));
  ctx.textAlign = 'left';
  OUTPUTS.forEach((label, k) => ctx.fillText(label, xs[2] + 9, yOut(k)));
  for (let i = 0; i < N_IN; i++) node(xs[0], yIn(i), b.input[i]);
  for (let j = 0; j < N_HID; j++) node(xs[1], yHid(j), b.hidden[j]);
  for (let k = 0; k < N_OUT; k++) node(xs[2], yOut(k), b.output[k]);
}
