/**
 * MonsterMap — build all output pages from current data/layout.
 *
 * Usage: bun build.ts
 *
 * Runs every page generator in sequence so a single command rebuilds the whole
 * site (map + monster list + item list). Each generator reads
 * `config.outDir`/`config.dataDir` and emits its HTML into `out/`.
 *
 * Add a generator here when you add a page to `lib/pages.ts`.
 */
import './map.ts';
import './list.ts';
import './items.ts';
