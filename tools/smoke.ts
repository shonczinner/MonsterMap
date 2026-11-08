// Smoke test: render out/monstermap.html headless, collect console errors, screenshot.
import { chromium } from 'playwright-core';

const url = 'file://' + process.cwd() + '/out/monstermap.html';
const browser = await chromium.launch({
    executablePath: '/home/shonc/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
    headless: true
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors: string[] = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.goto(url);
await page.waitForTimeout(1500);

const boot = await page.evaluate(() => ({
    areas: document.querySelectorAll('#areas input').length,
    checked: document.querySelectorAll('#areas input:checked').length,
    stats: document.getElementById('stats')!.textContent,
    canvas: (document.getElementById('c') as HTMLCanvasElement).width > 0
}));
await page.screenshot({ path: 'out/smoke.png' });

// filter to zombie -> exact flash (name 'Zombie')
async function setFilter(v: string): Promise<string> {
    await page.evaluate((val) => {
        const t = document.getElementById('search') as HTMLInputElement;
        t.value = val;
        t.dispatchEvent(new Event('input'));
    }, v);
    await page.waitForTimeout(100);
    if (v) {
        await page.evaluate(() => {
            const first = document.querySelector('#suggest div') as HTMLElement | null;
            first?.click();
        });
        await page.waitForTimeout(500);
    }
    return page.evaluate(() => document.getElementById('stats')!.textContent);
}

async function shownDotCount(): Promise<number> {
    const text = await page.evaluate(() => document.getElementById('stats')!.textContent ?? '');
    return Number(/(\d+) dots/.exec(text)?.[1] ?? Number.NaN);
}

const runecraftData = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById('mmdata')!.textContent ?? '{}');
    const points = data.pts.filter((p: { cat: string }) => p.cat === 'runecraft');
    return {
        total: points.length,
        ruins: points.filter((p: { name: string }) => p.name.endsWith('temple ruins')).length,
        altars: points.filter((p: { name: string }) => p.name.endsWith('rune altar')).length,
        layer: data.cats.find((c: { key: string }) => c.key === 'runecraft')?.label
    };
});
if (runecraftData.total === 0 || runecraftData.ruins === 0 || runecraftData.altars === 0 || runecraftData.layer !== 'Runecrafting') {
    throw new Error('runecrafting map data is incomplete: ' + JSON.stringify(runecraftData));
}

const zombieStats = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById('mmdata')!.textContent ?? '{}');
    const z = data.pts.find((p: { cat: string; name: string }) => p.cat === 'monster' && p.name === 'Zombie');
    return z ? { stats: z.stats, hp: z.hp, bonuses: z.bonuses } : null;
});
if (!zombieStats || !Array.isArray(zombieStats.stats) || zombieStats.stats.length !== 6 || !zombieStats.hp || !zombieStats.bonuses) {
    throw new Error('monster points are missing combat stats/bonuses: ' + JSON.stringify(zombieStats));
}

const multiwayData = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById('mmdata')!.textContent ?? '{}');
    return { total: data.multi?.length ?? 0, regions: [...new Set((data.multi ?? []).map((r: { region: string }) => r.region))].length };
});
if (multiwayData.total === 0 || multiwayData.regions === 0) {
    throw new Error('multi-combat overlay data is empty: ' + JSON.stringify(multiwayData));
}

const clueDrops = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById('mmdata')!.textContent ?? '{}');
    const goblin = data.pts.find((p: { cat: string; name: string; drops?: string[] }) => p.cat === 'monster' && p.name === 'Goblin' && p.drops?.some((d: string) => d.startsWith('Clue scroll')));
    return { goblin: goblin?.drops?.filter((d: string) => d.startsWith('Clue scroll')) ?? [], tiers: [...new Set(data.pts.flatMap((p: { drops?: string[] }) => (p.drops ?? []).filter((d: string) => d.startsWith('Clue scroll')).map((d: string) => d.replace(/ 1\/\d+$/, ''))))].sort() };
});
if (clueDrops.goblin.length === 0 || clueDrops.tiers.length < 3) {
    throw new Error('clue scroll drops are missing from the map data: ' + JSON.stringify(clueDrops));
}

const beforeToggle = await shownDotCount();
await page.evaluate(() => (document.querySelector('#cats input[data-cat="runecraft"]') as HTMLInputElement).click());
await page.waitForTimeout(300);
const hiddenToggle = await shownDotCount();
await page.evaluate(() => (document.querySelector('#cats input[data-cat="runecraft"]') as HTMLInputElement).click());
if (beforeToggle - hiddenToggle !== runecraftData.total) {
    throw new Error(`runecrafting toggle removed ${beforeToggle - hiddenToggle} dots, expected ${runecraftData.total}`);
}

const before = await setFilter('');
const runecraftFiltered = await setFilter('Air temple ruins');
if (!runecraftFiltered?.includes('flashing Air temple ruins') || !runecraftFiltered.includes('1 flashing')) {
    throw new Error('runecrafting search did not flash Air temple ruins: ' + runecraftFiltered);
}
await page.screenshot({ path: 'out/smoke-filtered.png' });
const filtered = await setFilter('zombie');
await page.screenshot({ path: 'out/smoke-zombie.png' });
await setFilter('');
const allDots = await shownDotCount();

// min HP hides low-HP monsters
await page.evaluate(() => {
    const i = document.getElementById('minhp') as HTMLInputElement;
    i.value = '100';
    i.dispatchEvent(new Event('input'));
});
await page.waitForTimeout(300);
const hpDots = await shownDotCount();
if (!(hpDots < allDots)) {
    throw new Error(`min HP did not hide monsters: ${allDots} -> ${hpDots}`);
}
await page.evaluate(() => {
    const i = document.getElementById('minhp') as HTMLInputElement;
    i.value = '0';
    i.dispatchEvent(new Event('input'));
});

// cluster everything (no search) -> camps; min cluster size drops small camps
await page.evaluate(() => (document.getElementById('clusterall') as HTMLInputElement).click());
await page.waitForTimeout(600);
const clustered = await page.evaluate(() => document.getElementById('stats')!.textContent ?? '');
const campsBefore = Number(/(\d+) camps/.exec(clustered)?.[1] ?? Number.NaN);
if (!clustered.includes('camps') || !(campsBefore > 0)) {
    throw new Error('cluster-everything produced no camps: ' + clustered);
}
await page.screenshot({ path: 'out/smoke-clusters.png' });
await page.evaluate(() => {
    const i = document.getElementById('mincluster') as HTMLInputElement;
    i.value = '2';
    i.dispatchEvent(new Event('input'));
});
await page.waitForTimeout(300);
const clustered2 = await page.evaluate(() => document.getElementById('stats')!.textContent ?? '');
const campsAfter = Number(/(\d+) camps/.exec(clustered2)?.[1] ?? Number.NaN);
if (!(campsAfter < campsBefore)) {
    throw new Error(`min cluster size did not drop camps: ${campsBefore} -> ${campsAfter}`);
}
await page.evaluate(() => {
    const i = document.getElementById('mincluster') as HTMLInputElement;
    i.value = '1';
    i.dispatchEvent(new Event('input'));
    (document.getElementById('clusterall') as HTMLInputElement).click();
});
await page.waitForTimeout(300);

// multi-combat overlay toggle (does not change the dot set, just paints zones)
const multiBefore = await shownDotCount();
await page.evaluate(() => (document.getElementById('multiway') as HTMLInputElement).click());
await page.waitForTimeout(300);
await page.screenshot({ path: 'out/smoke-multiway.png' });
const multiAfter = await shownDotCount();
if (multiAfter !== multiBefore) {
    throw new Error(`multiway overlay changed the dot count: ${multiBefore} -> ${multiAfter}`);
}
await page.evaluate(() => (document.getElementById('multiway') as HTMLInputElement).click());
await page.waitForTimeout(200);

// hide the dungeon area
await page.evaluate(() => {
    const cb = document.querySelector('#areas input[data-area="1"]') as HTMLInputElement;
    cb.click();
});
await page.waitForTimeout(300);
const hidden = await page.evaluate(() => document.getElementById('stats')!.textContent);
await page.screenshot({ path: 'out/smoke-no-dungeon.png' });

// zoom in at canvas centre (wheel), screenshot ground rendering
await page.evaluate(() => {
    const c = document.getElementById('c')!;
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new WheelEvent('wheel', {
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        deltaY: -500, bubbles: true, cancelable: true
    }));
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'out/smoke-zoom.png' });
const zoomed = await page.evaluate(() => document.getElementById('stats')!.textContent);

console.log('boot:', JSON.stringify(boot));
console.log('runecraft:', JSON.stringify(runecraftData), '| search:', runecraftFiltered);
console.log('multiway:', JSON.stringify(multiwayData));
console.log('clues:', JSON.stringify(clueDrops));
console.log('before:', before, '| zombie:', filtered, '| dungeons hidden:', hidden, '| zoomed:', zoomed);
console.log('filters: hp', allDots, '->', hpDots, '| camps', campsBefore, '->', campsAfter);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();