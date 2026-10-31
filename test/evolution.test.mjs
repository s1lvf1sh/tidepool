// Headless checks that the simulation is deterministic, self-sustaining, and
// that evolution actually produces better foragers than chance.
// Run with: npm test
import assert from 'node:assert/strict';
import { World } from '../src/world.js';
import { Rng } from '../src/rng.js';
import { randomGenome, serialize, deserialize, mutate } from '../src/genome.js';

let failures = 0;
async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`  ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

function fingerprint(world) {
  let h = 0;
  for (const c of world.creatures) h = (h * 31 + Math.round(c.x * 100) + Math.round(c.energy * 100)) % 1e9;
  return `${world.creatures.length}:${world.species.nextId}:${h}`;
}

// Put a group of genomes into a fresh pool with breeding off and measure how
// much food energy they gather per tick of life.
function commonGarden(genomes, ticks = 1500) {
  const garden = new World({ seed: 4242, initialPop: 0, autoSeed: false, reproduction: false });
  const rng = new Rng(77);
  const members = genomes.map((g) =>
    garden.spawn(g, rng.range(0, garden.width), rng.range(0, garden.height)));
  for (let i = 0; i < ticks; i++) garden.step();
  const intake = members.reduce((s, c) => s + c.intake, 0);
  const lived = members.reduce((s, c) => s + c.age, 0);
  return { rate: intake / lived, survival: members.filter((c) => c.alive).length / members.length };
}

console.log('Tidepool simulation tests');

await test('same seed gives the same run', () => {
  const a = new World({ seed: 123 });
  const b = new World({ seed: 123 });
  for (let i = 0; i < 1500; i++) { a.step(); b.step(); }
  assert.equal(fingerprint(a), fingerprint(b));
  const c = new World({ seed: 124 });
  for (let i = 0; i < 1500; i++) c.step();
  assert.notEqual(fingerprint(a), fingerprint(c));
});

await test('genomes survive an export/import round trip', () => {
  const g = mutate(randomGenome(new Rng(5)), new Rng(6));
  const back = deserialize(serialize(g));
  assert.equal(back.traits.length, g.traits.length);
  assert.ok(back.weights.every((w, i) => Math.abs(w - g.weights[i]) < 1e-3));
  assert.throws(() => deserialize('{"tidepool":1}'));
  assert.throws(() => deserialize('not json'));
});

let evolved;
await test('population sustains itself and speciates over 20k ticks', () => {
  const world = new World({ seed: 2026 });
  let minPop = Infinity;
  let reseedsAt5k = 0;
  for (let i = 1; i <= 20000; i++) {
    world.step();
    if (i === 5000) reseedsAt5k = world.stats.reseeds;
    if (i > 5000) minPop = Math.min(minPop, world.creatures.length);
  }
  const lateReseeds = world.stats.reseeds - reseedsAt5k;
  console.log(`       pop=${world.creatures.length} minPop(after 5k)=${minPop} gen=${world.stats.maxGeneration} ` +
    `species ever=${world.species.nextId - 1} late reseeds=${lateReseeds}`);
  assert.ok(minPop >= world.cfg.minPop, `population fell to ${minPop}`);
  assert.equal(lateReseeds, 0, 'needed random reseeding to stay alive');
  assert.ok(world.stats.maxGeneration >= 25, `only ${world.stats.maxGeneration} generations`);
  assert.ok(world.species.nextId - 1 > world.cfg.initialPop + 20, 'no new species formed');
  evolved = world.creatures.slice(0, 80).map((c) => c.genome);
});

await test('evolved creatures out-forage random ones in a common garden', () => {
  assert.ok(evolved, 'needs the previous test');
  const rng = new Rng(9);
  const random = evolved.map(() => randomGenome(rng));
  const e = commonGarden(evolved);
  const r = commonGarden(random);
  console.log(`       evolved: ${e.rate.toFixed(4)} energy/tick, ${(e.survival * 100).toFixed(0)}% alive` +
    ` | random: ${r.rate.toFixed(4)} energy/tick, ${(r.survival * 100).toFixed(0)}% alive`);
  assert.ok(e.rate > r.rate * 1.5, 'evolved foraging is not clearly better');
  assert.ok(e.survival > r.survival, 'evolved creatures do not survive better');
});

await test('released hunters can catch prey', () => {
  const world = new World({ seed: 31 });
  for (let i = 0; i < 3000; i++) world.step();
  world.spawnHunters(12, world.width / 2, world.height / 2);
  const before = world.stats.kills;
  for (let i = 0; i < 2000; i++) world.step();
  console.log(`       kills in 2000 ticks: ${world.stats.kills - before}`);
  assert.ok(world.stats.kills - before >= 5, 'hunters caught almost nothing');
});

console.log(failures ? `\n${failures} test(s) failed` : '\nall tests passed');
process.exit(failures ? 1 : 0);
