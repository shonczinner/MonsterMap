/**
 * Shared registry of static pages emitted into `out/`.
 *
 * Both `map.ts` and `list.ts` import this so the top nav bar is generated from
 * a single source of truth. To add a page later, append to `PAGES` here and
 * create its generator + template — the nav updates everywhere automatically.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PageDef = {
    /** Label shown in the nav bar. */
    name: string;
    /** File name inside the build output dir (out/). */
    file: string;
};

export const PAGES: PageDef[] = [
    { name: 'Map', file: 'monstermap.html' },
    { name: 'Monsters', file: 'monsters.html' },
    { name: 'Items', file: 'items.html' },
];

function readRevision(): number {
    try {
        const worldPath = join(import.meta.dir, '..', 'data', 'config', 'world.json');
        const world = JSON.parse(readFileSync(worldPath, 'utf8'));
        return world.engine?.revision ?? 0;
    } catch {
        return 0;
    }
}

const REVISION = readRevision();

/**
 * Build the top nav bar HTML. `current` is the file name of the page being
 * rendered, so its link is marked active.
 */
export function navHtml(current: string): string {
    const links = PAGES.map((p) => {
        const active = p.file === current ? ' class="active"' : '';
        return `<a href="${p.file}"${active}>${esc(p.name)}</a>`;
    }).join('\n      ');
    const revBadge = REVISION ? `<span class="rev">r${REVISION}</span>` : '';
    return `<nav id="mmnav">
      <span class="brand">MonsterMap ${revBadge}</span>
      ${links}
    </nav>`;
}

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => {
        if (c === '&') return '&amp;';
        if (c === '<') return '&lt;';
        if (c === '>') return '&gt;';
        if (c === '"') return '&quot;';
        return '&#39;';
    });
}
