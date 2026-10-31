// Seeded PRNG (mulberry32) so a run can be replayed exactly from its seed.
export class Rng {
  constructor(seed) {
    this.state = seed >>> 0;
    this.spare = null;
  }

  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo, hi) {
    return lo + (hi - lo) * this.next();
  }

  int(n) {
    return Math.floor(this.next() * n);
  }

  gauss() {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const m = Math.sqrt(-2 * Math.log(u));
    this.spare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  }
}

// Integers are used as-is; any other text is hashed, so "coral reef" is a valid seed.
export function seedFromString(text) {
  const s = String(text).trim();
  if (/^\d+$/.test(s)) return Number(s) >>> 0;
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
