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
        const t = document.getElementById('filter') as HTMLInputElement;
        t.value = val;
        t.dispatchEvent(new Event('input'));
    }, v);
    await page.waitForTimeout(500);
    return page.evaluate(() => document.getElementById('stats')!.textContent);
}
const before = await setFilter('');
await page.screenshot({ path: 'out/smoke-filtered.png' });
const filtered = await setFilter('zombie');
await page.screenshot({ path: 'out/smoke-zombie.png' });
await setFilter('');

// min level slider
await page.evaluate(() => {
    const s = document.getElementById('minlevel') as HTMLInputElement;
    s.value = '41';
    s.dispatchEvent(new Event('input'));
});
await page.waitForTimeout(300);
const minLev = await page.evaluate(() => document.getElementById('stats')!.textContent);

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
console.log('before:', before, '| zombie:', filtered, '| min level 41:', minLev, '| dungeons hidden:', hidden, '| zoomed:', zoomed);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();