# Tidepool

An artificial-life simulation that runs in the browser. Small creatures swim around a tidepool, graze algae, bite each other, breed and die. Each one is steered by a tiny neural network written in its genome. **No behaviour is scripted.** Everything they do comes from mutation and selection, so every seed plays out differently.

No dependencies, no build step. Plain HTML, CSS and JavaScript modules.

**▶ Play it in your browser: https://s1lvf1sh.github.io/tidepool/** (or jump into an already-evolved pool: [seed 42, 8,000 ticks in](https://s1lvf1sh.github.io/tidepool/#seed=42&warm=8000&inspect))

## Run it locally

```sh
npm start          # serves on http://localhost:8080
npm test           # headless checks (about 40 s)
```

The app needs a local server rather than opening `index.html` directly, because browsers won't load ES modules from `file://` URLs. `serve.mjs` is a dependency-free server; any static server works too.

## What you can do

| | |
|---|---|
| **Watch** | Body colour, size and jaws come from the genes, so related creatures look alike. Hunters (diet > 0.5) have jaws that open when they bite. |
| **Inspect** | Click a creature to see its stats, its genes and a live view of its brain: which senses are firing and what it's deciding. *Follow* keeps the camera on it, and when it dies the camera moves to its youngest living child. |
| **Intervene** | *Grow algae* and *Fertilise* (click or drag), *Release hunters* (a hand-wired predator that then evolves like everything else), *Storm*, plus sliders for temperature, nutrients and mutation rate. |
| **Read history** | A stacked population chart by species, with the algae level as a dashed line, and a family tree showing which species split from which. Click a living species to inspect its oldest member. |
| **Share** | The seed is kept in the URL. *Export* copies a creature's genome as JSON, and *Import* releases it into any pool. |

Keys: `space` pause, `+`/`-` speed, `F` follow, `Esc` deselect, `I`/`G`/`N`/`H` choose a tool.

URL options: `#seed=reef&warm=8000&inspect` opens seed "reef", runs 8,000 ticks before showing anything, and selects the oldest creature.

## How it works

- **Genome**: 8 traits (size, speed, hue, vision, diet, mutation rate, breeding threshold, internal clock speed) plus the 157 weights of the brain. The mutation rate is itself a gene, so it evolves too.
- **Brain** ([src/brain.js](src/brain.js)): 14 inputs → 8 tanh units → 5 outputs. Inputs cover energy, algae under it and ahead-left/right, the nearest creature (distance, bearing, relative size, how alike it looks, its diet), walls, an internal clock, whether it was just bitten, and one memory value fed back from the previous tick. Outputs are turn, thrust, attack, breed and memory.
- **Ecology** ([src/world.js](src/world.js)): algae grows logistically on a fertility map of nutrient patches. Grazing efficiency falls as diet rises and meat efficiency rises with it, so being an omnivore is costly. Size, speed and vision all cost energy. Dead bodies fertilise the water where they fall.
- **Species** ([src/species.js](src/species.js)): a child that drifts more than a set genetic distance from its species' founder starts a new species. That makes the species registry a family tree as well.
- **Determinism**: all randomness in the simulation comes from one seeded generator, so the same seed and settings replay the same run. Using the tools (interventions) changes the run from that point on.

## Is it really evolving?

`npm test` checks this directly with a **common garden** experiment. It takes 80 creatures from a pool that has evolved for 20,000 ticks and 80 random creatures, puts each group into an identical fresh pool with breeding turned off, and measures how much food each group gathers per tick of life. Across seeds, the evolved creatures gather roughly **1.8–2.9× more food** than the random ones and survive better. The tests also check determinism, export/import round trips, that the population sustains itself without random reseeding, that new species form, and that released hunters actually catch prey.

## License

MIT. See [LICENSE](LICENSE).
