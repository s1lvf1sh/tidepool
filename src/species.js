import { T, geneticDistance } from './genome.js';

const ONSET = ['ve', 'lo', 'mar', 'sil', 'ka', 'ru', 'thi', 'an', 'os', 'pel', 'dri', 'ny', 'qua', 'zo', 'bel', 'fen', 'gli', 'mo', 'ra', 'ur', 'cy', 'el'];
const MIDDLE = ['', '', 'li', 'ra', 'no', 've', 'ta', 'mi', 'su'];
const CODA = ['ra', 'na', 'lis', 'tor', 'mia', 'dax', 'vel', 'ion', 'ett', 'ula', 'ix', 'ope', 'ard', 'ys', 'el', 'un'];

// Names come from a hash of the id, so naming never touches the simulation's RNG.
function nameFor(id) {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  const take = (list) => {
    const v = list[h % list.length];
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return v;
  };
  const name = take(ONSET) + take(MIDDLE) + take(CODA);
  return name[0].toUpperCase() + name.slice(1);
}

// A species is a lineage whose members stay within `threshold` genetic distance
// of the founder. A child that drifts further founds a new species, so the
// registry doubles as a phylogeny.
export class SpeciesRegistry {
  constructor(threshold) {
    this.threshold = threshold;
    this.map = new Map();
    this.nextId = 1;
  }

  found(genome, parentId, tick) {
    const id = this.nextId++;
    const sp = {
      id,
      parent: parentId,
      founder: genome,
      hue: genome.traits[T.hue],
      diet: genome.traits[T.diet],
      born: tick,
      extinct: null,
      count: 0,
      peak: 0,
      total: 0,
      childSpecies: 0,
      name: nameFor(id),
    };
    this.map.set(id, sp);
    const parent = parentId != null && this.map.get(parentId);
    if (parent) parent.childSpecies++;
    return sp;
  }

  classify(genome, parentSpeciesId, tick) {
    const sp = this.map.get(parentSpeciesId);
    if (sp && geneticDistance(genome, sp.founder) <= this.threshold) return sp.id;
    return this.found(genome, parentSpeciesId ?? null, tick).id;
  }

  get(id) {
    return this.map.get(id);
  }

  add(id) {
    const sp = this.map.get(id);
    sp.count++;
    sp.total++;
    sp.extinct = null;
    if (sp.count > sp.peak) sp.peak = sp.count;
  }

  remove(id, tick) {
    const sp = this.map.get(id);
    sp.count--;
    if (sp.count === 0) sp.extinct = tick;
  }

  living() {
    return [...this.map.values()].filter((sp) => sp.count > 0);
  }

  // Forget tiny dead-end lineages so long runs stay bounded in memory.
  prune() {
    for (const sp of this.map.values()) {
      if (sp.count > 0 || sp.peak >= 3 || sp.childSpecies > 0) continue;
      this.map.delete(sp.id);
      const parent = this.map.get(sp.parent);
      if (parent) parent.childSpecies--;
    }
  }
}
