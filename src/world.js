import { Rng } from './rng.js';
import { Brain } from './brain.js';
import { T, randomGenome, hunterGenome, mutate, traitDistance } from './genome.js';
import { SpeciesRegistry } from './species.js';

export const ALGAE_MAX = 10;
const ALGAE_ENERGY = 4;
const GRID = 80; // spatial-hash bucket size, world units
const HISTORY_EVERY = 25;
const HISTORY_MAX = 800;
const RECENT_DEATHS = 300;

export const DEFAULTS = {
  seed: 1,
  width: 1600,
  height: 1000,
  cell: 20,
  patches: 7,
  initialPop: 160,
  minPop: 30,
  maxPop: 800,
  temperature: 0.5,
  nutrients: 1,
  mutation: 1,
  speciesThreshold: 0.12,
  autoSeed: true,
  reproduction: true,
};

const massOf = (sizeTrait) => ((3 + sizeTrait * 6) / 5) ** 2;

export class Creature {
  constructor(id, genome, x, y, angle, energy, generation, parentId, speciesId) {
    const t = genome.traits;
    this.id = id;
    this.genome = genome;
    this.brain = new Brain(genome.weights);
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.angle = angle;
    this.generation = generation;
    this.parentId = parentId;
    this.speciesId = speciesId;

    this.radius = 3 + t[T.size] * 6;
    this.mass = massOf(t[T.size]);
    this.maxEnergy = 100 * this.mass;
    this.energy = Math.min(energy, this.maxEnergy);
    this.vision = 40 + t[T.vision] * 140;
    this.diet = t[T.diet];
    this.plantEff = (1 - this.diet) ** 1.5;
    this.meatEff = this.diet ** 1.5;
    this.accel = (0.08 + t[T.speed] * 0.17) / Math.sqrt(this.mass);
    this.turnRate = 0.14 * (1.3 - t[T.size] * 0.6);
    this.breedAt = 0.45 + 0.45 * t[T.fertility];
    this.clockFreq = 0.01 + t[T.clock] * 0.2;
    this.maxAge = 1500 + 2000 * t[T.size];

    this.age = 0;
    this.alive = true;
    this.cause = null;
    this.intake = 0;
    this.kills = 0;
    this.children = 0;
    this.hurt = 0;
    this.thrust = 0;
    this.attacking = false;
    this.seen = null;
    this.phase = 0; // render-only tail animation
  }
}

export class World {
  constructor(options = {}) {
    this.cfg = { ...DEFAULTS, ...options };
    const { width, height, cell } = this.cfg;
    this.width = width;
    this.height = height;
    this.cell = cell;
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(height / cell);
    this.rng = new Rng(this.cfg.seed);

    const n = this.cols * this.rows;
    this.algae = new Float32Array(n);
    this.fertility = new Float32Array(n);
    this.bonus = new Float32Array(n); // nutrients from decaying bodies and the nutrient tool
    this.buildFertility();
    for (let i = 0; i < n; i++) this.algae[i] = this.fertility[i] * ALGAE_MAX * 0.6;

    this.gridCols = Math.ceil(width / GRID);
    this.gridRows = Math.ceil(height / GRID);
    this.buckets = Array.from({ length: this.gridCols * this.gridRows }, () => []);

    this.creatures = [];
    this.newborns = [];
    this.nextId = 1;
    this.tick = 0;
    this.species = new SpeciesRegistry(this.cfg.speciesThreshold);
    this.stats = { births: 0, deaths: 0, kills: 0, reseeds: 0, maxGeneration: 0, recent: [] };
    this.history = [];

    for (let i = 0; i < this.cfg.initialPop; i++) this.spawnRandom();
    this.record();
  }

  buildFertility() {
    const { rng, cell } = this;
    const blobs = [];
    for (let k = 0; k < this.cfg.patches; k++) {
      blobs.push({
        x: rng.range(0, this.width),
        y: rng.range(0, this.height),
        s: rng.range(70, 220),
        a: rng.range(0.5, 1),
      });
    }
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = (c + 0.5) * cell;
        const y = (r + 0.5) * cell;
        let f = 0.04;
        for (const b of blobs) {
          const d2 = (x - b.x) ** 2 + (y - b.y) ** 2;
          f += b.a * Math.exp(-d2 / (2 * b.s * b.s));
        }
        this.fertility[r * this.cols + c] = Math.min(1, f);
      }
    }
  }

  cellIndex(x, y) {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)));
    return r * this.cols + c;
  }

  algaeAt(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.algae[this.cellIndex(x, y)];
  }

  // ---- populating -------------------------------------------------------

  spawn(genome, x, y, { speciesId, energy, generation = 0, parentId = null } = {}) {
    const sp = speciesId ?? this.species.found(genome, null, this.tick).id;
    const c = new Creature(
      this.nextId++, genome,
      Math.min(this.width - 1, Math.max(1, x)), Math.min(this.height - 1, Math.max(1, y)),
      this.rng.range(0, Math.PI * 2),
      energy ?? 100 * massOf(genome.traits[T.size]) * 0.5,
      generation, parentId, sp,
    );
    this.creatures.push(c);
    this.species.add(sp);
    return c;
  }

  spawnRandom() {
    return this.spawn(randomGenome(this.rng), this.rng.range(0, this.width), this.rng.range(0, this.height));
  }

  spawnHunters(n, x, y) {
    let speciesId;
    for (let i = 0; i < n; i++) {
      const g = hunterGenome(this.rng);
      const c = this.spawn(g, x + this.rng.gauss() * 20, y + this.rng.gauss() * 20, { speciesId });
      c.energy = c.maxEnergy * 0.8;
      speciesId = c.speciesId;
    }
  }

  // Release copies of an imported or cloned genome as one shared species.
  release(genome, n, x, y) {
    let speciesId;
    for (let i = 0; i < n; i++) {
      const c = this.spawn(genome, x + this.rng.gauss() * 20, y + this.rng.gauss() * 20, { speciesId });
      speciesId = c.speciesId;
    }
  }

  // ---- interventions ----------------------------------------------------

  forCellsNear(x, y, radius, fn) {
    const { cell, cols, rows } = this;
    const c0 = Math.max(0, Math.floor((x - radius) / cell));
    const c1 = Math.min(cols - 1, Math.floor((x + radius) / cell));
    const r0 = Math.max(0, Math.floor((y - radius) / cell));
    const r1 = Math.min(rows - 1, Math.floor((y + radius) / cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = Math.hypot((c + 0.5) * cell - x, (r + 0.5) * cell - y);
        if (d < radius) fn(r * cols + c, 1 - d / radius);
      }
    }
  }

  addFood(x, y, radius = 60) {
    this.forCellsNear(x, y, radius, (i, k) => {
      this.algae[i] = Math.min(ALGAE_MAX, this.algae[i] + ALGAE_MAX * 0.6 * k);
    });
  }

  addNutrients(x, y, radius = 80) {
    this.forCellsNear(x, y, radius, (i, k) => {
      this.bonus[i] = Math.min(1, this.bonus[i] + 0.5 * k);
    });
  }

  // Throw everyone around and smear the algae across the pool.
  storm() {
    for (const c of this.creatures) {
      c.vx += this.rng.gauss() * 5;
      c.vy += this.rng.gauss() * 5;
      c.angle += this.rng.gauss();
      c.hurt = 1;
    }
    const { cols, rows } = this;
    const tmp = new Float32Array(this.algae.length);
    for (let pass = 0; pass < 4; pass++) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let s = 0;
          let n = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const rr = r + dr;
              const cc = c + dc;
              if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
              s += this.algae[rr * cols + cc];
              n++;
            }
          }
          tmp[r * cols + c] = (s / n) * 0.97;
        }
      }
      this.algae.set(tmp);
    }
  }

  // ---- simulation -------------------------------------------------------

  step() {
    const { cfg } = this;
    this.tick++;
    this.growAlgae();
    this.rebuildGrid();

    const metabolism = 0.7 + 0.6 * cfg.temperature;
    const list = this.creatures;
    const n = list.length;
    for (let i = 0; i < n; i++) if (list[i].alive) this.sense(list[i]);
    for (let i = 0; i < n; i++) if (list[i].alive) this.act(list[i], metabolism);

    let w = 0;
    for (let i = 0; i < n; i++) if (list[i].alive) list[w++] = list[i];
    list.length = w;
    for (const c of this.newborns) list.push(c);
    this.newborns.length = 0;

    if (cfg.autoSeed && list.length < cfg.minPop && this.tick % 5 === 0) {
      this.spawnRandom();
      this.stats.reseeds++;
    }
    if (this.tick % HISTORY_EVERY === 0) this.record();
    if (this.tick % 500 === 0) this.species.prune();
  }

  growAlgae() {
    const { algae, fertility, bonus, cfg } = this;
    const g = 0.0025 * (0.5 + cfg.temperature) * cfg.nutrients;
    for (let i = 0; i < algae.length; i++) {
      const a = algae[i];
      algae[i] = a + g * (fertility[i] + bonus[i]) * (a + 1) * (1 - a / ALGAE_MAX);
      bonus[i] *= 0.9995;
    }
  }

  rebuildGrid() {
    for (const b of this.buckets) b.length = 0;
    for (const c of this.creatures) {
      const gx = Math.min(this.gridCols - 1, Math.floor(c.x / GRID));
      const gy = Math.min(this.gridRows - 1, Math.floor(c.y / GRID));
      this.buckets[gy * this.gridCols + gx].push(c);
    }
  }

  nearest(c) {
    const r = c.vision;
    const gx0 = Math.max(0, Math.floor((c.x - r) / GRID));
    const gx1 = Math.min(this.gridCols - 1, Math.floor((c.x + r) / GRID));
    const gy0 = Math.max(0, Math.floor((c.y - r) / GRID));
    const gy1 = Math.min(this.gridRows - 1, Math.floor((c.y + r) / GRID));
    let best = null;
    let bestD2 = r * r;
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        for (const o of this.buckets[gy * this.gridCols + gx]) {
          if (o === c || !o.alive) continue;
          const d2 = (o.x - c.x) ** 2 + (o.y - c.y) ** 2;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = o;
          }
        }
      }
    }
    return best;
  }

  sense(c) {
    const inp = c.brain.input;
    const ca = Math.cos(c.angle);
    const sa = Math.sin(c.angle);
    const look = c.vision * 0.5;

    inp[0] = c.energy / c.maxEnergy;
    inp[1] = this.algaeAt(c.x, c.y) / ALGAE_MAX;
    inp[2] = this.algaeAt(c.x + Math.cos(c.angle - 0.6) * look, c.y + Math.sin(c.angle - 0.6) * look) / ALGAE_MAX;
    inp[3] = this.algaeAt(c.x + Math.cos(c.angle + 0.6) * look, c.y + Math.sin(c.angle + 0.6) * look) / ALGAE_MAX;

    const o = this.nearest(c);
    c.seen = o;
    if (o) {
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const d = Math.hypot(dx, dy) || 1;
      inp[4] = 1 - d / c.vision;
      inp[5] = (-dx * sa + dy * ca) / d; // + means it is on the side we turn toward with +turn
      inp[6] = (dx * ca + dy * sa) / d; // + means it is in front
      inp[7] = Math.min(1, Math.max(-1, o.radius / c.radius - 1));
      inp[8] = Math.max(0, 1 - traitDistance(c.genome.traits, o.genome.traits) * 3);
      inp[9] = o.diet;
    } else {
      inp.fill(0, 4, 10);
    }

    const tx = ca > 1e-6 ? (this.width - c.x) / ca : ca < -1e-6 ? -c.x / ca : Infinity;
    const ty = sa > 1e-6 ? (this.height - c.y) / sa : sa < -1e-6 ? -c.y / sa : Infinity;
    inp[10] = Math.max(0, 1 - Math.min(tx, ty) / c.vision);
    inp[11] = c.brain.output[4];
    inp[12] = Math.sin(c.age * c.clockFreq);
    inp[13] = c.hurt;

    c.brain.think();
  }

  act(c, metabolism) {
    const out = c.brain.output;
    const t = c.genome.traits;

    c.angle += out[0] * c.turnRate;
    const thrust = out[1] > 0 ? out[1] : 0;
    c.thrust = thrust;
    const acc = thrust * c.accel;
    c.vx = (c.vx + Math.cos(c.angle) * acc) * 0.9;
    c.vy = (c.vy + Math.sin(c.angle) * acc) * 0.9;
    c.x += c.vx;
    c.y += c.vy;
    if (c.x < c.radius) { c.x = c.radius; c.vx = Math.abs(c.vx) * 0.5; }
    if (c.y < c.radius) { c.y = c.radius; c.vy = Math.abs(c.vy) * 0.5; }
    if (c.x > this.width - c.radius) { c.x = this.width - c.radius; c.vx = -Math.abs(c.vx) * 0.5; }
    if (c.y > this.height - c.radius) { c.y = this.height - c.radius; c.vy = -Math.abs(c.vy) * 0.5; }

    let cost = (0.004 + 0.015 * c.mass + 0.006 * t[T.vision]) * metabolism;
    cost += thrust * thrust * (0.015 + 0.04 * t[T.speed]) * c.mass;

    // Grazing is automatic; specialised hunters barely touch algae.
    if (c.plantEff > 0.01) {
      const idx = this.cellIndex(c.x, c.y);
      const got = Math.min(this.algae[idx], 0.3 * Math.sqrt(c.mass) * c.plantEff);
      this.algae[idx] -= got;
      const gain = got * ALGAE_ENERGY;
      c.energy += gain;
      c.intake += gain;
    }

    c.attacking = false;
    if (out[2] > 0) {
      cost += 0.01 * c.mass;
      const o = c.seen;
      if (o && o.alive) this.bite(c, o);
    }

    c.energy -= cost;
    c.age++;
    if (c.energy > c.maxEnergy) c.energy = c.maxEnergy;

    if (this.cfg.reproduction && out[3] > 0 && c.age > 60 && c.energy > c.maxEnergy * c.breedAt &&
        this.creatures.length + this.newborns.length < this.cfg.maxPop) {
      this.breed(c);
    }
    if (c.energy <= 0) this.kill(c, 'starved');
    else if (c.age > c.maxAge) this.kill(c, 'old age');
    c.hurt *= 0.85;
  }

  bite(c, o) {
    const dx = o.x - c.x;
    const dy = o.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d > c.radius + o.radius + 3 || dx * Math.cos(c.angle) + dy * Math.sin(c.angle) < 0.3 * d) return;
    c.attacking = true;
    const dmg = (0.3 + 1.7 * c.diet) * Math.sqrt(c.mass) * Math.min(2, Math.max(0.3, c.radius / o.radius));
    const taken = Math.min(dmg, Math.max(0, o.energy));
    o.energy -= dmg;
    o.hurt = 1;
    let gain = taken * c.meatEff * 1.2;
    if (o.energy <= 0) {
      gain += o.maxEnergy * 0.3 * c.meatEff; // eat the body
      c.kills++;
      this.stats.kills++;
      this.kill(o, 'eaten');
    }
    c.energy += gain;
    c.intake += gain;
  }

  breed(c) {
    const g = mutate(c.genome, this.rng, this.cfg.mutation);
    const give = Math.min(100 * massOf(g.traits[T.size]) * 0.5, c.energy * 0.45);
    c.energy -= give * 1.2;
    const speciesId = this.species.classify(g, c.speciesId, this.tick);
    const child = new Creature(
      this.nextId++, g,
      c.x - Math.cos(c.angle) * c.radius * 2, c.y - Math.sin(c.angle) * c.radius * 2,
      this.rng.range(0, Math.PI * 2), give, c.generation + 1, c.id, speciesId,
    );
    child.x = Math.min(this.width - 1, Math.max(1, child.x));
    child.y = Math.min(this.height - 1, Math.max(1, child.y));
    this.newborns.push(child);
    this.species.add(speciesId);
    c.children++;
    this.stats.births++;
    if (child.generation > this.stats.maxGeneration) this.stats.maxGeneration = child.generation;
  }

  kill(c, cause) {
    c.alive = false;
    c.cause = cause;
    this.species.remove(c.speciesId, this.tick);
    const idx = this.cellIndex(c.x, c.y);
    this.bonus[idx] = Math.min(1, this.bonus[idx] + 0.15 * c.mass); // the body feeds the algae
    this.stats.deaths++;
    if (c.age > 50) {
      const recent = this.stats.recent;
      recent.push({ rate: c.intake / c.age, grazer: c.diet < 0.5 });
      if (recent.length > RECENT_DEATHS) recent.shift();
    }
  }

  // ---- bookkeeping ------------------------------------------------------

  record() {
    const counts = [];
    for (const sp of this.species.map.values()) if (sp.count > 0) counts.push(sp.id, sp.count);
    let algae = 0;
    for (let i = 0; i < this.algae.length; i++) algae += this.algae[i];
    this.history.push({
      tick: this.tick,
      pop: this.creatures.length,
      algae: algae / (this.algae.length * ALGAE_MAX),
      counts,
    });
    if (this.history.length > HISTORY_MAX) this.history = this.history.filter((_, i) => i % 2 === 0);
  }

  // Mean food energy gathered per tick of life, over recent deaths.
  forageRate() {
    const r = this.stats.recent;
    return r.length ? r.reduce((s, d) => s + d.rate, 0) / r.length : 0;
  }

  findCreature(x, y, slack = 6) {
    let best = null;
    let bestD = Infinity;
    for (const c of this.creatures) {
      const d = Math.hypot(c.x - x, c.y - y) - c.radius;
      if (d < slack && d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }
}
