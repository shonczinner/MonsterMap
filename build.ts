/**
 * MonsterMap — build all output pages from current data/layout.
 *
 * Usage: bun build.ts
 *
 * Runs every step in sequence: bake terrain PNGs, generate data from the game
 * cache, then render all HTML pages. A single command rebuilds the whole site.
 */
import { main as bake } from './lib/maps/bake.ts';

bake();

await import('./gen.ts');
await import('./map.ts');
await import('./list.ts');
await import('./items.ts');
