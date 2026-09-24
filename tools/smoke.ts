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
    await page.evaluate(() => {
        const first = document.querySelector('#suggest div') as HTMLElement | null;
        first?.click();
    });
    await page.waitForTimeout(500);
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
console.log('before:', before, '| zombie:', filtered, '| dungeons hidden:', hidden, '| zoomed:', zoomed);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();