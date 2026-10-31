import { N_IN, N_HID, N_WEIGHTS, W1, W2, B2 } from './brain.js';

// Every trait lives in [0, 1]; hue wraps around.
export const TRAITS = ['size', 'speed', 'hue', 'vision', 'diet', 'mutation', 'fertility', 'clock'];
export const T = Object.fromEntries(TRAITS.map((name, i) => [name, i]));

const WEIGHT_LIMIT = 4;

export function randomGenome(rng, { diet = rng.range(0, 0.3) } = {}) {
  const traits = new Float32Array(TRAITS.length);
  for (let i = 0; i < traits.length; i++) traits[i] = rng.next();
  traits[T.diet] = diet;
  traits[T.mutation] = rng.range(0.2, 0.6);
  const weights = new Float32Array(N_WEIGHTS);
  for (let i = 0; i < weights.length; i++) weights[i] = rng.gauss() * 0.7;
  return { traits, weights };
}

// A hand-wired predator: steer toward whatever is nearby, chase it, bite it,
// but leave look-alikes alone. Released by the "hunters" tool, then left to evolve.
export function hunterGenome(rng) {
  const g = randomGenome(rng, { diet: rng.range(0.85, 1) });
  for (let i = 0; i < g.weights.length; i++) g.weights[i] *= 0.15;
  g.traits[T.size] = rng.range(0.55, 0.8);
  g.traits[T.speed] = rng.range(0.6, 0.85);
  g.traits[T.vision] = rng.range(0.6, 0.9);
  g.traits[T.hue] = (0.97 + rng.range(0, 0.06)) % 1;
  g.traits[T.fertility] = rng.range(0.3, 0.5);
  const w = g.weights;
  const toHidden = (j, input, v) => { w[W1 + j * N_IN + input] = v; };
  const toOutput = (k, j, v) => { w[W2 + k * N_HID + j] = v; };
  toHidden(0, 5, 3); // h0: which side the prey is on
  toHidden(1, 4, 3); // h1: how close it is
  toHidden(2, 10, 3); // h2: wall ahead
  toHidden(3, 8, 4); // h3: looks like kin
  toOutput(0, 0, 2.5); // turn toward prey
  toOutput(0, 2, 1.5); // turn away from walls
  toOutput(1, 1, 2); // speed up when prey is close
  w[B2 + 1] = 0.4; // cruise otherwise
  w[B2 + 2] = 1.5; // bite by default...
  toOutput(2, 3, -3); // ...unless it is kin
  w[B2 + 3] = 1; // breed when able
  return g;
}

export function mutate(parent, rng, strength = 1) {
  const m = parent.traits[T.mutation];
  const rate = (0.01 + 0.12 * m) * strength;
  const scale = 0.04 + 0.3 * m;
  const traits = Float32Array.from(parent.traits);
  const weights = Float32Array.from(parent.weights);
  for (let i = 0; i < traits.length; i++) {
    if (rng.next() < rate * 2) traits[i] += rng.gauss() * scale * 0.25;
    traits[i] = i === T.hue ? ((traits[i] % 1) + 1) % 1 : Math.min(1, Math.max(0, traits[i]));
  }
  for (let i = 0; i < weights.length; i++) {
    if (rng.next() >= rate) continue;
    weights[i] = rng.next() < 0.05 ? rng.gauss() * 0.7 : weights[i] + rng.gauss() * scale;
    weights[i] = Math.min(WEIGHT_LIMIT, Math.max(-WEIGHT_LIMIT, weights[i]));
  }
  return { traits, weights };
}

export function traitDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = Math.abs(a[i] - b[i]);
    if (i === T.hue) x = Math.min(x, 1 - x);
    d += x;
  }
  return d / a.length;
}

export function geneticDistance(a, b) {
  let w = 0;
  for (let i = 0; i < a.weights.length; i++) w += Math.abs(a.weights[i] - b.weights[i]);
  return traitDistance(a.traits, b.traits) + (w / a.weights.length) * 0.5;
}

export function serialize(genome) {
  const round = (x) => Math.round(x * 10000) / 10000;
  return JSON.stringify({
    tidepool: 1,
    traits: Array.from(genome.traits, round),
    weights: Array.from(genome.weights, round),
  });
}

export function deserialize(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That is not valid JSON.');
  }
  const ok = (arr, n) => Array.isArray(arr) && arr.length === n && arr.every(Number.isFinite);
  if (!data || data.tidepool !== 1 || !ok(data.traits, TRAITS.length) || !ok(data.weights, N_WEIGHTS)) {
    throw new Error('That does not look like an exported Tidepool creature.');
  }
  const traits = Float32Array.from(data.traits, (x, i) =>
    i === T.hue ? ((x % 1) + 1) % 1 : Math.min(1, Math.max(0, x)));
  const weights = Float32Array.from(data.weights, (x) => Math.min(WEIGHT_LIMIT, Math.max(-WEIGHT_LIMIT, x)));
  return { traits, weights };
}
